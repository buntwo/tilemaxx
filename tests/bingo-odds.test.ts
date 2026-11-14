import { test } from "node:test";
import assert from "node:assert/strict";
import { RackBingoIndex, checkBoardBingo } from "../shared/bingo-odds";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard, type BoardTemplate } from "../shared/model";
import { PRESETS } from "../shared/presets";
import { solve, solvePosition } from "../shared/solver";
import { choose, TILE_SYMBOLS, unseenTiles } from "../shared/tile-pool";

function layout(counts: Record<string, number>, rackSize = 2): BoardTemplate {
  return {
    ...PRESETS[0],
    size: 5,
    start: 12,
    premiums: Array(25).fill(""),
    rackSize,
    tileCounts: Object.fromEntries(
      TILE_SYMBOLS.map((tile) => [tile, counts[tile] ?? 0]),
    ),
  };
}

function oracle(
  words: string[],
  rackSize: number,
  leave: string,
  pool: string[],
) {
  let possible = 0,
    hits = 0;
  function visit(start: number, letters: string) {
    if (letters.length === rackSize) {
      possible++;
      const hit = words.some((word) => {
        if (word.length !== rackSize) return false;
        let unused = word;
        for (const tile of letters) {
          if (tile === "?") continue;
          const i = unused.indexOf(tile);
          if (i < 0) return false;
          unused = unused.slice(0, i) + unused.slice(i + 1);
        }
        return true;
      });
      if (hit) hits++;
      return;
    }
    for (let i = start; i < pool.length; i++) visit(i + 1, letters + pool[i]);
  }
  visit(0, leave);
  return hits / possible;
}

test("exact rack odds match independent physical draws with duplicate letters, anagrams and blanks", () => {
  const words = [
    "AAA",
    "AAT",
    "ACT",
    "CAT",
    "TAC",
    "TAT",
    "AXE",
    "AA",
    "AC",
    "TAXI",
  ];
  const lexicon = new Lexicon(words);
  const index = new RackBingoIndex(words);
  const template = layout({ A: 3, C: 2, T: 2, X: 1, E: 1, "?": 3 }, 3);
  const position = { board: emptyBoard(5), rack: "AC?" };
  const pool = [..."AACTTXE??"];
  const moves = solve(lexicon, position.board, position.rack, template);
  const odds = index.calculate(lexicon, position, template, moves);
  assert.ok(odds.exact);
  assert.ok(moves.some((move) => move.leave === "?"));
  assert.ok(moves.some((move) => move.leave === ""));
  for (const move of moves) {
    assert.ok(
      Math.abs(odds.byLeave[move.leave] - oracle(words, 3, move.leave, pool)) <
        1e-12,
    );
  }
  // Putting an assigned blank on the board removes one blank from the draw pool.
  const next = { ...position, board: [...position.board] };
  next.board[12] = "t";
  const nextOdds = index.calculate(lexicon, next, template, moves);
  assert.equal(nextOdds.byLeave[""], oracle(words, 3, "", pool.slice(0, -1)));
});

test("Lexulous counts refills that can play seven out of eight tiles", () => {
  const words = ["AT", "PAINTER"];
  const lexicon = new Lexicon(words);
  const template = PRESETS.find(({ id }) => id === "lexulous")!;
  const position = { board: emptyBoard(15), rack: "PAINTEAT" };
  const move = solve(lexicon, position.board, position.rack, template)[0];
  assert.equal(move.leave, "AEINPT");
  const odds = new RackBingoIndex(words).calculate(
    lexicon,
    position,
    template,
    [move],
  );
  const unseen = unseenTiles(position, template);
  const rCount = unseen.tiles.find(({ symbol }) => symbol === "R")!.count;
  const expected =
    1 -
    choose(unseen.total - rCount - unseen.totals.blank, 2) /
      choose(unseen.total, 2);
  assert.equal(odds.exact, true);
  assert.ok(Math.abs(odds.byLeave[move.leave] - expected) < 1e-12);
});

