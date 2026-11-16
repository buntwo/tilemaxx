import type { Lexicon } from "./lexicon";
import type { BoardTemplate, Move, Placement, TurnPosition } from "./model";
import { randomGenerator } from "./move-analysis";
import { playableRackPrior } from "./rack-prior";
import {
  classifyShortlist,
  shortlistConfidence,
  SHORTLIST_SAMPLE_CHECKPOINTS,
  type ShortlistConfidence,
} from "./shortlist-confidence";
import { prepareSolver, SEARCH_LIMITS, SearchLimitError } from "./solver";
import { unseenTiles } from "./tile-pool";

export const TOP_FIVE_SCORE_SCALE = 5;
const TOP_FIVE_SIZE = 5;
const MAX_SAMPLES = SHORTLIST_SAMPLE_CHECKPOINTS.at(-1)!;
const EXACT_RACK_LIMIT = 128;
const TIME_BUDGET_MS = 5_000;

export const OPPONENT_POLICY_LABELS = {
  topOne: "Top 1 by points",
  uniformTopFive: "Uniform top 5",
  weightedTopFive: "Score-weighted top 5",
};

type Policy = keyof typeof OPPONENT_POLICY_LABELS;
export type PolicyProbabilities = Record<Policy, number>;
const policies = Object.keys(OPPONENT_POLICY_LABELS) as Policy[];

function zeroProbabilities(): PolicyProbabilities {
  return { topOne: 0, uniformTopFive: 0, weightedTopFive: 0 };
}

type ScoredPlacement = Pick<Move, "id" | "score">;

export function placementKey(tiles: readonly Placement[]) {
  return tiles
    .map(({ index, letter }) => `${index}:${letter}`)
    .sort()
    .join(",");
}

/** A shortlist that splits a tie at its boundary always has the same weight sum. */
function placementPolicyFit(
  moves: readonly ScoredPlacement[],
  observed: string,
) {
  const distinct = new Map(moves.map(({ id, score }) => [id, score]));
  const observedScore = distinct.get(observed);
  const shortlistSize = Math.min(TOP_FIVE_SIZE, distinct.size);
  const random = distinct.size ? shortlistSize / distinct.size : 0;
  if (observedScore === undefined)
    return {
      probabilities: zeroProbabilities(),
      shortlist: { fit: 0, random },
    };
  const counts = new Map<number, number>();
  for (const score of distinct.values())
    counts.set(score, (counts.get(score) ?? 0) + 1);
  const scores = [...counts.keys()].sort((a, b) => b - a);
  const best = scores[0];
  const weight = (score: number) =>
    Math.exp((score - best) / TOP_FIVE_SCORE_SCALE);
  let remaining = shortlistSize;
  let totalWeight = 0;
  let inclusion = 0;
  for (const score of scores) {
    const tied = counts.get(score)!;
    const slots = Math.min(remaining, tied);
    if (score === observedScore) inclusion = slots / tied;
    totalWeight += slots * weight(score);
    remaining -= slots;
    if (!remaining) break;
  }
  return {
    probabilities: {
      topOne: observedScore === best ? 1 / counts.get(best)! : 0,
      uniformTopFive: inclusion / shortlistSize,
      weightedTopFive: (inclusion * weight(observedScore)) / totalWeight,
    },
    shortlist: { fit: inclusion, random },
  };
}

export function movePolicyProbabilities(
  moves: readonly ScoredPlacement[],
  observed: string,
): PolicyProbabilities {
  return placementPolicyFit(moves, observed).probabilities;
}

export interface OpponentPolicyInput {
  position: Pick<TurnPosition, "board" | "tiles" | "observerRack">;
  template: BoardTemplate;
  word: string;
}

type RackAssumptions = {
  source: "board" | "observer" | "exact";
  observerRack?: string;
  opponentRack?: string;
  rackSize: number;
  unseen: number;
};

type PolicyFinding = {
  higherScoringPlacement?: Pick<Move, "word" | "score">;
  playedScore?: number;
  topFiveRuledOut?: true;
  limited?: true;
};

export type OpponentPolicyResult = PolicyFinding &
  (
    | { kind: "unavailable"; reason: string }
    | {
        kind: "exact" | "sampled";
        probabilities: PolicyProbabilities;
        // Conditional on the rack containing the played tiles.
        shortlist?: { fit: number; random: number };
        rack: RackAssumptions;
        samples: number;
        confidence?: ShortlistConfidence;
      }
  );

export function opponentShortlistStatus(result?: OpponentPolicyResult) {
  if (!result || result.kind === "unavailable" || !result.shortlist)
    return undefined;
  if (result.topFiveRuledOut) return "low";
  if (result.kind === "exact") {
    const { fit, random } = result.shortlist;
    return classifyShortlist({
      fit: { lower: fit, upper: fit },
      random: { lower: random, upper: random },
    });
  }
  return result.confidence
    ? classifyShortlist(result.confidence)
    : "borderline";
}

