import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS } from "../shared/presets";
import { getTileCounts, unseenTiles } from "../shared/tile-pool";

test("starting counts cover all three presets and legacy snapshots", () => {
  for (const [index, total, blanks, eCount] of [
    [0, 100, 2, 12],
    [1, 104, 2, 13],
    [2, 200, 4, 24],
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
