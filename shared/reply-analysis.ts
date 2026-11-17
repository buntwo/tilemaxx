import {
  crossplayFinalRound,
  endgameStreaks,
  nextEndgameStreak,
  rackPoints,
  searchEmptyBagCandidate,
  solveEmptyBag,
  validEndgameStreak,
  type EndgameLine,
  type EndgameSettings,
} from "./endgame";
import type { Lexicon } from "./lexicon";
import type { Board, BoardTemplate, Move, Position } from "./model";
import { placeTiles, randomGenerator, sampleTiles } from "./move-analysis";
import { rackLetters } from "./rack-entry";
import {
  BIG_REPLY_SCORE,
  prepareSolver,
  SEARCH_LIMITS,
  SearchLimitError,
  type PremiumReply,
} from "./solver";
import { choose, unseenTiles } from "./tile-pool";

export const REPLY_LIMIT = 20;
export const REPLY_SAMPLES = 500;
export const REPLY_REFINED_SAMPLES = 5_000;
export const REPLY_SUMMARY_TIME_MS = 5_000;
export const REPLY_DETAIL_TIME_MS = 25_000;
export const REPLY_BUCKETS = [
  "0–19",
  "20–29",
  "30–39",
  "40–49",
  "50+",
] as const;
const EXACT_RACK_LIMIT = 1_000;

export interface ReplyHotspot {
  square: number;
  count: number;
  examples: { play: PremiumReply; count: number }[];
}

export interface ReplyHeatmap {
  squares: ReplyHotspot[];
  reference: { square: number; count: number }[];
}

export interface ReplyDistribution {
  kind: "distribution";
  mean: number;
  buckets: number[];
  difference: number;
  discordant: number[];
  outscored: number;
  count: number;
  exact: boolean;
  reference: { mean: number; buckets: number[] };
  heatmap?: ReplyHeatmap;
}

export interface ExactReply {
  kind: "empty-bag";
  rack: string;
  highest: Move | null;
  reply: Move | null;
  ends: "you" | "opponent" | "scoreless" | "final-turns" | null;
  yourAdjustment: number;
  opponentAdjustment: number;
  difference: number | null;
}

export type ReplyResult = ReplyDistribution | ExactReply;
type RackSample = { rack: string; weight: number };

export interface ReplySearchLimit {
  reason: "analysis-time" | "rack-time" | "nodes" | "moves";
  move: Pick<Move, "word" | "row" | "col" | "direction">;
  rack: string;
}

export class ReplySearchLimitError extends Error {
  constructor(readonly limit: ReplySearchLimit) {
    super("The reply search reached a limit.");
  }
}

export interface ReplyPosition extends Position, EndgameSettings {
  template: BoardTemplate;
  bagSize: number;
}

export type ReplyDetailOptions =
  | { kind: "reply-histogram" }
  | {
      kind: "reply-detail";
      samples: typeof REPLY_SAMPLES | typeof REPLY_REFINED_SAMPLES;
      captureHeatmap: boolean;
    }
  | { kind: "reply-line" };

export type ReplyRequest = ReplyPosition & {
  id: number;
  dictionaryId: string;
  reference: Move;
} & (
    | { kind: "reply-summary"; candidates: Move[]; workerLimit?: number }
    | (ReplyDetailOptions & { candidate: Move })
  );

export type ReplyWorkerMessage = {
  id: number;
  kind: ReplyRequest["kind"];
  moveId?: string;
  result?: ReplyResult;
  line?: EndgameLine;
  done?: boolean;
  error?: string;
  limit?: ReplySearchLimit;
};

export function replyColor(result: ReplyDistribution, index: number) {
  const delta =
    (result.buckets[index] - result.reference.buckets[index]) / result.count;
  const noise = result.exact
    ? 0
    : 2 *
      Math.sqrt(
        Math.max(0, result.discordant[index] / result.count - delta ** 2) /
          Math.max(1, result.count - 1),
      );
  if (Math.abs(delta) <= Math.max(0.03, noise)) return "similar";
  return delta > 0 ? "more" : "less";
}

