import { rackPoints, type EndgameLine } from "../shared/endgame";
import type { Lexicon } from "../shared/lexicon";
import type { Move } from "../shared/model";
import { rackLetters } from "../shared/rack-entry";
import type { OpponentEndgamePosition } from "../shared/reply-analysis";
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

export type OpponentEndgameMessage =
  | { progress: OpponentEndgameProgress }
  | { result: OpponentEndgameResult }
  | { error: string };

export async function parallelOpponentEndgame(
  lexicon: Lexicon,
  position: OpponentEndgamePosition,
  workerLimit: number,
  onProgress: (progress: OpponentEndgameProgress) => void,
  createWorker?: () => Worker,
  timeLimitMs = SEARCH_MS,
): Promise<OpponentEndgameResult> {
  const deadline = performance.now() + timeLimitMs;
  const { board, opponentRack, template, rack } = position;
  const goOutBonus = 2 * rackPoints(rackLetters(rack), template.rules);
  const moves = solve(lexicon, board, opponentRack, template);
  const priority = (move: Move) => move.score + (move.leave ? 0 : goOutBonus);
  moves.sort((a, b) => priority(b) - priority(a));
  const roots = [...moves.slice(0, 4), null, ...moves.slice(4)];
  const jobs: Job[] = roots.map((move, index) => ({
    kind: "opponent-endgame",
    position,
    move,
    deadline: performance.timeOrigin + deadline,
    index: move ? index : roots.length,
  }));

  const pool = createCandidatePool(lexicon, workerLimit, createWorker);
  const best: { index: number; line: EndgameLine }[] = [];
  const limited: Job[] = [];
  const batches: EndgameBatchTiming[] = [];
  let batchStarted = performance.now();
  let checked = 0;
  let reported = -Infinity;
  function finishBatch() {
    const now = performance.now();
    batches.push({ checked, elapsed: now - batchStarted });
    batchStarted = now;
  }
  function progress() {
    reported = performance.now();
    onProgress({ checked, total: roots.length });
  }

  function minimumSpread(job: Job) {
    const fifth = best[RESULT_COUNT - 1];
    if (fifth) {
      // A later root has to beat the fifth line outright to displace it.
      return -fifth.line.spread + Number(job.index > fifth.index);
    }
    return -Infinity;
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
      throw new Error(
        result.kind === "error"
          ? result.message
          : "Unexpected opponent endgame result.",
      );
    checked++;
    if (result.line) {
      best.push({ index: job.index, line: result.line });
      best.sort((a, b) => a.line.spread - b.line.spread || a.index - b.index);
      if (best.length > RESULT_COUNT) best.pop();
    }
    if (checked % TIMING_BATCH_SIZE === 0) finishBatch();
    if (performance.now() - reported >= 120) progress();
  }

  try {
    progress();
    await pool.run(jobs, receive, prepare);
    // A root that initially ran out of time may be cheap to rule out once
    // other workers have established a stronger fifth line.
    const retry = limited.filter(
      (job) => minimumSpread(job) > (job.minimumSpread ?? -Infinity),
    );
    if (retry.length && performance.now() < deadline)
      await pool.run(retry, receive, prepare);
    if (checked % TIMING_BATCH_SIZE !== 0) finishBatch();
    return {
      checked,
      total: roots.length,
      lines: best.map(({ line }) => line),
      batches,
    };
  } finally {
    pool.close();
  }
}
