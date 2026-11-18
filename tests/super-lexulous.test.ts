import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS } from "../shared/presets";
import { emptyBoard, tileScore, type Premium } from "../shared/model";
import { getTileCounts, unseenTiles } from "../shared/tile-pool";
import { Lexicon, parseWords } from "../shared/lexicon";
import { solve } from "../shared/solver";
import { scorePlacement } from "../shared/game-scoring";

const template = PRESETS.find(({ id }) => id === "super-lexulous")!;

test("Super Lexulous premiums match all 441 cells in the supplied board screenshot", () => {
  // Independent row transcription: lower case = letter, upper case = word.
  const key: Record<string, Premium> = {
    ".": "",
    d: "DL",
    t: "TL",
    q: "QL",
    D: "DW",
    T: "TW",
    Q: "QW",
  };
  const rows = [
    "Q..d...T..d..T...d..Q",
    ".D..t...D...D...t..D.",
    "..D..q...D.D...q..D..",
    "d..T..d...T...d..T..d",
    ".t...D...d.d...D...t.",
    "..q.D...t...t...D.q..",
    "...d...D.....D...d...",
    "T.....D.......D.....T",
    ".D...t...d.d...t...D.",
    "..D.d...d...d...d.D..",
    "d..T.............T..d",
    "..D.d...d...d...d.D..",
    ".D...t...d.d...t...D.",
    "T.....D.......D.....T",
    "...d...D.....D...d...",
    "..q.D...t...t...D.q..",
    ".t...D...d.d...D...t.",
    "d..T..d...T...d..T..d",
    "..D..q...D.D...q..D..",
    ".D..t...D...D...t..D.",
    "Q..d...T..d..T...d..Q",
  ];
  assert.ok(rows.every((row) => row.length === 21));
  assert.deepEqual(
    template.premiums,
    [...rows.join("")].map((c) => key[c]),
  );
  assert.equal(template.start, 220);
  assert.equal(template.premiums[template.start], "");
  assert.equal(template.rules, "lexulous");
  assert.equal(template.rackSize, 8);
  assert.equal(template.builtin, true);
});

test("Super Lexulous full bag and scores include the eight grey rack tiles", () => {
  const letters = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ?"];
  assert.deepEqual(
    getTileCounts(template),
    Object.fromEntries(
      letters.map((c, i) => [
        c,
        [
          14, 4, 6, 6, 22, 4, 3, 5, 12, 2, 2, 5, 6, 10, 14, 4, 2, 10, 8, 12, 6,
          3, 4, 2, 6, 2, 4,
        ][i],
      ]),
    ),
  );
  assert.deepEqual(
    letters.map((c) => tileScore(c, template.rules)),
    [
      1, 4, 4, 2, 1, 5, 2, 5, 1, 8, 6, 1, 4, 1, 1, 4, 12, 1, 1, 2, 1, 5, 5, 8,
      5, 12, 0,
    ],
  );
  const pool = unseenTiles(
    { board: emptyBoard(21), rack: "ADDEEIPS" },
    template,
  );
  assert.equal(pool.total, 170);
  assert.equal(pool.totals.vowel, 64);
  assert.equal(Math.round((pool.totals.vowel / pool.total) * 100), 38);
  assert.deepEqual(pool.excess, []);
});

test("Super Lexulous scoring uses its neutral center, quadruples and Lexulous bonuses", () => {
  for (const { existing, added, expected } of [
    {
      existing: [],
      added: [
        [220, "A"],
        [221, "T"],
      ],
      expected: 3,
    },
    { existing: [[1, "T"]], added: [[0, "A"]], expected: 12 },
    { existing: [[46, "A"]], added: [[47, "T"]], expected: 9 },
  ] as const) {
    const before = emptyBoard(21);
    for (const [index, letter] of existing) before[index] = letter;
    const after = [...before];
    for (const [index, letter] of added) after[index] = letter;
    assert.equal(scorePlacement(before, after, template)!.score, expected);
  }
  const dictionary = new Lexicon(parseWords("PAINTER\nPAINTERS"));
  const before = emptyBoard(21);
  const moves = solve(dictionary, before, "PAINTERS", template);
  for (const [word, bonus] of [
    ["PAINTER", 40],
    ["PAINTERS", 50],
  ] as const) {
    const move = moves.find((move) => move.word === word)!;
    assert.ok(move);
    const after = [...before];
    for (const { index, letter } of move.tiles) after[index] = letter;
    const result = scorePlacement(before, after, template)!;
    assert.equal(result.bonus, bonus);
    assert.equal(result.bingo, true);
    assert.equal(result.score, move.score);
  }
});
