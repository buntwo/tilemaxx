import assert from "node:assert/strict";
import { test } from "node:test";
import { RackBingoIndex } from "../shared/bingo-odds";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard } from "../shared/model";
import { optimizeExchange, planOptimalExchange } from "../shared/optimal-exchange";
import { PRESETS } from "../shared/presets";
import { TILE_SYMBOLS, unseenTiles } from "../shared/tile-pool";

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
  assert.throws(
    () => optimizeExchange(lexicon, new RackBingoIndex(words), {
      ...request, excludedRackSlots: [2],
    }),
    /at least 3 playable rack tiles/,
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


test("optimal exchange requires the minimum bingo rack, including Lexulous seven-tile bingos", () => {
  const scrabble = PRESETS[0];
  const lexulous = PRESETS.find(t => t.rules === "lexulous")!;
  for (const [rules, rack, excludedRackSlots, allowed] of [
    [scrabble, "AEINRS", [], false],
    [scrabble, "AEINRS?", [], true],
    [scrabble, "AE.INRS", [], false],
    [scrabble, "AEINRST", [0], false],
    [lexulous, "AEINRS", [], false],
    [lexulous, "AEINRST", [], true],
    [lexulous, "AEINRST?", [], true],
    [lexulous, "AEINRST?", [0], true],
    [{ ...scrabble, rackSize: 4, additionalBonuses: { 3: 20 } }, "CAT", [], true],
  ] as const) {
    const position = { board: emptyBoard(15), rack, excludedRackSlots: [...excludedRackSlots] };
    const request = { ...position, template: rules, bag: unseenTiles(position, rules).total - rules.rackSize };
    const plan = planOptimalExchange(new Lexicon([]), new RackBingoIndex([]), request, () => {});
    if (allowed) assert.equal(plan.next().done, false, `${rules.rules}: ${rack}`);
    else assert.throws(() => plan.next(), /playable rack tiles for a bingo/);
  }
});