export function replyPosition(position: ReplyPosition) {
  const { template, bagSize, scorelessTurns } = position;
  const unseen = unseenTiles(position, template);
  const rackSize = unseen.total - bagSize;
  if (unseen.excess.length)
    throw new Error("Some entered tiles exceed the starting tile counts.");
  if (
    !Number.isInteger(bagSize) ||
    bagSize < 0 ||
    rackSize < 0 ||
    rackSize > template.rackSize
  )
    throw new Error(
      "Enter a bag count that leaves up to one full opponent rack.",
    );
  if (!validEndgameStreak(template.rules, scorelessTurns))
    throw new Error("Enter a valid number of prior passes or scoreless turns.");
  const pool = unseen.tiles.flatMap(({ symbol, count }) =>
    Array<string>(count).fill(symbol),
  );
  return { pool, rackSize, bagSize };
}

function racksFor(pool: string[], rackSize: number, samples: number) {
  if (choose(pool.length, rackSize) <= EXACT_RACK_LIMIT) {
    const weights = new Map<string, number>();
    function visit(start: number, rack: string) {
      if (rack.length === rackSize) {
        weights.set(rack, (weights.get(rack) ?? 0) + 1);
        return;
      }
      for (let i = start; i <= pool.length - rackSize + rack.length; i++)
        visit(i + 1, rack + pool[i]);
    }
    visit(0, "");
    return {
      racks: Array.from(weights, ([rack, weight]) => ({ rack, weight })),
      exact: true,
    };
  }
  // Keep the same rack sequence for every move, including refined comparisons.
  const random = randomGenerator(0xbad98a6);
  const weights = new Map<string, number>();
  for (let i = 0; i < samples; i++) {
    const rack = [...sampleTiles(pool, rackSize, random)].sort().join("");
    weights.set(rack, (weights.get(rack) ?? 0) + 1);
  }
  const racks: RackSample[] = Array.from(weights, ([rack, weight]) => ({
    rack,
    weight,
  }));
  return { racks, exact: false };
}

function bucket(score: number) {
  return Math.max(0, Math.min(4, Math.floor(score / 10) - 1));
}

function limit(until: number) {
  const maxMs = Math.min(SEARCH_LIMITS.maxMs, until - performance.now());
  if (maxMs <= 0) throw new SearchLimitError("time");
  return { maxMs };
}

function searchReplyRack<T>(
  move: Move,
  rack: string,
  deadline: () => number,
  search: (rack: string, limits: { maxMs: number }) => T,
) {
  const remaining = deadline() - performance.now();
  try {
    if (remaining <= 0) throw new SearchLimitError("time");
    return search(rack, { maxMs: Math.min(SEARCH_LIMITS.maxMs, remaining) });
  } catch (error) {
    if (!(error instanceof SearchLimitError) || !error.reason) throw error;
    const { word, row, col, direction } = move;
    const timeReason =
      remaining <= SEARCH_LIMITS.maxMs ? "analysis-time" : "rack-time";
    throw new ReplySearchLimitError({
      reason: error.reason === "time" ? timeReason : error.reason,
      move: { word, row, col, direction },
      rack,
    });
  }
}