test("board odds find bingos that use existing board letters and weight exact refills", () => {
  const words = ["AT", "AXE", "TAX"];
  const lexicon = new Lexicon(words);
  const template = layout({ A: 1, T: 1, X: 1, E: 2, O: 1 });
  const board = emptyBoard(5);
  board[12] = "A";
  const position = { board, rack: "TX" };
  const moves = solve(lexicon, board, position.rack, template);
  const at = moves.find(
    (move) => move.word === "AT" && move.direction === "across",
  )!;
  const tax = moves.find((move) => move.word === "TAX")!;
  const rackOdds = new RackBingoIndex(words).calculate(
    lexicon,
    position,
    template,
    [at, tax],
  );
  const progress: number[] = [];
  const result = checkBoardBingo(
    lexicon,
    position,
    template,
    [at, tax],
    1,
    (checked) => progress.push(checked),
  );
  assert.equal(rackOdds.byLeave[at.leave], 0);
  assert.deepEqual(result.byMove[at.id], { chance: 2 / 3, exact: true });
  assert.deepEqual(
    result.byMove[tax.id],
    { chance: 0, exact: true },
    "only one tile is in the bag",
  );
  assert.deepEqual(progress, [1, 2]);
  const heldPosition = { ...position, excludedRackSlots: [1] };
  const heldAt = solvePosition(lexicon, heldPosition, template).find(
    (move) => move.id === at.id,
  )!;
  assert.equal(heldAt.leave, "X");
  assert.deepEqual(
    checkBoardBingo(lexicon, heldPosition, template, [heldAt], 1).byMove[at.id],
    result.byMove[at.id],
  );
  assert.deepEqual(position.board.filter(Boolean), ["A"]);
  assert.throws(
    () => checkBoardBingo(lexicon, position, template, [at], 0),
    /number of tiles/,
  );
});

test("held tiles stay on the rack for the next bingo without returning to the draw pool", () => {
  const words = ["AT", "CAT", "ATX", "TXX"];
  const lexicon = new Lexicon(words);
  const template = layout({ A: 1, T: 2, C: 1, X: 2, E: 1, O: 2, U: 1 }, 3);
  const position = {
    board: emptyBoard(5),
    rack: "ATX",
    excludedRackSlots: [2],
  };
  const moves = solvePosition(lexicon, position, template);
  assert.ok(moves.length);
  assert.ok(moves.every((move) => move.word === "AT" && move.leave === "X"));
  const odds = new RackBingoIndex(words).calculate(
    lexicon,
    position,
    template,
    moves,
  );
  const unseen = [..."TCXEOOU"];
  assert.equal(odds.bagSize, unseen.length - template.rackSize);
  assert.equal(odds.byLeave.X, oracle(words, 3, "X", unseen));
  assert.ok(odds.byLeave.X > 0);
});

test("a slow bingo check can report a partial sample while reserving time for the next move", (t) => {
  const lexicon = new Lexicon(["AT", "CAT", "ACT", "TAC"]);
  const template = layout(
    Object.fromEntries(TILE_SYMBOLS.map((tile) => [tile, 1])),
    3,
  );
  const position = { board: emptyBoard(5), rack: "CAT" };
  const moves = solvePosition(lexicon, position, template);
  const cat = moves.find((move) => move.word === "CAT")!;
  const at = moves.find((move) => move.word === "AT")!;
  let time = 0;
  let step = 3;
  let seed = 123;
  t.mock.method(performance, "now", () => (time += step));
  const result = checkBoardBingo(
    lexicon,
    position,
    template,
    [cat, at],
    21,
    () => {
      step = 0.01;
    },
    () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    },
  );
  assert.equal(result.checked, 2);
  assert.equal(result.byMove[cat.id].exact, false);
  const samples = result.byMove[cat.id].samples ?? 0;
  assert.ok(samples >= 20 && samples < 200, `Completed ${samples} samples`);
  assert.equal(result.byMove[at.id].exact, true);
});
