import { rackPoints, type EndgameLine } from "../shared/endgame";
import type { Lexicon } from "../shared/lexicon";
import type { Move } from "../shared/model";
import { rackComposition, rackLetters } from "../shared/rack-entry";
import type { ExactEndgamePosition, OpponentEndgamePosition } from "../shared/reply-analysis";
import { solve } from "../shared/solver";
import type { CandidateJob, CandidateResult } from "./candidate-analysis-jobs";
import { createCandidatePool } from "./candidate-analysis-pool";
import type { EndgameBatchTiming } from "./move-timing";

const RESULT_COUNT = 5;
const SEARCH_MS = 25_000;
const TIMING_BATCH_SIZE = 500;

type Job = Extract<CandidateJob, { kind: "opponent-endgame" }> & {
  index: number;
};

export type OpponentEndgameProgress = { checked: number; total: number };

export type OpponentEndgameResult = OpponentEndgameProgress & {
  lines: EndgameLine[];
  batches: EndgameBatchTiming[];
};

export type OpponentEndgameRequest = OpponentEndgamePosition & {
  kind: "solve-opponent-endgame";
  dictionaryId: string;
  workerLimit: number;
};

type ExactEndgameSearch = ExactEndgamePosition & { cachedLines?: EndgameLine[] };

export type ExactEndgameRequest = OpponentEndgameRequest | (ExactEndgameSearch & {
  kind: "solve-own-endgame";
  dictionaryId: string;
  workerLimit: number;
});
export type ExactEndgameContinuation = { kind: "continue-exact-endgame" };

export type OpponentEndgameMessage =
  | { progress: OpponentEndgameProgress }
  | { result: OpponentEndgameResult }
  | { error: string };

export function createExactEndgameSearch(
  lexicon: Lexicon,
  { cachedLines, ...position }: ExactEndgameSearch,
  workerLimit: number,
  createWorker?: () => Worker,
) {
  const started = performance.now();
  const { board, opponentRack, template, rack } = position;
  const yourTurn = position.firstPlayer === "you";
  const perspective = yourTurn ? 1 : -1;
  const yourRack = rackLetters(rack);
  const goOutBonus = 2 * rackPoints(yourTurn ? opponentRack : yourRack, template.rules);
  const moves = solve(lexicon, board, yourTurn ? yourRack : opponentRack, template);
  const priority = (move: Move) => move.score + (move.leave ? 0 : goOutBonus);
  moves.sort((a, b) => priority(b) - priority(a));
  const roots = [...moves.slice(0, 4), null, ...moves.slice(4)];
  const unfinished = new Map(roots.map((move, order) => [move ? order : roots.length, move]));
  const best: { index: number; line: EndgameLine }[] = [];
  const batches: EndgameBatchTiming[] = [];
  const checked = () => roots.length - unfinished.size;
  let runs = 0;

  function finishRoot(index: number, line?: EndgameLine) {
    unfinished.delete(index);
    if (!line) return;
    best.push({ index, line });
    best.sort((a, b) => perspective * (b.line.spread - a.line.spread) || a.index - b.index);
    if (best.length > RESULT_COUNT) best.pop();
  }

  if (yourTurn && cachedLines?.length) {
    const cached = new Map(cachedLines.map((line) => [line.line[0]?.id, line] as const));
    for (const [index, move] of unfinished) {
      if (!move) continue;
      const line = cached.get(move.id);
      const root = line?.line[0];
      if (line && root && root.score === move.score && rackComposition(root.leave) === rackComposition(move.leave))
        finishRoot(index, line);
    }
  }

  function minimumSpread(job: Job) {
    const fifth = best[RESULT_COUNT - 1];
    if (!fifth) return -Infinity;
    // A later root has to beat the fifth line outright to displace it.
    return perspective * fifth.line.spread + Number(job.index > fifth.index);
  }

  return {
    async run(
      onProgress: (progress: OpponentEndgameProgress) => void,
      timeLimitMs?: number,
    ): Promise<OpponentEndgameResult> {
      const extraMs = runs * 10_000;
      const start = runs === 0 ? started : performance.now();
      runs++;
      const deadline = start + (timeLimitMs ?? SEARCH_MS + extraMs);
      const jobs: Job[] = Array.from(unfinished, ([index, move]) => ({
        kind: "opponent-endgame",
        position,
        move,
        index,
        deadline: performance.timeOrigin + deadline,
        timeLimitMs: 5_000 + extraMs,
      }));
      const pool = createCandidatePool(lexicon, workerLimit, createWorker);
      const limited: Job[] = [];
      let batchStarted = performance.now();
      let batchChecked = batches.at(-1)?.checked ?? 0;
      let reported = -Infinity;
      function finishBatch() {
        const now = performance.now();
        batchChecked = checked();
        batches.push({ checked: batchChecked, elapsed: now - batchStarted });
        batchStarted = now;
      }
      function progress() {
        reported = performance.now();
        onProgress({ checked: checked(), total: roots.length });
      }
      function prepare(job: Job) {
        if (performance.now() < deadline)
          return { ...job, minimumSpread: minimumSpread(job) };
      }
      function receive(job: Job, result: CandidateResult) {
        if (result.kind === "limit") {
          limited.push(job);
          return;
        }
        if (result.kind !== "opponent-endgame")
          throw new Error(result.kind === "error" ? result.message : "Unexpected endgame result.");
        finishRoot(job.index, result.line);
        if (checked() - batchChecked >= TIMING_BATCH_SIZE) finishBatch();
        if (performance.now() - reported >= 120) progress();
      }

      try {
        progress();
        await pool.run(jobs, receive, prepare);
        // A stronger fifth line can make a timed-out root cheap to rule out.
        const retry = limited.filter((job) => minimumSpread(job) > (job.minimumSpread ?? -Infinity));
        if (retry.length && performance.now() < deadline) await pool.run(retry, receive, prepare);
        if (checked() > batchChecked) finishBatch();
        return { checked: checked(), total: roots.length, lines: best.map(({ line }) => line), batches: [...batches] };
      } finally {
        pool.close();
      }
    },
  };
}

export async function parallelEndgame(
  lexicon: Lexicon,
  position: ExactEndgameSearch,
  workerLimit: number,
  onProgress: (progress: OpponentEndgameProgress) => void,
  createWorker?: () => Worker,
  timeLimitMs?: number,
): Promise<OpponentEndgameResult> {
  return createExactEndgameSearch(lexicon, position, workerLimit, createWorker).run(onProgress, timeLimitMs);
}

export { parallelEndgame as parallelOpponentEndgame };
