import assert from "node:assert/strict";
import type { OpponentPolicyUpdate, PracticeRequest } from "../src/practice.worker";
import { test } from "node:test";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard, type BoardTemplate } from "../shared/model";
import { randomGenerator } from "../shared/move-analysis";
import {
  analyzeOpponentPolicy,
  movePolicyProbabilities,
  opponentShortlistStatus,
  placementKey,
  type PolicyProbabilities,
} from "../shared/opponent-policy";
import { playableRackPrior } from "../shared/rack-prior";
import {
  classifyShortlist,
  shortlistConfidence,
} from "../shared/shortlist-confidence";
import { solve } from "../shared/solver";
import {
  rackContainsChance,
  TILE_SYMBOLS,
  unseenTiles,
} from "../shared/tile-pool";

const counts = (pool: string) =>
  Object.fromEntries(
    TILE_SYMBOLS.map((symbol) => [
      symbol,
      [...pool].filter((tile) => tile === symbol).length,
    ]),
  );

function template(pool: string, rackSize = 3): BoardTemplate {
  const premiums: BoardTemplate["premiums"] = Array(25).fill("");
  premiums[13] = "TL";
  return {
    id: "fixture",
    name: "Policy fixture",
    size: 5,
    premiums,
    start: 12,
    rackSize,
    bingo: 0,
    rules: "scrabble",
    tileCounts: counts(pool),
  };
}

