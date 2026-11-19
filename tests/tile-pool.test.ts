import { test } from "node:test";
import assert from "node:assert/strict";
import { lexulousTemplateForLanguage, PRESETS } from "../shared/presets";
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
    [6, 178, 4, 22],
    [7, 102, 2, 15],
  ]) {
    const template = { ...PRESETS[index], tileCounts: undefined };
    const pool = unseenTiles({ board: [], rack: "" }, template);
    assert.equal(pool.total, total);
    assert.equal(pool.totals.blank, blanks);
    assert.equal(getTileCounts(template).E, eCount);
  }
});

test("French Scrabble uses the classic board with French tile counts and values", () => {
  const french = PRESETS.find(({ id }) => id === "scrabble-fr")!;
  assert.deepEqual(french.premiums, PRESETS[0].premiums);
  assert.equal(french.rackSize, 7);
  assert.equal(french.bingo, 50);
  const pool = unseenTiles({ board: [], rack: "" }, french);
  const tiles = Object.fromEntries(
    pool.tiles.map(({ symbol, count, score }) => [symbol, [count, score]]),
  );
  assert.deepEqual(tiles, {
    A: [9, 1],
    B: [2, 3],
    C: [2, 3],
    D: [3, 2],
    E: [15, 1],
    F: [2, 4],
    G: [2, 2],
    H: [2, 4],
    I: [8, 1],
    J: [1, 8],
    K: [1, 10],
    L: [5, 1],
    M: [3, 2],
    N: [6, 1],
    O: [6, 1],
    P: [2, 3],
    Q: [1, 8],
    R: [6, 1],
    S: [6, 1],
    T: [6, 1],
    U: [6, 1],
    V: [2, 4],
    W: [1, 10],
    X: [1, 10],
    Y: [1, 10],
    Z: [1, 10],
    "?": [2, 0],
  });
});

test("Classic Lexulous combines one board with language-specific bags and values", () => {
  const classic = PRESETS.find(({ id }) => id === "lexulous")!;
  const superLexulous = PRESETS.find(({ id }) => id === "super-lexulous")!;
  assert.equal(lexulousTemplateForLanguage(classic, "en-GB"), classic);
  assert.equal(lexulousTemplateForLanguage(superLexulous, "it"), superLexulous);

  const french = lexulousTemplateForLanguage(classic, "fr");
  assert.deepEqual(french.premiums, classic.premiums);
  const frenchPool = unseenTiles({ board: [], rack: "" }, french);
  assert.equal(frenchPool.total, 100);
  assert.equal(getTileCounts(french).E, 15);
  assert.equal(frenchPool.tiles.find(({ symbol }) => symbol === "Q")?.score, 8);

  const italian = lexulousTemplateForLanguage(classic, "it");
  assert.deepEqual(italian.premiums, classic.premiums);
  const italianPool = unseenTiles({ board: [], rack: "" }, italian);
  assert.equal(italianPool.total, 120);
  assert.equal(italianPool.totals.blank, 2);
  assert.equal(getTileCounts(italian).O, 15);
  assert.equal(getTileCounts(italian).K, 0);
  assert.equal(
    italianPool.tiles.find(({ symbol }) => symbol === "Q")?.score,
    12,
  );
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
