import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS } from "../shared/presets";
import {
  getTileCounts,
  rackContainsChance,
  TILE_SYMBOLS,
  unseenTiles,
} from "../shared/tile-pool";

test("starting counts cover every preset and snapshots without explicit counts", () => {
  for (const [index, total, blanks, eCount] of [
    [0, 100, 2, 12],
    [1, 104, 2, 13],
    [2, 200, 4, 24],
    [3, 104, 2, 12],
    [4, 100, 3, 12],
    [5, 89, 2, 11],
  ]) {
    const template = { ...PRESETS[index], tileCounts: undefined };
    const pool = unseenTiles({ board: [], rack: "" }, template);
    assert.equal(pool.total, total);
    assert.equal(pool.totals.blank, blanks);
    assert.equal(getTileCounts(template).E, eCount);
  }
});

test("tile tracking subtracts placed letters, assigned blanks, and rack tiles", () => {
  const pool = unseenTiles(
    { board: ["A", "", "e", "Q"], rack: "A.?B" },
    PRESETS[0],
  );
  assert.equal(pool.total, 94);
  assert.deepEqual(pool.totals, { vowel: 40, consonant: 54, blank: 0 });
  assert.equal(pool.tiles.find(({ symbol }) => symbol === "E")!.count, 12);
  assert.equal(pool.tiles.find(({ symbol }) => symbol === "Q")!.count, 0);
  assert.deepEqual(pool.excess, []);
});

test("custom counts detect overdrawn letters and blanks independently", () => {
  const template = {
    ...PRESETS[0],
    tileCounts: { ...getTileCounts(PRESETS[0]), A: 0, "?": 1 },
  };
  const pool = unseenTiles({ board: ["A", "a"], rack: "?." }, template);
  assert.deepEqual(
    pool.excess.map(({ symbol, excess }) => [symbol, excess]),
    [
      ["A", 1],
      ["?", 1],
    ],
  );
  assert.ok(pool.tiles.every(({ count }) => count >= 0));
});

test("rack odds count physical copies without replacement", () => {
  const copies: Record<string, number> = { A: 2, B: 1, "?": 1 };
  const template = {
    ...PRESETS[0],
    tileCounts: Object.fromEntries(
      TILE_SYMBOLS.map((letter) => [letter, copies[letter] ?? 0]),
    ),
  };
  const pool = unseenTiles({ board: [], rack: "" }, template);
  assert.equal(rackContainsChance(pool, 2, ["A"]), 5 / 6);
  assert.equal(rackContainsChance(pool, 2, ["A", "A"]), 1 / 6);
  assert.equal(rackContainsChance(pool, 2, ["A", "?"]), 2 / 6);
  assert.equal(rackContainsChance(pool, 2, ["Q"]), 0);
  assert.equal(rackContainsChance(pool, 7, ["A", "A", "B", "?"]), 1);
});