function near(actual: number, expected: number, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} vs ${expected}`,
  );
}

function policySums(rows: PolicyProbabilities[]) {
  for (const policy of Object.keys(rows[0]) as (keyof PolicyProbabilities)[])
    near(
      rows.reduce((total, row) => total + row[policy], 0),
      1,
    );
}

test("point policies normalize and split top and shortlist ties fairly", () => {
  const moves = [30, 30, 25, 20, 20, 20, 10].map((score, i) => ({
    id: String(i),
    score,
  }));
  const [first, tie, third, boundary, boundary2, boundary3, outside] =
    moves.map(({ id }) => movePolicyProbabilities(moves, id));
  policySums([first, tie, third, boundary, boundary2, boundary3, outside]);
  assert.deepEqual(first, tie);
  assert.equal(first.topOne, 0.5);
  assert.equal(third.topOne, 0);
  assert.equal(first.uniformTopFive, 1 / 5);
  near(boundary.uniformTopFive, 2 / 15);
  assert.deepEqual(boundary, boundary2);
  assert.deepEqual(boundary, boundary3);
  const w = 2 + Math.exp(-1) + 2 * Math.exp(-2);
  near(first.weightedTopFive, 1 / w);
  near(third.weightedTopFive, Math.exp(-1) / w);
  near(boundary.weightedTopFive, ((2 / 3) * Math.exp(-2)) / w);
  assert.deepEqual(outside, {
    topOne: 0,
    uniformTopFive: 0,
    weightedTopFive: 0,
  });

  assert.deepEqual(
    movePolicyProbabilities([...moves].reverse(), "3"),
    boundary,
  );
  assert.deepEqual(movePolicyProbabilities([...moves, moves[0]], "0"), first);
  const short = moves.slice(0, 3);
  const shortRows = short.map(({ id }) => movePolicyProbabilities(short, id));
  policySums(shortRows);
  assert.ok(shortRows.every((row) => row.uniformTopFive === 1 / 3));
});

test("conditional prior preserves the multiplicity of repeated letters", () => {
  const pool = unseenTiles(
    { board: emptyBoard(5), rack: "" },
    template("AABC", 2),
  );
  const prior = playableRackPrior(pool, 2, ["A"]);
  assert.equal(prior.total, 5);
  near(prior.chance, 5 / 6);
  near(prior.chance, rackContainsChance(pool, 2, ["A"]));
  const hands = new Map(
    prior.enumerate(3)!.map(({ rack, weight }) => [rack, weight / prior.total]),
  );
  assert.deepEqual(
    hands,
    new Map([
      ["AA", 1 / 5],
      ["AB", 2 / 5],
      ["AC", 2 / 5],
    ]),
  );
  assert.equal(prior.enumerate(2), undefined);

  const random = randomGenerator(94251);
  const frequencies = new Map<string, number>();
  for (let i = 0; i < 20_000; i++) {
    const rack = prior.sample(random);
    frequencies.set(rack, (frequencies.get(rack) ?? 0) + 1);
  }
  assert.equal(frequencies.size, 3);
  for (const [rack, chance] of hands)
    near(frequencies.get(rack)! / 20_000, chance, 0.012);
  const repeated = playableRackPrior(pool, 2, ["A", "A"]);
  assert.deepEqual(repeated.enumerate(1), [{ rack: "AA", weight: 1 }]);
  near(repeated.chance, 1 / 6);
});

test("the solver finds a placement best on one rack and outside the first five on another", () => {
  const lexicon = new Lexicon(["AT", "AX", "TAX"]);
  const board = emptyBoard(5);
  const layout = template("AATX");
  const tiles = [
    { index: 12, letter: "A" },
    { index: 13, letter: "T" },
  ];
  const id = placementKey(tiles);
  assert.equal(solve(lexicon, board, "AAT", layout)[0].id, id);
  const competing = solve(lexicon, board, "ATX", layout);
  assert.ok(competing.findIndex((move) => move.id === id) >= 5);
  assert.ok(
    competing[4].score > competing.find((move) => move.id === id)!.score,
  );

  const input = { position: { board, tiles }, template: layout, word: "AT" };
  const exact = analyzeOpponentPolicy(lexicon, input);
  assert.equal(exact.kind, "exact");
  assert.equal(exact.rack.source, "board");
  near(exact.compatibleRackChance, 3 / 4);
  near(exact.conditionalProbabilities!.topOne, 1 / 3);
  near(exact.conditionalProbabilities!.uniformTopFive, 1 / 12);
  near(exact.probabilities.topOne, 1 / 4);
  near(exact.probabilities.uniformTopFive, 1 / 16);
  near(
    exact.probabilities.weightedTopFive,
    1 / (4 * (1 + 3 * Math.exp(-2 / 5))),
  );

  near(exact.shortlist!.fit, 1 / 3);
  near(exact.shortlist!.random, 1 / 3 + (2 / 3) * (5 / competing.length));
  assert.equal(exact.topFiveRuledOut, undefined);

  const sampled = analyzeOpponentPolicy(lexicon, input, {
    exactLimit: 0,
    samples: 4_000,
  });
  assert.equal(sampled.kind, "sampled");
  assert.equal(sampled.samples, 4_000);
  for (const policy of Object.keys(
    exact.probabilities,
  ) as (keyof PolicyProbabilities)[]) {
    near(sampled.probabilities[policy], exact.probabilities[policy], 0.015);
    near(
      sampled.probabilities[policy],
      sampled.conditionalProbabilities![policy] * sampled.compatibleRackChance,
    );
  }

  near(sampled.shortlist!.fit, exact.shortlist!.fit, 0.02);
  near(sampled.shortlist!.random, exact.shortlist!.random, 0.02);

  const known = analyzeOpponentPolicy(lexicon, {
    ...input,
    position: { ...input.position, observerRack: "X" },
  });
  assert.equal(known.kind, "exact");
  assert.equal(known.rack.opponentRack, "AAT");
  assert.equal(known.compatibleRackChance, 1);
  assert.deepEqual(known.conditionalProbabilities, known.probabilities);
  assert.equal(known.probabilities.topOne, 1);
  assert.deepEqual(known.shortlist, { fit: 1, random: 1 });
});

test("a full-rack placement keeps its prior probability and distinguishes assigned blanks", () => {
  const lexicon = new Lexicon(["AT"]);
  const board = emptyBoard(5);
  const layout = template("AA?T", 2);
  const input = {
    position: {
      board,
      tiles: [
        { index: 12, letter: "A" },
        { index: 13, letter: "t" },
      ],
    },
    template: layout,
    word: "AT",
  };
  const blank = analyzeOpponentPolicy(lexicon, input);
  assert.equal(blank.kind, "exact");
  assert.equal(blank.playedScore, 1);
  near(blank.probabilities.topOne, 1 / 12);
  near(blank.probabilities.uniformTopFive, 1 / 12);

  const real = analyzeOpponentPolicy(lexicon, {
    ...input,
    position: {
      board,
      tiles: [
        { index: 12, letter: "A" },
        { index: 13, letter: "T" },
      ],
    },
  });
  assert.equal(real.kind, "exact");
  assert.equal(real.playedScore, 4);
  near(real.probabilities.topOne, 1 / 3);
});

test("same-tile counterexample proves exact top-one zero even when sampled", () => {
  const lexicon = new Lexicon(["AT"]);
  const input = {
    position: {
      board: emptyBoard(5),
      tiles: [
        { index: 12, letter: "A" },
        { index: 17, letter: "T" },
      ],
    },
    template: template("AATX"),
    word: "AT",
  };
  const fit = analyzeOpponentPolicy(lexicon, input, {
    exactLimit: 0,
    samples: 10,
  });
  assert.equal(fit.kind, "sampled");
  assert.deepEqual(fit.higherScoringPlacement, { word: "AT", score: 4 });
  assert.equal(fit.probabilities.topOne, 0);
  assert.ok(fit.probabilities.uniformTopFive > 0);

  const unknown = analyzeOpponentPolicy(new Lexicon(["TO"]), input);
  assert.equal(unknown.kind, "unavailable");
  assert.match(unknown.reason, /selected word list/);
});

test("the shortlist weights ties at the boundary and excludes provable top-five misses", () => {
  const board = emptyBoard(5);
  const layout = template("AATEX", 4);
  const tiles = [
    { index: 7, letter: "A" },
    { index: 12, letter: "T" },
    { index: 17, letter: "E" },
  ];
  const input = { position: { board, tiles }, template: layout, word: "ATE" };
  const singleWord = new Lexicon(["ATE"]);
  const tied = analyzeOpponentPolicy(singleWord, input);
  assert.equal(tied.kind, "exact");
  // With two better placements, the remaining three slots are split four ways.
  near(tied.shortlist!.fit, 3 / 4);
  near(tied.shortlist!.random, 5 / 6);

  const alternatives = new Lexicon(["ATE", "EAT", "ETA", "TEA"]);
  const limited = analyzeOpponentPolicy(alternatives, input, {
    exactLimit: 0,
    samples: 10,
  });
  assert.equal(limited.kind, "sampled");
  assert.equal(limited.topFiveRuledOut, true);
  assert.equal(limited.shortlist?.fit, 0);
  near(limited.shortlist!.random, 5 / 24);
});

test("a rack conflict leaves the conditional shortlist undefined", () => {
  const lexicon = new Lexicon(["AT"]);
  const result = analyzeOpponentPolicy(lexicon, {
    word: "AT",
    position: {
      board: emptyBoard(5),
      tiles: [
        { index: 12, letter: "A" },
        { index: 13, letter: "T" },
      ],
    },
    template: template("AAA", 2),
  });
  assert.equal(result.kind, "exact");
  assert.equal(result.shortlist, undefined);
  assert.equal(result.compatibleRackChance, 0);
  assert.equal(result.conditionalProbabilities, undefined);
  assert.equal(result.probabilities.uniformTopFive, 0);
});

test("sampling bounds account for fractional scores, endpoints and both highlight thresholds", () => {
  const ended = shortlistConfidence({ fit: 1, random: 0 }, 128);
  assert.equal(ended.fit.upper, 1);
  assert.equal(ended.random.lower, 0);
  assert.ok(ended.fit.lower < 1);
  assert.ok(ended.random.upper > 0);
  assert.equal(classifyShortlist(ended), "high");

  const borderline = shortlistConfidence({ fit: 0.82, random: 0.1 }, 512);
  assert.ok(borderline.fit.lower < 0.8 && borderline.fit.upper > 0.8);
  assert.equal(classifyShortlist(borderline), "borderline");
  assert.equal(
    classifyShortlist(shortlistConfidence({ fit: 0.82, random: 0.1 }, 1024)),
    "borderline",
  );
  assert.equal(
    classifyShortlist(shortlistConfidence({ fit: 0.86, random: 0.1 }, 512)),
    "high",
  );
  assert.equal(
    classifyShortlist(shortlistConfidence({ fit: 0.7, random: 0.1 }, 512)),
    "low",
  );
  assert.equal(
    classifyShortlist(shortlistConfidence({ fit: 1, random: 0.25 }, 1024)),
    "borderline",
  );
  assert.equal(
    classifyShortlist(shortlistConfidence({ fit: 1, random: 0.5 }, 128)),
    "low",
  );
});

test("adaptive analysis stops at the first conclusive checkpoint", () => {
  const lexicon = new Lexicon([
    "AX",
    "AT",
    "TA",
    "ATE",
    "EAT",
    "ETA",
    "TEA",
    "AXE",
    "TAX",
    "EX",
    "AE",
    "ET",
    "TE",
  ]);
  const result = analyzeOpponentPolicy(
    lexicon,
    {
      word: "TAX",
      position: {
        board: emptyBoard(5),
        tiles: [
          { index: 11, letter: "T" },
          { index: 12, letter: "A" },
          { index: 13, letter: "X" },
        ],
      },
      template: template("AETX", 4),
    },
    { exactLimit: 0 },
  );
  assert.equal(result.kind, "sampled");
  assert.equal(result.samples, 128);
  assert.ok(result.confidence);
  assert.equal(result.confidence.samples, 128);
  assert.equal(opponentShortlistStatus(result), "high");
  assert.equal(result.limited, undefined);
});

test("adaptive analysis uses the final checkpoint for an unresolved threshold", () => {
  const lexicon = new Lexicon(["ATE", "EAT", "AT", "TA"]);
  const input = {
    word: "ATE",
    position: {
      board: emptyBoard(5),
      tiles: [
        { index: 11, letter: "A" },
        { index: 12, letter: "T" },
        { index: 13, letter: "E" },
      ],
    },
    template: template("AETBCDFGHJKLM", 7),
  };
  const result = analyzeOpponentPolicy(lexicon, input);
  assert.equal(result.kind, "sampled");
  assert.equal(result.samples, 1024);
  assert.deepEqual(result.shortlist, { fit: 1, random: 0.25 });
  assert.ok(result.confidence);
  assert.equal(result.confidence.samples, 1024);
  assert.equal(opponentShortlistStatus(result), "borderline");
  assert.equal(result.limited, undefined);

  const shorter = analyzeOpponentPolicy(lexicon, input, { samples: 64 });
  assert.equal(shorter.kind, "sampled");
  assert.equal(shorter.confidence, undefined);
  assert.equal(opponentShortlistStatus(shorter), "borderline");
});

test("policy timeline loads each historical word list once and continues past a missing list", async (t) => {
  const dictionaryFetches: string[] = [];
  const dictionaries: Record<string, string> = { first: "AT", second: "OX" };
  t.mock.method(globalThis, "fetch", async (url: string) => {
    const id = url.slice(url.lastIndexOf("/") + 1);
    dictionaryFetches.push(id);
    return dictionaries[id]
      ? new Response(dictionaries[id])
      : new Response(null, { status: 404 });
  });
  const updates: OpponentPolicyUpdate[] = [];
  const progress: number[] = [];
  let finished: { reachedTimeLimit: boolean } | undefined;
  const scope = {
    onmessage: undefined as
      | ((message: { data: PracticeRequest }) => Promise<void>)
      | undefined,
    postMessage(message:
      | { update: OpponentPolicyUpdate; progress: { completed: number } }
      | { result: { reachedTimeLimit: boolean } }
    ) {
      if ("update" in message) {
        updates.push(message.update);
        progress.push(message.progress.completed);
      } else finished = message.result;
    },
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, "self");
  Object.defineProperty(globalThis, "self", { configurable: true, value: scope });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "self", original);
    else Reflect.deleteProperty(globalThis, "self");
  });
  await import("../src/practice.worker");

  const rules = template("ATOX", 2);
  const input = (word: string) => ({
    position: {
      board: emptyBoard(rules.size),
      tiles: [...word].map((letter, offset) => ({ index: rules.start + offset, letter })),
    },
    template: rules,
    word,
  });
  await scope.onmessage!({
    data: {
      kind: "opponent-policy-timeline",
      turns: [
        { key: "a", dictionaryId: "first", input: input("AT") },
        { key: "b", dictionaryId: "missing", input: input("AT") },
        { key: "c", dictionaryId: "second", input: input("OX") },
        { key: "d", dictionaryId: "first", input: input("AT") },
      ],
      workerLimit: 1,
    },
  });
  assert.deepEqual(dictionaryFetches, ["first", "missing", "second"]);
  assert.deepEqual(
    Object.fromEntries(updates.map(({ key, result }) => [key, result.kind])),
    { a: "exact", b: "unavailable", c: "exact", d: "exact" },
  );
  assert.deepEqual(progress, [1, 2, 3, 4]);
  assert.deepEqual(finished, { reachedTimeLimit: false });
});
