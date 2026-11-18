import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createHunterEvaluator,
  exactHunterDeals,
  hunterUtility,
  sampleHunterDeals,
} from "../shared/bingo-hunter";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard, isBingo } from "../shared/model";
import { randomGenerator } from "../shared/move-analysis";
import { PRESETS } from "../shared/presets";
import { TILE_SYMBOLS } from "../shared/tile-pool";
import { prepareSolver } from "../shared/solver";
import { runBingoHunter } from "../src/parallel-bingo-hunter";

test("shared deals conserve tiles and exact deals weight duplicate physical copies", () => {
  const pool = ["A", "A", "E", "T"];
  const exact = exactHunterDeals(pool, 2);
  assert.equal(
    exact.reduce((sum, deal) => sum + deal.weight!, 0),
    12,
  );
  assert.equal(
    exact.find(({ bag, opponent }) => bag === "AE" && opponent === "AT")
      ?.weight,
    2,
  );
  const samples = sampleHunterDeals(pool, 2, 2, 100, randomGenerator(5));
  assert.deepEqual(
    samples,
    sampleHunterDeals(pool, 2, 2, 100, randomGenerator(5)),
  );
  for (const { opponent, bag } of [...exact, ...samples]) {
    assert.equal(opponent.length, 2);
    assert.equal(bag.length, 2);
    assert.deepEqual([...(opponent + bag)].sort(), pool);
  }
  const scores = exact.map(({ bag, opponent }) => {
    if (bag[0] === "A" && !opponent.includes("E")) return 72;
    if (bag[0] === "E") return 88;
    return 0;
  });
  const utility = hunterUtility(50, scores, exact, true);
  assert.equal(utility.nextBingoPoints, 34);
  assert.equal(utility.total, 84);
  assert.equal(utility.bingoChance, 5 / 12);
  assert.equal(utility.meanBingoScore, 81.6);
});

test("best bingo scoring agrees with full move generation for blanks and different rules", () => {
  const dictionary = new Lexicon([
    "AT",
    "CARE",
    "CARETS",
    "READ",
    "READING",
    "READINGS",
    "TEARING",
    "TEARINGS",
  ]);
  for (const template of PRESETS) {
    const board = emptyBoard(template.size);
    for (const anchor of ["", "S", "a"]) {
      board[template.start] = anchor;
      const solver = prepareSolver(dictionary, board, template);
      for (const rack of ["READING", "READIN?", "READI??", "READINGS"].filter(
        (value) => value.length <= template.rackSize,
      )) {
        const expected =
          solver
            .solve(rack)
            .filter((move) => isBingo(template, move.tiles.length))[0]?.score ??
          0;
        assert.equal(
          solver.bestBingoScore(rack),
          expected,
          `${template.id} ${anchor} ${rack}`,
        );
      }
    }
  }
});

test("the same refill can bingo after a reply opens an anchor", () => {
  const template = PRESETS[0];
  const board = emptyBoard(template.size);
  const rack = "ATREADI";
  const dictionary = new Lexicon([
    "AT",
    "AS",
    "SAT",
    "ST",
    "READING",
    "READINGS",
    "TEARING",
    "TEARINGS",
  ]);
  const move = prepareSolver(dictionary, board, template)
    .solve(rack)
    .find(
      (candidate) =>
        candidate.word === "AT" &&
        candidate.direction === "across" &&
        candidate.col + 1 === template.start % template.size,
    )!;
  const position = { template, board, rack, bagSize: 10, scorelessTurns: 0 };
  const deal = { opponent: "SLMOUVY", bag: "NG" };
  const evaluate = createHunterEvaluator(dictionary, position, move);
  assert.equal(evaluate(deal, true, Infinity), 0);
  assert.equal(evaluate(deal, false, Infinity), 64);
  assert.equal(evaluate({ ...deal, opponent: "DLMOUVY" }, false, Infinity), 0);
  const atEnd = createHunterEvaluator(
    dictionary,
    { ...position, bagSize: 2 },
    move,
  );
  assert.equal(atEnd({ ...deal, opponent: "S" }, false, Infinity), 0);
});

test("an exhausted bag gives credit for a bingo now and zero for ordinary points", async () => {
  const template = {
    ...PRESETS[0],
    tileCounts: Object.fromEntries(
      TILE_SYMBOLS.map((letter) => [
        letter,
        Number("READINGS".includes(letter)),
      ]),
    ),
  };
  const position = {
    template,
    rack: "READING",
    board: emptyBoard(template.size),
    bagSize: 0,
    scorelessTurns: 0,
  };
  const lexicon = new Lexicon(["READ", "READING", "READINGS"]);
  const moves = prepareSolver(lexicon, position.board, template).solve(
    position.rack,
  );
  const selected = [moves.find(({ word }) => word === "READ")!, moves[0]];
  const phases: string[] = [];
  const { ranked, summary } = await runBingoHunter(
    lexicon,
    position,
    selected,
    undefined,
    1,
    new AbortController().signal,
    ({ phase }) => phases.push(phase),
  );
  assert.equal(summary.checked, 2);
  assert.equal(ranked[0].move.word, "READING");
  assert.equal(ranked[0].utility.total, ranked[0].move.score);
  assert.equal(ranked[1].utility.total, 0);
  assert.equal(ranked[0].utility.exact, true);
  assert.deepEqual(phases, ["sample", "sample", "sample"]);
});
