import { sampleBingoDeals, type BingoDeal } from "../shared/bingo-replies";
import {
  chooseHunterCandidates,
  chooseHunterFinalists,
  exactHunterDeals,
  hunterClose,
  hunterPool,
  hunterScreen,
  hunterUtility,
  HUNTER_CANDIDATES,
  HUNTER_CHECKPOINT,
  HUNTER_INITIAL,
  HUNTER_MAX,
  HUNTER_SCORE_LEADERS,
  type HunterPosition,
  type RankedHunterMove,
} from "../shared/bingo-hunter";
import type { RackOdds } from "../shared/bingo-odds";
import type { BingoCeilingResult } from "../shared/bingo-ceilings";
import type { Lexicon } from "../shared/lexicon";
import type { Move } from "../shared/model";
import { randomGenerator } from "../shared/move-analysis";
import { profileWordHash } from "../shared/player-profiles";
import { rackComposition } from "../shared/rack-entry";
import type { CandidateJob } from "./candidate-analysis-jobs";
import { createCandidatePool } from "./candidate-analysis-pool";
import { createBingoCeilingSearch } from "./parallel-bingo-ceilings";

export type HunterStageProgress = {
  phase: "exact" | "screen" | "screen-replies" | "sample" | "checkpoint" | "refine" | "ceiling-discovery" | "ceiling-replies";
  done: number;
  total: number;
};
export type HunterProgress = HunterStageProgress & { stage: number };
export type HunterSummary = {
  checked: number;
  limited: boolean;
  canContinue?: boolean;
  finalistsRefined?: boolean;
  ceilingPass?: boolean;
  ceilings?: BingoCeilingResult[];
};

export const BINGO_HUNTER_SLICE_MS = 10_000;
const SCREEN_DEALS = 48;
const REPLY_SCREEN_DEALS = 20;
const MIN_PROVISIONAL_DEALS = 8;
const MAX_EXACT_MOVES = 4_096;
const MAX_EXACT_EVALUATIONS = 750_000;
const now = () => performance.timeOrigin + performance.now();

type Scores = Map<Move, number[]>;
const compareUtility = (a: RankedHunterMove, b: RankedHunterMove) =>
  b.utility.total - a.utility.total || b.utility.playPoints - a.utility.playPoints;
type Phase =
  | "exact"
  | "screen"
  | "screen-replies"
  | "sample"
  | "checkpoint"
  | "refine"
  | "ceilings"
  | "done";