export function analyzeOpponentPolicy(
  lexicon: Lexicon,
  { position, template, word }: OpponentPolicyInput,
  {
    samples,
    exactLimit = EXACT_RACK_LIMIT,
    maxMs = TIME_BUDGET_MS,
    seed = 69211,
  }: {
    samples?: number;
    exactLimit?: number;
    maxMs?: number;
    seed?: number;
  } = {},
): OpponentPolicyResult {
  const unavailable = (
    reason: string,
    finding: PolicyFinding = {},
    limited = false,
  ) =>
    ({
      kind: "unavailable",
      reason,
      ...finding,
      ...(limited && { limited: true as const }),
    }) as const;
  const { board, tiles, observerRack } = position;
  const { size } = template;
  if (board.length !== size ** 2)
    return unavailable("The saved board before this move is incomplete.");
  if (!tiles.length)
    return unavailable("Policy fit is available for tile placements only.");
  if (
    tiles.length > template.rackSize ||
    new Set(tiles.map(({ index }) => index)).size !== tiles.length ||
    tiles.some(
      ({ index, letter }) => board[index] !== "" || !/^[A-Za-z]$/.test(letter),
    )
  )
    return unavailable("The saved tile placement could not be replayed.");

  const deadline = performance.now() + maxMs;
  const solver = prepareSolver(lexicon, board, template);
  const solve = (rack: string) =>
    solver.solve(
      rack,
      {
        maxMs: Math.min(
          SEARCH_LIMITS.maxMs,
          Math.max(0, deadline - performance.now()),
        ),
      },
      { unsorted: true },
    );

  const required = tiles.map(({ letter }) =>
    letter === letter.toUpperCase() ? letter : "?",
  );
  const playedRack = required.sort().join("");
  const observed = placementKey(tiles);
  const finding: PolicyFinding = {};
  const cache = new Map<string, ReturnType<typeof placementPolicyFit>>();
  try {
    // Using only the played tiles also verifies the exact placement in the lexicon.
    const placements = solve(playedRack);
    const played = placements.find(({ id }) => id === observed);
    if (!played || (played.word !== word && !played.crosses.includes(word)))
      return unavailable(
        "The recorded placement was not recognized in the selected word list.",
      );
    finding.playedScore = played.score;
    let best = played;
    for (const move of placements)
      if (!move.leave && move.score > best.score) best = move;
    if (best !== played)
      finding.higherScoringPlacement = { word: best.word, score: best.score };
    const fit = placementPolicyFit(placements, observed);
    // Every placement this rack can make is also possible on a superset rack.
    if (fit.shortlist.fit === 0) finding.topFiveRuledOut = true;
    cache.set(playedRack, fit);
  } catch (error) {
    if (!(error instanceof SearchLimitError)) throw error;
    return unavailable(
      "The solver reached its limit while checking the recorded placement.",
      finding,
      true,
    );
  }

  const pool = unseenTiles({ board, rack: observerRack ?? "" }, template);
  if (pool.excess.length)
    return unavailable(
      "The saved tiles exceed the game's tile distribution.",
      finding,
    );
  const rackSize = Math.min(pool.total, template.rackSize);
  const knownRack =
    observerRack !== undefined && pool.total <= template.rackSize;
  const rack: RackAssumptions = {
    source: knownRack
      ? "exact"
      : observerRack !== undefined
        ? "observer"
        : "board",
    observerRack,
    opponentRack: knownRack
      ? pool.tiles.map(({ symbol, count }) => symbol.repeat(count)).join("")
      : undefined,
    rackSize,
    unseen: pool.total,
  };
  const prior = playableRackPrior(pool, rackSize, required);
  const probabilities = zeroProbabilities();
  if (!prior.total)
    return {
      kind: "exact",
      probabilities,
      rack,
      samples: 0,
      ...finding,
    };

  const exact = prior.enumerate(Math.min(EXACT_RACK_LIMIT, exactLimit));
  const sampleLimit = samples ?? MAX_SAMPLES;
  let confidence: ShortlistConfidence | undefined;
  let settled = false;
  const random = randomGenerator(seed);
  let completed = 0;
  const shortlist = { fit: 0, random: 0 };
  const accumulate = (hand: string, weight: number) => {
    let score = cache.get(hand);
    if (!score) {
      score = placementPolicyFit(solve(hand), observed);
      cache.set(hand, score);
    }
    for (const policy of policies)
      probabilities[policy] += weight * score.probabilities[policy];
    shortlist.fit += weight * score.shortlist.fit;
    shortlist.random += weight * score.shortlist.random;
  };

  try {
    if (exact) {
      for (const { rack: hand, weight } of exact)
        accumulate(hand, weight / prior.total);
    } else {
      while (completed < sampleLimit && performance.now() < deadline) {
        accumulate(prior.sample(random), 1);
        completed++;
        if (!SHORTLIST_SAMPLE_CHECKPOINTS.includes(completed)) continue;
        confidence = shortlistConfidence(
          {
            fit: shortlist.fit / completed,
            random: shortlist.random / completed,
          },
          completed,
        );
        if (finding.topFiveRuledOut) confidence.fit = { lower: 0, upper: 0 };
        // Explicit sample counts are used for fixed-size comparisons.
        if (
          samples === undefined &&
          classifyShortlist(confidence) !== "borderline"
        ) {
          settled = true;
          break;
        }
      }
    }
  } catch (error) {
    if (!(error instanceof SearchLimitError)) throw error;
    // Stop at the first failed rack. Skipping it would favor cheap searches.
    if (exact)
      return unavailable(
        "The solver reached its limit while enumerating possible racks.",
        finding,
        true,
      );
  }
  if (!exact && !completed)
    return unavailable(
      "The solver reached its limit before completing a rack sample.",
      finding,
      true,
    );

  const normalizer = exact ? 1 : completed;
  for (const policy of policies)
    probabilities[policy] = Math.min(
      1,
      (probabilities[policy] * prior.chance) / normalizer,
    );
  return {
    kind: exact ? "exact" : "sampled",
    probabilities,
    shortlist: {
      fit: Math.min(1, shortlist.fit / normalizer),
      random: Math.min(1, shortlist.random / normalizer),
    },
    rack,
    samples: completed,
    confidence,
    ...(!exact && !settled && completed < sampleLimit && { limited: true }),
    ...finding,
  };
}
