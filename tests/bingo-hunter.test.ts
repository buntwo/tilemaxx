import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chooseHunterCandidates,
  chooseHunterFinalists,
  createHunterEvaluator,
  exactHunterDeals,
  hunterScreen,
  hunterUtility,
  sampleHunterDeals,
} from "../shared/bingo-hunter";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard, isBingo, type Move } from "../shared/model";
import { randomGenerator } from "../shared/move-analysis";
import { PRESETS } from "../shared/presets";
import { TILE_SYMBOLS } from "../shared/tile-pool";
import { prepareSolver } from "../shared/solver";
import {
  createBingoHunterSession,
  runBingoHunter,
} from "../src/parallel-bingo-hunter";

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
        assert.equal(solver.bestBingo(rack)?.score ?? 0, expected);
      }
    }
  }
});

test("seven rack tiles can form bingos through up to eight tiles on the board", () => {
  const template = PRESETS[0];
  const fixtures = [
    { word: "TRAINING", anchor: "R", start: 1, rack: "AGIINNT", score: 140 },
    { word: "REPAINTED", anchor: "RE", start: 1, rack: "PAINTED", score: 95 },
    { word: "ANTAGONIZE", anchor: "ANT", start: 108, rack: "AGONIZE", score: 110 },
    { word: "ABSTRACTIONISMS", anchor: "ABSTRACT", start: 0, rack: "IIMNOSS", score: 116 },
  ];
  for (const { word, anchor, start, rack, score } of fixtures) {
    const board = emptyBoard(template.size);
    [...anchor].forEach((letter, offset) => { board[start + offset] = letter; });
    const solver = prepareSolver(new Lexicon([word]), board, template);
    const [move] = solver.solve(rack);
    assert.equal(move.word, word);
    assert.equal(move.tiles.length, 7);
    assert.equal(solver.bestBingoScore(rack), score);
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
  const ordinary = moves.find(({ word }) => word === "READ")!;
  const selected = [
    moves[0],
    ...Array.from({ length: 100 }, (_, i) => ({
      ...ordinary,
      id: `ordinary-${i}`,
    })),
  ];
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
  assert.equal(summary.checked, selected.length);
  assert.equal(ranked[0].move.word, "READING");
  assert.equal(ranked[0].utility.total, ranked[0].move.score);
  assert.equal(ranked[1].utility.total, 0);
  assert.equal(ranked[0].utility.exact, true);
  assert.deepEqual([...new Set(phases)], ["sample"]);
});

function setup(index: number, score: number, leave = "AGIINN"): Move {
  return {
    id: String(index),
    direction: "down",
    word: "RA",
    row: Math.floor(index / 15),
    col: index % 15,
    score,
    leave,
    tiles: [{ index, letter: "R" }],
    blanks: 0,
    crosses: [],
  };
}

test("a lower-scoring setup survives by leaving a two-triple bingo lane", () => {
  const template = PRESETS[0];
  const board = emptyBoard(template.size);
  board[16] = "A";
  const position = {
    template,
    board,
    rack: "AGIINNR",
    bagSize: 60,
    scorelessTurns: 0,
  };
  const lane = setup(1, 4);
  const moves = Array.from({ length: 120 }, (_, i) => ({
    ...setup((4 + (i % 7)) * 15 + 4 + (Math.floor(i / 7) % 7), 99 - i),
    id: `interior-${i}`,
  }));
  const { screen, laneOrder } = hunterScreen([...moves, lane], position);
  assert.equal(screen.length, 96);
  assert.ok(screen.includes(lane));
  assert.equal(laneOrder[0], lane);
  const dictionary = new Lexicon(["RA", "TRAINING"]);
  const evaluate = createHunterEvaluator(dictionary, position, lane);
  assert.equal(evaluate({ opponent: "", bag: "T" }, true, Infinity), 140);
});

test("board leaders, reply leaders and rare high scores all earn more samples", () => {
  const before = Array.from({ length: 36 }, (_, i) => setup(i, 1));
  const after = Array.from({ length: 36 }, (_, i) => setup(i + 40, 1));
  const lane = setup(100, 1),
    peak = setup(101, 1);
  const candidates = chooseHunterCandidates(
    before,
    before,
    after,
    [peak],
    [lane],
  );
  assert.equal(candidates.length, 36);
  assert.deepEqual(candidates.slice(0, 20), before.slice(0, 20));
  for (const expected of [before[0], after[0], lane, peak])
    assert.ok(candidates.includes(expected));

  const deals = Array.from({ length: 20 }, () => ({ opponent: "", bag: "" }));
  const ranked = before.map((move) => ({
    move,
    utility: hunterUtility(0, Array(20).fill(60), deals),
  }));
  const rare = {
    move: peak,
    utility: hunterUtility(0, [140, ...Array(19).fill(0)], deals),
  };
  const finalists = chooseHunterFinalists([...ranked, rare]);
  assert.equal(finalists.length, 12);
  assert.ok(finalists.includes(rare));
  assert.equal(rare.utility.total, 7);
  assert.equal(rare.utility.highestBingo, 140);
});

test("another slice resumes the exact deal sequence without replaying completed deals", async (t) => {
  const template = {
    ...PRESETS[0],
    tileCounts: Object.fromEntries(
      TILE_SYMBOLS.map((letter) => [
        letter,
        Number("READINGST".includes(letter)),
      ]),
    ),
  };
  const position = {
    template,
    rack: "READING",
    board: emptyBoard(template.size),
    bagSize: 1,
    scorelessTurns: 0,
  };
  const lexicon = new Lexicon(["READING"]);
  const [move] = prepareSolver(lexicon, position.board, template).solve(
    position.rack,
  );
  const batches: string[][] = [];
  const original = globalThis.Worker;
  class PausingWorker {
    onmessage?: (event: { data: { kind: string; outcomes: number[] } }) => void;
    terminate() {}
    postMessage({ job }: { job: { deals: { bag: string }[] } }) {
      batches.push(job.deals.map(({ bag }) => bag));
      const outcomes = batches.length === 1 ? [0] : job.deals.map(() => 0);
      queueMicrotask(() =>
        this.onmessage?.({ data: { kind: "bingo-hunter", outcomes } }),
      );
    }
  }
  t.after(() => {
    globalThis.Worker = original;
  });
  globalThis.Worker = PausingWorker as unknown as typeof Worker;

  const session = createBingoHunterSession(
    lexicon,
    position,
    [move],
    undefined,
    1,
  );
  const first = await session.run(new AbortController().signal, () => {});
  assert.equal(first.summary.canContinue, true);
  assert.equal(first.summary.checked, 0);

  const second = await session.run(new AbortController().signal, () => {});
  assert.equal(second.summary.canContinue, false);
  assert.equal(second.ranked[0].utility.exact, true);
  assert.equal(second.ranked[0].utility.total, move.score);
  assert.deepEqual(batches, [["S", "T"], ["T"]]);
});
