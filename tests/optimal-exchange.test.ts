import assert from "node:assert/strict";
import { test } from "node:test";
import { RackBingoIndex } from "../shared/bingo-odds";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard } from "../shared/model";
import { optimizeExchange } from "../shared/optimal-exchange";
import { PRESETS } from "../shared/presets";
import { TILE_SYMBOLS } from "../shared/tile-pool";

const counts: Record<string, number> = { A: 1, V: 2, T: 10 };
const template = {
  ...PRESETS[0],
  rackSize: 3,
  tileCounts: Object.fromEntries(
    TILE_SYMBOLS.map((tile) => [tile, counts[tile] ?? 0]),
  ),
};

test("optimal exchange finds the useful swap size and deduplicates equivalent copies", () => {
  const words = ["ATT", "TAT"];
  const lexicon = new Lexicon(words);
  const request = { board: emptyBoard(15), rack: "AVV", template, bag: 7 };
  const result = optimizeExchange(lexicon, new RackBingoIndex(words), request);
  assert.equal(result.checked, 5);
  assert.equal(result.keepBingo, false);
  assert.deepEqual(result.bestSwaps, [
    { slots: [1, 2], chance: 1, close: false },
    { slots: [0], chance: 0, close: false },
    { slots: [1], chance: 0, close: false },
    { slots: [0, 1], chance: 0, close: false },
    { slots: [0, 1, 2], chance: 0, close: false },
  ]);
  const held = optimizeExchange(lexicon, new RackBingoIndex(words), {
    ...request,
    excludedRackSlots: [2],
  });
  assert.ok(
    held.bestSwaps.every(
      ({ slots, chance }) => !slots.includes(2) && chance === 0,
    ),
  );
  assert.throws(
    () =>
      optimizeExchange(lexicon, new RackBingoIndex(words), {
        ...request,
        bag: 6,
      }),
    /not have enough tiles/,
  );
});

test("optimal exchange refines 20 global finalists and can rank two swaps of the same size first", () => {
  const rack = "ABCDEFG";
  const words = ["ABCDETT", "ABCEFTT"];
  const progress: [number, number][] = [];
  const result = optimizeExchange(
    new Lexicon(words),
    new RackBingoIndex(words),
    {
      board: emptyBoard(15),
      rack,
      bag: 10,
      template: {
        ...PRESETS[0],
        tileCounts: Object.fromEntries(
          TILE_SYMBOLS.map((tile) => [
            tile,
            tile === "T" ? 17 : Number(rack.includes(tile)),
          ]),
        ),
      },
    },
    (completed, total) => progress.push([completed, total]),
  );
  assert.equal(result.checked, 127);
  assert.equal(result.finalists, 20);
  assert.equal(result.screeningDraws, 128);
  assert.equal(result.refinementDraws, 1200);
  assert.deepEqual(progress.at(-1), [1328, 1328]);
  assert.equal(result.bestSwaps.length, 7);
  assert.deepEqual(result.bestSwaps.slice(0, 2), [
    { slots: [3, 6], chance: 1, close: true },
    { slots: [5, 6], chance: 1, close: true },
  ]);
  assert.ok(result.bestSwaps.slice(2).every(({ chance }) => chance === 0));
});

test("the same exchange odds depend on placement and cross words on the board", () => {
  const words = ["ATT", "TAT"];
  const lexicon = new Lexicon(words);
  const rackIndex = new RackBingoIndex(words);
  const board = emptyBoard(15);
  board[112] = "Z";
  const request = {
    board,
    rack: "AVV",
    bag: 7,
    template: { ...template, tileCounts: { ...template.tileCounts, Z: 1 } },
  };
  const result = optimizeExchange(lexicon, rackIndex, request);
  assert.ok(result.bestSwaps.every(({ chance }) => chance === 0));
  assert.equal(result.keepBingo, false);
  const keep = optimizeExchange(lexicon, rackIndex, {
    ...request,
    board: emptyBoard(15),
    rack: "ATT",
    bag: 8,
  });
  assert.equal(keep.keepBingo, true);
});
