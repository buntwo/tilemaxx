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
  assert.deepEqual(result.bestBySize, [
    { slots: [0], chance: 0, close: true },
    { slots: [1, 2], chance: 1, close: false },
    { slots: [0, 1, 2], chance: 0, close: false },
  ]);
  const held = optimizeExchange(lexicon, new RackBingoIndex(words), {
    ...request,
    excludedRackSlots: [2],
  });
  assert.ok(
    held.bestBySize.every(
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
  assert.ok(result.bestBySize.every(({ chance }) => chance === 0));
  assert.equal(result.keepBingo, false);
  const keep = optimizeExchange(lexicon, rackIndex, {
    ...request,
    board: emptyBoard(15),
    rack: "ATT",
    bag: 8,
  });
  assert.equal(keep.keepBingo, true);
});
