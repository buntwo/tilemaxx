import { rackPoints, solveEmptyBag } from "./endgame";
import type { Lexicon } from "./lexicon";
import type { Board, BoardTemplate, Move, Position } from "./model";
import { placeTiles, randomGenerator, sampleTiles } from "./move-analysis";
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
  ends: "you" | "opponent" | "scoreless" | null;
  yourAdjustment: number;
  opponentAdjustment: number;
  difference: number | null;
}

export type ReplyResult = ReplyDistribution | ExactReply;
type RackSample = { rack: string; weight: number };

export interface ReplyPosition extends Position {
  template: BoardTemplate;
  bagSize: number;
  scorelessTurns: number;
}

export const replyScorelessLimit = (template: BoardTemplate) =>
  template.rules === "wwf" ? 3 : 6;

export type ReplyRequest = ReplyPosition & {
  id: number;
  dictionaryId: string;
  reference: Move;
} & (
    | { kind: "reply-summary"; candidates: Move[] }
    | { kind: "reply-refine" | "reply-line"; candidate: Move }
  );

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
  if (
    !Number.isInteger(scorelessTurns) ||
    scorelessTurns < 0 ||
    scorelessTurns >= replyScorelessLimit(template)
  )
    throw new Error("Enter a valid number of prior scoreless turns.");
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
  const racks: RackSample[] = Array.from({ length: samples }, () => ({
    rack: [...sampleTiles(pool, rackSize, random)].sort().join(""),
    weight: 1,
  }));
  return { racks, exact: false };
}

function bucket(score: number) {
  return Math.max(0, Math.min(4, Math.floor(score / 10) - 1));
}

function limit(until: number) {
  const maxMs = Math.min(SEARCH_LIMITS.maxMs, until - performance.now());
  if (maxMs <= 0) throw new SearchLimitError();
  return { maxMs };
}

export function prepareReplyAnalysis(
  lexicon: Lexicon,
  position: ReplyPosition,
  reference: Move,
  samples: number,
  deadline: () => number,
  captureHeatmap = false,
) {
  const { board, template, scorelessTurns } = position;
  const { pool, rackSize, bagSize } = replyPosition(position);
  const rack = pool.join("");
  const scorelessLimit = replyScorelessLimit(template);
  function endgame(candidate: Move): Omit<ExactReply, "difference"> {
    const yourLeave = rackPoints(candidate.leave, template.rules);
    const theirLeave = rackPoints(rack, template.rules);
    let ends: ExactReply["ends"] = null;
    let highest: Move | null = null;
    let reply: Move | null = null;
    let yourAdjustment = 0,
      opponentAdjustment = 0;
    const beforeReply = candidate.score ? 0 : scorelessTurns + 1;
    if (!candidate.leave) {
      ends = "you";
      yourAdjustment = theirLeave;
      opponentAdjustment = -theirLeave;
    } else if (beforeReply >= scorelessLimit) {
      ends = "scoreless";
      yourAdjustment = -yourLeave;
      opponentAdjustment = -theirLeave;
    } else {
      const solver = prepareSolver(
        lexicon,
        placeTiles(board, candidate),
        template,
      );
      const options = solver.solve(rack, limit(deadline()), { unsorted: true });
      let bestSwing =
        beforeReply + 1 >= scorelessLimit ? yourLeave - theirLeave : 0;
      for (const move of options) {
        if (!highest || move.score > highest.score) highest = move;
        const swing =
          move.score +
          (!move.leave
            ? 2 * yourLeave
            : !move.score && beforeReply + 1 >= scorelessLimit
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
      } else if (!reply?.score && beforeReply + 1 >= scorelessLimit) {
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

  const { racks, exact } = racksFor(pool, rackSize, samples);
  const count = racks.reduce((sum, { weight }) => sum + weight, 0);
  function summarize(candidate: Move, referenceScores?: Uint8Array) {
    const solver = prepareSolver(
      lexicon,
      placeTiles(board, candidate),
      template,
    );
    const buckets = Array<number>(REPLY_BUCKETS.length).fill(0);
    const discordant = [...buckets];
    const bucketByRack = new Uint8Array(racks.length);
    const scores = new Map<
      string,
      { score: number; bigReply?: PremiumReply }
    >();
    const hotspots = new Map<
      number,
      Map<string, { play: PremiumReply; count: number }>
    >();
    let sum = 0;
    for (const [i, { rack, weight }] of racks.entries()) {
      let summary = scores.get(rack);
      if (!summary) {
        summary = captureHeatmap
          ? solver.summarizeReply(rack, limit(deadline()))
          : solver.summarize(rack, limit(deadline()));
        scores.set(rack, summary);
      }
      const { score, bigReply } = summary;
      if (bigReply) {
        const key = bigReply.tiles
          .map(({ index, letter }) => `${index}:${letter}`)
          .join(",");
        for (const { index } of bigReply.tiles) {
          let examples = hotspots.get(index);
          if (!examples) {
            examples = new Map();
            hotspots.set(index, examples);
          }
          const existing = examples.get(key);
          if (existing) existing.count += weight;
          else examples.set(key, { play: bigReply, count: weight });
        }
      }
      const index = bucket(score);
      buckets[index] += weight;
      bucketByRack[i] = index;
      sum += score * weight;
      if (referenceScores && referenceScores[i] !== index) {
        discordant[referenceScores[i]] += weight;
        discordant[index] += weight;
      }
    }
    const squares = Array.from(hotspots, ([square, examples]) => {
      const ranked = [...examples.values()].sort(
        (a, b) => b.count - a.count || b.play.score - a.play.score,
      );
      return {
        square,
        count: ranked.reduce((total, example) => total + example.count, 0),
        examples: ranked.slice(0, 3),
      };
    }).sort((a, b) => b.count - a.count || a.square - b.square);
    return { mean: sum / count, buckets, discordant, bucketByRack, squares };
  }
  const baseline = summarize(reference);
  return (candidate: Move): ReplyDistribution => {
    const { mean, buckets, discordant, squares } =
      candidate.id === reference.id
        ? baseline
        : summarize(candidate, baseline.bucketByRack);
    return {
      kind: "distribution",
      mean,
      buckets,
      difference: mean - baseline.mean,
      discordant,
      count,
      exact,
      reference: { mean: baseline.mean, buckets: baseline.buckets },
      ...(captureHeatmap && {
        heatmap: {
          squares,
          reference: baseline.squares.map(({ square, count }) => ({
            square,
            count,
          })),
        },
      }),
    };
  };
}

export { BIG_REPLY_SCORE };

export function replyEndgameLine(
  lexicon: Lexicon,
  position: ReplyPosition,
  candidate: Move,
  deadline: number,
) {
  const { pool, bagSize } = replyPosition(position);
  const { board, template, scorelessTurns } = position;
  if (bagSize !== 0 || template.rules !== "scrabble")
    throw new Error("Full endgame lines require an empty Scrabble bag.");
  const cache = new WeakMap<Board, ReturnType<typeof prepareSolver>>();
  return solveEmptyBag(
    board,
    candidate,
    pool.join(""),
    template,
    scorelessTurns,
    (board, rack) => {
      let solver = cache.get(board);
      if (!solver) {
        solver = prepareSolver(lexicon, board, template);
        cache.set(board, solver);
      }
      return solver.solve(rack, limit(deadline), { unsorted: true });
    },
    placeTiles,
  );
}
