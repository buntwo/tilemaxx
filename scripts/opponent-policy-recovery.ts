import { Lexicon } from "../shared/lexicon";
import { emptyBoard, type BoardTemplate, type Move } from "../shared/model";
import {
  placeTiles,
  randomGenerator,
  sampleTiles,
} from "../shared/move-analysis";
import {
  analyzeOpponentPolicy,
  type PolicyProbabilities,
} from "../shared/opponent-policy";
import { solve } from "../shared/solver";
import { TILE_SYMBOLS } from "../shared/tile-pool";

const random = randomGenerator(671842);
const trials = 30;
const positionsPerTrial = 24;
const solverShare = 0.2;
const policies = ["topOne", "uniformTopFive", "weightedTopFive"] as const;
type Policy = (typeof policies)[number];
type Generator = Policy | "mixed";
type Scenario = "clear gaps" | "near ties" | "equal scores";

function shuffled(moves: readonly Move[]) {
  const order = [...moves];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// Simulate by shuffling actual tied placements and drawing a move independently
// of the analyzer's closed-form tie handling and rack probabilities.
function generate(moves: Move[], generator: Generator) {
  const policy =
    generator === "mixed"
      ? random() < solverShare
        ? "topOne"
        : "uniformTopFive"
      : generator;
  const ranked = shuffled(moves).sort((a, b) => b.score - a.score);
  const top = ranked[0].score;
  const candidates =
    policy === "topOne"
      ? ranked.filter(({ score }) => score === top)
      : ranked.slice(0, 5);
  if (policy !== "weightedTopFive")
    return candidates[Math.floor(random() * candidates.length)];
  const weights = candidates.map(({ score }) => Math.exp((score - top) / 5));
  let threshold = weights.reduce((sum, weight) => sum + weight, 0) * random();
  for (const [index, weight] of weights.entries()) {
    threshold -= weight;
    if (threshold < 0) return candidates[index];
  }
  return candidates.at(-1)!;
}

const lexicons = {
  "clear gaps": new Lexicon([
    "AA",
    "AE",
    "AT",
    "ATE",
    "AX",
    "AXE",
    "EAT",
    "EX",
    "QAT",
    "TA",
    "TAX",
    "TE",
    "TEA",
  ]),
  "near ties": new Lexicon([
    "AA",
    "AE",
    "AI",
    "AN",
    "AT",
    "ATE",
    "EAT",
    "IN",
    "IT",
    "NA",
    "NE",
    "TA",
    "TE",
    "TEA",
    "TI",
  ]),
  "equal scores": new Lexicon(["AT"]),
};

function fixture(scenario: Scenario) {
  const available = [
    ...(scenario === "clear gaps"
      ? "AATEXQ"
      : scenario === "near ties"
        ? "AATEIN"
        : "ATAA"),
  ];
  const flat = scenario === "equal scores";
  const open = !flat && random() < 0.5;
  const opening = open ? "TE" : "";
  const inventory = [...available, ...opening];
  const template: BoardTemplate = {
    id: "recovery",
    name: "Recovery fixture",
    size: 5,
    start: 12,
    rackSize: flat ? 2 : 3,
    bingo: 0,
    rules: "scrabble",
    premiums: Array(25).fill(""),
    tileCounts: Object.fromEntries(
      TILE_SYMBOLS.map((symbol) => [
        symbol,
        inventory.filter((tile) => tile === symbol).length,
      ]),
    ),
  };
  if (scenario === "clear gaps") {
    template.premiums[12] = "DW";
    template.premiums[[7, 11, 13, 17][Math.floor(random() * 4)]] = "TL";
  }
  const lexicon = lexicons[scenario];
  let board = emptyBoard(5);
  if (opening) {
    const starts = solve(lexicon, board, opening, template).filter(
      ({ word }) => word === opening,
    );
    board = placeTiles(board, starts[Math.floor(random() * starts.length)]);
  }
  const rack = sampleTiles(available, template.rackSize, random);
  const moves = solve(lexicon, board, rack, template);
  if (moves.length === 0) return;
  const gap = moves[0].score - moves[Math.min(4, moves.length - 1)].score;
  if (scenario === "clear gaps" && gap < 5) return;
  if (scenario === "near ties" && gap > 2) return;
  const observer = [...available];
  for (const tile of rack) observer.splice(observer.indexOf(tile), 1);
  return { board, template, lexicon, moves, observerRack: observer.join("") };
}

function logProbs(probabilities: PolicyProbabilities) {
  return {
    topOne: Math.log(probabilities.topOne),
    uniformTopFive: Math.log(probabilities.uniformTopFive),
    weightedTopFive: Math.log(probabilities.weightedTopFive),
    mixed: Math.log(
      solverShare * probabilities.topOne +
        (1 - solverShare) * probabilities.uniformTopFive,
    ),
  };
}

type LogScores = ReturnType<typeof logProbs>;
function accumulator(): LogScores {
  return { topOne: 0, uniformTopFive: 0, weightedTopFive: 0, mixed: 0 };
}

function winningPolicies(scores: LogScores, mixed: boolean) {
  const candidates: Generator[] = mixed
    ? [...policies, "mixed"]
    : [...policies];
  const best = Math.max(...candidates.map((policy) => scores[policy]));
  if (best === -Infinity)
    throw new Error("Every candidate assigned a move zero likelihood.");
  return candidates.filter((policy) => best - scores[policy] < 1e-10);
}

function run(scenario: Scenario, generator: Generator) {
  const results = {
    visible: new Map<string, number>(),
    hidden: new Map<string, number>(),
  };
  for (let trial = 0; trial < trials; trial++) {
    const scores = { visible: accumulator(), hidden: accumulator() };
    for (let i = 0; i < positionsPerTrial; i++) {
      let position = fixture(scenario);
      while (!position) position = fixture(scenario);
      const { board, template, lexicon, moves, observerRack } = position;
      const { word, tiles } = generate(moves, generator);
      for (const view of ["visible", "hidden"] as const) {
        const result = analyzeOpponentPolicy(lexicon, {
          position: {
            board,
            tiles,
            observerRack: view === "visible" ? observerRack : undefined,
          },
          template,
          word,
        });
        if (
          result.kind !== "exact" ||
          (view === "visible" && result.rack.source !== "exact")
        )
          throw new Error("Expected an exact fixture likelihood.");
        const logs = logProbs(result.probabilities);
        for (const policy of [...policies, "mixed"] as const)
          scores[view][policy] += logs[policy] / positionsPerTrial;
      }
    }
    for (const view of ["visible", "hidden"] as const) {
      const winners = winningPolicies(scores[view], generator === "mixed");
      const key = winners.join(" / ");
      const counts = results[view];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return Object.fromEntries(
    Object.entries(results).map(([view, counts]) => [
      view,
      Object.fromEntries([...counts].sort(([, a], [, b]) => b - a)),
    ]),
  );
}

console.log(
  `${trials} batches of ${positionsPerTrial} independently seeded positions per generator and scenario. Entries count sole wins or ties by average log likelihood.`,
);
console.log(
  `Mixed generator uses top 1 on ${100 * solverShare}% of turns and uniform top 5 otherwise. Mixed likelihood is included as a fourth candidate in those batches.`,
);
for (const scenario of ["clear gaps", "near ties", "equal scores"] as const) {
  for (const generator of [...policies, "mixed"] as const)
    console.log(scenario, generator, JSON.stringify(run(scenario, generator)));
}