export function prepareReplyAnalysis(
  lexicon: Lexicon,
  position: ReplyPosition,
  reference: Move,
  samples: number,
  deadline: () => number,
  captureHeatmap = false,
) {
  const {
    board,
    template,
    scorelessTurns,
    opponentHasFinalTurn = true,
  } = position;
  const { pool, rackSize, bagSize } = replyPosition(position);
  const rack = pool.join("");
  const rule = endgameStreaks[template.rules];
  function opponentMoves(candidate: Move) {
    const solver = prepareSolver(lexicon, placeTiles(board, candidate), template);
    return searchReplyRack(candidate, rack, deadline, (letters, budget) =>
      solver.solve(letters, budget, { unsorted: true }),
    );
  }
  function endgame(candidate: Move): Omit<ExactReply, "difference"> {
    if (!rule) {
      const replies = opponentHasFinalTurn
        ? opponentMoves(candidate)
        : undefined;
      const reply = crossplayFinalRound(candidate, replies).line[1] ?? null;
      return {
        kind: "empty-bag",
        rack,
        highest: reply,
        reply,
        ends: "final-turns",
        yourAdjustment: 0,
        opponentAdjustment: 0,
      };
    }
    const yourLeave = rackPoints(candidate.leave, template.rules);
    const theirLeave = rackPoints(rack, template.rules);
    let ends: ExactReply["ends"] = null;
    let highest: Move | null = null;
    let reply: Move | null = null;
    let yourAdjustment = 0,
      opponentAdjustment = 0;
    const beforeReply = nextEndgameStreak(rule, scorelessTurns, candidate);
    if (!candidate.leave) {
      ends = "you";
      yourAdjustment = theirLeave;
      opponentAdjustment = -theirLeave;
    } else if (beforeReply >= rule.limit) {
      ends = "scoreless";
      yourAdjustment = -yourLeave;
      opponentAdjustment = -theirLeave;
    } else {
      const options = opponentMoves(candidate);
      let bestSwing =
        beforeReply + 1 >= rule.limit ? yourLeave - theirLeave : 0;
      for (const move of options) {
        if (!highest || move.score > highest.score) highest = move;
        const swing =
          move.score +
          (!move.leave
            ? 2 * yourLeave
            : nextEndgameStreak(rule, beforeReply, move) >= rule.limit
              ? yourLeave - rackPoints(move.leave, template.rules)
              : 0);
        if (
          swing > bestSwing ||
          (swing === bestSwing && (!reply || move.score > reply.score))
        ) {
          bestSwing = swing;
          reply = move;
        }
      }
      if (reply && !reply.leave) {
        ends = "opponent";
        yourAdjustment = -yourLeave;
        opponentAdjustment = yourLeave;
      } else if (nextEndgameStreak(rule, beforeReply, reply) >= rule.limit) {
        ends = "scoreless";
        yourAdjustment = -yourLeave;
        opponentAdjustment = -rackPoints(reply?.leave ?? rack, template.rules);
      }
    }
    return {
      kind: "empty-bag",
      rack,
      highest,
      reply,
      ends,
      yourAdjustment,
      opponentAdjustment,
    };
  }
  if (!bagSize) {
    const baseline = endgame(reference);
    return (candidate: Move): ReplyResult => {
      const result =
        candidate.id === reference.id ? baseline : endgame(candidate);
      return {
        ...result,
        difference:
          result.ends === "you" ||
          (result.ends === "scoreless" && !result.highest) ||
          baseline.ends === "you"
            ? null
            : (result.highest?.score ?? 0) - (baseline.highest?.score ?? 0),
      };
    };
  }

  const samplesForBoard = racksFor(pool, rackSize, samples);
  const summarize = (candidate: Move) =>
    summarizeReplyBoard(
      lexicon,
      position,
      candidate,
      samplesForBoard,
      deadline,
      captureHeatmap,
    );
  const baseline = summarize(reference);
  return (candidate: Move): ReplyDistribution =>
    compareReplyBoards(
      candidate.id === reference.id ? baseline : summarize(candidate),
      baseline,
      samplesForBoard,
      captureHeatmap,
    );
}

type ReplyRacks = ReturnType<typeof racksFor>;

export function sampleReplyRacks(
  position: ReplyPosition,
  samples: number,
): ReplyRacks {
  const { pool, rackSize } = replyPosition(position);
  return racksFor(pool, rackSize, samples);
}

export function summarizeReplyBoard(
  lexicon: Lexicon,
  { board, template }: ReplyPosition,
  candidate: Move,
  { racks }: ReplyRacks,
  deadline: () => number,
  captureHeatmap = false,
) {
  const count = racks.reduce((sum, { weight }) => sum + weight, 0);
  const solver = prepareSolver(lexicon, placeTiles(board, candidate), template);
  const buckets = Array<number>(REPLY_BUCKETS.length).fill(0);
  const bucketByRack = new Uint8Array(racks.length);
  const hotspots = new Map<
    number,
    {
      count: number;
      examples: Map<string, { play: PremiumReply; count: number }>;
    }
  >();
  const seen = new Uint32Array(board.length);
  let sum = 0;
  let outscored = 0;
  for (const [i, { rack, weight }] of racks.entries()) {
    let score: number;
    if (captureHeatmap) {
      const summary = searchReplyRack(
        candidate,
        rack,
        deadline,
        solver.summarizeReply,
      );
      score = summary.score;
      for (const play of summary.bigReplies) {
        const key = play.tiles
          .map(({ index, letter }) => `${index}:${letter}`)
          .join(",");
        for (const { index } of play.tiles) {
          let hotspot = hotspots.get(index);
          if (!hotspot) {
            hotspot = { count: 0, examples: new Map() };
            hotspots.set(index, hotspot);
          }
          // Every physical rack contributes once to each square, even when
          // several equally strong replies use it.
          if (seen[index] !== i + 1) {
            hotspot.count += weight;
            seen[index] = i + 1;
          }
          const existing = hotspot.examples.get(key);
          if (existing) existing.count += weight;
          else hotspot.examples.set(key, { play, count: weight });
        }
      }
    } else {
      score = searchReplyRack(candidate, rack, deadline, solver.bestScore);
    }
    const index = bucket(score);
    buckets[index] += weight;
    bucketByRack[i] = index;
    sum += score * weight;
    if (score > candidate.score) outscored += weight;
  }
  const squares = Array.from(hotspots, ([square, { count, examples }]) => {
    const ranked = [...examples.values()].sort(
      (a, b) => b.count - a.count || b.play.score - a.play.score,
    );
    return {
      square,
      count,
      examples: ranked.slice(0, 3),
    };
  }).sort((a, b) => b.count - a.count || a.square - b.square);
  return { mean: sum / count, buckets, bucketByRack, squares, outscored };
}