export function createBingoHunterSession(
  lexicon: Lexicon,
  position: HunterPosition,
  moves: readonly Move[],
  odds: RackOdds | undefined,
  workerLimit: number,
) {
  const { pool, opponentSize } = hunterPool(position);
  const { template, bagSize } = position;
  const limit = Math.min(workerLimit, 8);
  const draw = Math.min(bagSize, template.rackSize);
  const seed = profileWordHash(
    `${position.board.join(".")}:${rackComposition(position.rack)}:${bagSize}`,
  );
  const common = sampleBingoDeals(
    pool,
    opponentSize,
    draw,
    HUNTER_MAX,
    randomGenerator(seed),
  );
  const draws = sampleBingoDeals(
    pool,
    opponentSize,
    draw,
    SCREEN_DEALS,
    randomGenerator(seed ^ 0x8c748391),
  );
  const exact = bagSize <= 3 ? exactHunterDeals(pool, bagSize) : undefined;
  const exactLimit =
    exact &&
    Math.min(MAX_EXACT_MOVES, Math.floor(MAX_EXACT_EVALUATIONS / exact.length));
  const exactFits = exactLimit !== undefined && moves.length <= exactLimit;
  const wide =
    !exactFits && moves.length > HUNTER_CANDIDATES
      ? hunterScreen(
          moves,
          position,
          odds?.bagSize === bagSize ? odds : undefined,
        )
      : { screen: moves, base: moves, laneOrder: [], limited: false };
  const boardScores: Scores = new Map(),
    replyScores: Scores = new Map(),
    exactScores: Scores = new Map();
  const needsScreen = wide.screen.length > HUNTER_CANDIDATES;
  const stages: HunterProgress["phase"][] = [];
  if (exact) stages.push("exact");
  else {
    if (needsScreen) stages.push("screen", "screen-replies");
    stages.push("sample", "checkpoint", "refine", "ceiling-discovery", "ceiling-replies");
  }
  let limited = wide.limited;
  let phase: Phase = !moves.length
    ? "done"
    : exact
      ? "exact"
      : needsScreen
        ? "screen"
        : "sample";
  let candidates: readonly Move[] = exactLimit !== undefined && !exactFits
    ? [...new Set([...wide.screen, ...moves.slice(0, exactLimit)])].slice(
        0,
        exactLimit,
      )
    : wide.screen;
  limited ||= !!exact && candidates.length < moves.length;
  let finalists: readonly Move[] = [];
  let ceilingSearch: ReturnType<typeof createBingoCeilingSearch> | undefined;
  let stalled = false;

  function sharedCount(slate: readonly Move[], scores: Scores) {
    return slate.length
      ? Math.min(...slate.map((move) => scores.get(move)?.length ?? 0))
      : 0;
  }

  function rank(
    slate: readonly Move[],
    scores: Scores,
    deals: readonly BingoDeal[],
    count: number,
    enumerate = false,
  ) {
    return slate
      .map(
        (move): RankedHunterMove => ({
          move,
          utility: hunterUtility(
            move,
            template,
            scores.get(move)?.slice(0, count) ?? [],
            deals,
            enumerate,
          ),
        }),
      )
      .sort(compareUtility);
  }

  function shortlist() {
    const before = rank(wide.screen, boardScores, draws, SCREEN_DEALS);
    const after = rank(wide.screen, replyScores, common, REPLY_SCREEN_DEALS);
    const peaks = new Map(
      before.map(({ move, utility }) => [move, utility.highestBingo]),
    );
    for (const { move, utility } of after)
      peaks.set(move, Math.max(peaks.get(move) ?? 0, utility.highestBingo));
    const base = new Set(wide.base);
    candidates = chooseHunterCandidates(
      before.map(({ move }) => move).filter((move) => base.has(move)),
      before.map(({ move }) => move),
      after.map(({ move }) => move),
      [...peaks]
        .filter(([, score]) => score > 0)
        .sort(([, a], [, b]) => b - a)
        .map(([move]) => move),
      wide.laneOrder,
      moves.slice(0, HUNTER_SCORE_LEADERS),
    );
  }

  function snapshot() {
    const deals = exact ?? common;
    const scores = exact ? exactScores : replyScores;
    const sampleFloor = Math.min(
      MIN_PROVISIONAL_DEALS,
      sharedCount(candidates, scores) || MIN_PROVISIONAL_DEALS,
    );
    // A prefix of the exact enumeration can bias the estimate. Publish a move
    // only after all of its weighted deals have been checked.
    const comparable = candidates.filter(
      (move) =>
        (scores.get(move)?.length ?? 0) >= (exact?.length ?? sampleFloor),
    );
    const count = sharedCount(comparable, scores);
    const rows = rank(comparable, scores, deals, count, !!exact);
    const finalistSet = new Set(finalists);
    const finalistCount = sharedCount(finalists, scores);
    const ranked = finalists.length
      ? [
          ...rank(finalists, scores, deals, finalistCount),
          ...rows.filter(({ move }) => !finalistSet.has(move)),
        ].sort(compareUtility)
      : rows;
    const [best, ...others] = ranked;
    if (best && !exact) {
      for (const item of others) {
        item.utility.close = hunterClose(
          best.utility.weightedPlayPoints - item.utility.weightedPlayPoints,
          scores.get(best.move)!.slice(0, best.utility.samples),
          scores.get(item.move)!.slice(0, item.utility.samples),
        );
        best.utility.close ||= item.utility.close;
      }
    }
    return {
      ranked: ranked.slice(0, HUNTER_CANDIDATES),
      summary: {
        checked: comparable.length,
        limited,
        canContinue: phase !== "done",
        ceilingPass: phase === "ceilings",
        ceilings: ceilingSearch?.results(),
        finalistsRefined:
          finalistCount > count && finalists.length < comparable.length,
      } satisfies HunterSummary,
    };
  }

  async function run(
    signal: AbortSignal,
    progress: (value: HunterProgress) => void,
    budgetMs = BINGO_HUNTER_SLICE_MS,
  ) {
    signal.throwIfAborted();
    const deadline = now() + budgetMs;
    const workers = createCandidatePool(lexicon, limit, undefined, true);
    const stop = () => workers.close();
    signal.addEventListener("abort", stop, { once: true });
    let madeProgress = false;
    const report = (update: HunterStageProgress) =>
      progress({ ...update, stage: stages.indexOf(update.phase) + 1 });

    async function batch(
      slate: readonly Move[],
      scores: Scores,
      deals: BingoDeal[],
      target: number,
      label: HunterProgress["phase"],
    ) {
      const pending = slate.filter(
        (move) => (scores.get(move)?.length ?? 0) < target,
      );
      let checked = slate.length - pending.length;
      let dispatched = 0;
      let blocked = false;
      report({ phase: label, done: checked, total: slate.length });
      await workers.run(
        pending.map(
          (move): Extract<CandidateJob, { kind: "bingo-hunter" }> => ({
            kind: "bingo-hunter",
            position,
            move,
            beforeReply: label === "screen",
            deals: deals.slice(scores.get(move)?.length ?? 0, target),
            deadline,
            wavesRemaining: 1,
          }),
        ),
        ({ move }, result) => {
          if (result.kind !== "bingo-hunter")
            throw new Error(
              result.kind === "error"
                ? result.message
                : "Bingo hunter could not finish a search.",
            );
          const saved = scores.get(move) ?? [];
          if (result.outcomes.length) {
            madeProgress = true;
            saved.push(...result.outcomes);
            scores.set(move, saved);
          }
          blocked ||= !!result.blocked;
          if (saved.length >= target) checked++;
          report({ phase: label, done: checked, total: slate.length });
        },
        (job) => {
          if (now() >= deadline || blocked) return undefined;
          const wavesRemaining = Math.ceil(
            (pending.length - dispatched++) / limit,
          );
          return { ...job, wavesRemaining };
        },
      );
      signal.throwIfAborted();
      if (blocked) {
        limited = true;
        phase = "done";
        return false;
      }
      return checked === slate.length;
    }

    try {
      while (phase !== "done" && now() < deadline) {
        switch (phase) {
          case "exact":
            if (
              !(await batch(
                candidates,
                exactScores,
                exact!,
                exact!.length,
                "exact",
              ))
            )
              return finish();
            phase = "done";
            break;
          case "screen":
            if (
              !(await batch(
                wide.screen,
                boardScores,
                draws,
                SCREEN_DEALS,
                "screen",
              ))
            )
              return finish();
            phase = "screen-replies";
            break;
          case "screen-replies":
            if (
              !(await batch(
                wide.screen,
                replyScores,
                common,
                REPLY_SCREEN_DEALS,
                "screen-replies",
              ))
            )
              return finish();
            shortlist();
            phase = "sample";
            break;
          case "sample":
            if (
              !(await batch(
                candidates,
                replyScores,
                common,
                HUNTER_INITIAL,
                "sample",
              ))
            )
              return finish();
            finalists = chooseHunterFinalists(
              rank(candidates, replyScores, common, HUNTER_INITIAL),
            ).map(({ move }) => move);
            phase = "checkpoint";
            break;
          case "checkpoint":
            if (
              !(await batch(
                finalists,
                replyScores,
                common,
                HUNTER_CHECKPOINT,
                "checkpoint",
              ))
            )
              return finish();
            phase = "refine";
            break;
          case "refine":
            if (
              !(await batch(
                finalists,
                replyScores,
                common,
                HUNTER_MAX,
                "refine",
              ))
            )
              return finish();
            // Publish the normal ranking before spending time on long shots.
            phase = "ceilings";
            return finish();
          case "ceilings": {
            ceilingSearch ??= createBingoCeilingSearch(position,
              [...new Set([...wide.laneOrder, ...wide.screen])], pool, opponentSize);
            const extra = await ceilingSearch.run(workers, deadline, signal, report);
            madeProgress ||= extra.advanced;
            if (extra.done) phase = "done";
            return finish();
          }
        }
      }
      return finish();
    } finally {
      signal.removeEventListener("abort", stop);
      stop();
    }

    function finish() {
      if (phase !== "done" && budgetMs > 0 && !madeProgress && stalled) {
        limited = true;
        phase = "done";
      }
      stalled = budgetMs > 0 && !madeProgress;
      return snapshot();
    }
  }

  return { run };
}

export function runBingoHunter(
  lexicon: Lexicon,
  position: HunterPosition,
  moves: readonly Move[],
  odds: RackOdds | undefined,
  workerLimit: number,
  signal: AbortSignal,
  progress: (value: HunterProgress) => void,
) {
  return createBingoHunterSession(
    lexicon,
    position,
    moves,
    odds,
    workerLimit,
  ).run(signal, progress);
}