export function compareReplyBoards(
  board: ReturnType<typeof summarizeReplyBoard>,
  baseline: ReturnType<typeof summarizeReplyBoard>,
  { racks, exact }: ReplyRacks,
  captureHeatmap = false,
): ReplyDistribution {
  const discordant = Array<number>(REPLY_BUCKETS.length).fill(0);
  let count = 0;
  for (const [i, { weight }] of racks.entries()) {
    count += weight;
    const index = board.bucketByRack[i];
    const referenceIndex = baseline.bucketByRack[i];
    if (index !== referenceIndex) {
      discordant[index] += weight;
      discordant[referenceIndex] += weight;
    }
  }
  return {
    kind: "distribution",
    mean: board.mean,
    buckets: board.buckets,
    difference: board.mean - baseline.mean,
    discordant,
    outscored: board.outscored,
    count,
    exact,
    reference: { mean: baseline.mean, buckets: baseline.buckets },
    ...(captureHeatmap && {
      heatmap: {
        squares: board.squares,
        reference: baseline.squares.map(({ square, count }) => ({
          square,
          count,
        })),
      },
    }),
  };
}

export { BIG_REPLY_SCORE };

export function replyEndgameLine(
  lexicon: Lexicon,
  position: ReplyPosition,
  candidate: Move,
  timeLimitMs: number,
  positionLimit?: number,
) {
  const { pool, bagSize } = replyPosition(position);
  const { board, template } = position;
  if (bagSize !== 0)
    throw new Error("Full endgame lines require an empty bag.");
  return solveEmptyBag(
    board,
    candidate,
    pool.join(""),
    template,
    position,
    endgameSearch(lexicon, template),
    placeTiles,
    { timeLimitMs, positionLimit },
  );
}

function endgameSearch(lexicon: Lexicon, template: BoardTemplate) {
  const cache = new WeakMap<Board, ReturnType<typeof prepareSolver>>();
  return (board: Board, rack: string, deadline: number) => {
    let solver = cache.get(board);
    if (!solver) {
      solver = prepareSolver(lexicon, board, template);
      cache.set(board, solver);
    }
    return solver.solve(rack, limit(deadline), { unsorted: true });
  };
}

export type OpponentEndgamePosition = Pick<
  ReplyPosition, "board" | "rack" | "template" | "scorelessTurns"
> & { opponentRack: string };

export function opponentEndgameLine(
  lexicon: Lexicon,
  position: OpponentEndgamePosition,
  candidate: Move | null,
  timeLimitMs: number,
  minimumSpread?: number,
): EndgameLine | undefined {
  const { board, template, rack, opponentRack } = position;
  const result = searchEmptyBagCandidate(
    board,
    candidate,
    candidate?.leave ?? opponentRack,
    rackLetters(rack),
    template,
    position,
    endgameSearch(lexicon, template),
    placeTiles,
    { timeLimitMs, positionLimit: Infinity, minimumSpread },
  );
  if (result) {
    return {
      line: result.line,
      spread: -result.spread || 0,
      points: { you: result.points.opponent, opponent: result.points.you },
    };
  }
}
