import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS } from "../shared/presets";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archiveGame,
  emptyBoard,
  redo,
  restoreArchivedGame,
  tileScore,
  undo,
  type Game,
  type Premium,
} from "../shared/model";
import { getTileCounts, unseenTiles } from "../shared/tile-pool";
import { Lexicon, parseWords } from "../shared/lexicon";
import { solve } from "../shared/solver";
import {
  correctSuperLexulousCenter,
  emptyScoring,
  playTrackedMove,
  recordOpponentPlay,
  scorePlacement,
} from "../shared/game-scoring";
import { createStore } from "../server/store";

const template = PRESETS.find(({ id }) => id === "super-lexulous")!;

test("Super Lexulous premiums match all 441 cells including the double-word start", () => {
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
    "d..T......D......T..d",
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
  assert.equal(template.premiums[template.start], "DW");
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

test("Super Lexulous scoring uses its double-word center, quadruples and Lexulous bonuses", () => {
  for (const { existing, added, expected } of [
    {
      existing: [],
      added: [
        [220, "A"],
        [221, "T"],
      ],
      expected: 6,
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

function legacyOpening() {
  const premiums = [...template.premiums];
  premiums[template.start] = "";
  const initial: Game = {
    id: "super-opening",
    name: "Super Lexulous opponent",
    profileId: "p",
    dictionaryId: "wordnik",
    board: emptyBoard(template.size),
    rack: "ATDOG",
    past: [],
    future: [],
    archived: false,
    revision: 0,
    updatedAt: "2026-11-18T00:00:00Z",
    template: { ...template, premiums },
    trackScores: true,
    scoring: emptyScoring(),
  };
  const move = solve(
    new Lexicon(["AT"]),
    initial.board,
    initial.rack,
    initial.template,
  ).find(
    (move) => move.row === 10 && move.col === 10 && move.direction === "across",
  )!;
  return playTrackedMove(initial, move, 100);
}

test("correcting a saved Super Lexulous game repairs the opening and its undo and redo scores", () => {
  const opening = legacyOpening();
  assert.equal(opening.scoring?.you.points, 3);
  const board = [...opening.board];
  board[template.start - 1] = "C";
  const reply = recordOpponentPlay(
    {
      ...opening,
      board,
      scoring: { ...opening.scoring!, pendingBase: opening.board },
    },
    null,
  );
  assert.equal(reply.scoring?.opponent.points, 7);

  const fixed = correctSuperLexulousCenter(reply);
  assert.equal(fixed.template.premiums[template.start], "DW");
  assert.equal(fixed.trackScores, true);
  assert.deepEqual(
    fixed.trackedMoves?.map((move) => [
      move.word,
      move.score,
      move.review?.premiums?.[template.start],
    ]),
    [
      ["AT", 6, "DW"],
      ["CAT", 7, "DW"],
    ],
  );
  assert.equal(fixed.scoring?.you.points, 6);
  assert.equal(fixed.scoring?.you.best, 6);
  assert.equal(fixed.scoring?.opponent.points, 7);
  assert.equal(undo(fixed).scoring?.you.points, 6);
  assert.equal(redo(undo(fixed)).scoring?.you.points, 6);
  assert.equal(redo(undo(undo(fixed))).trackedMoves?.[0].score, 6);

  const future = redo(correctSuperLexulousCenter(undo(opening)));
  assert.equal(future.scoring?.you.points, 6);
  assert.equal(future.trackedMoves?.[0].score, 6);
  assert.equal(correctSuperLexulousCenter(fixed), fixed);
});

test("a Super Lexulous opponent opening is corrected, while custom layouts and unverified scores are preserved", () => {
  const opening = legacyOpening();
  const before = undo(opening);
  const opponent = recordOpponentPlay(
    {
      ...before,
      board: opening.board,
      scoring: { ...before.scoring!, pendingBase: before.board },
    },
    null,
  );
  assert.equal(
    correctSuperLexulousCenter(opponent).scoring?.opponent.points,
    6,
  );

  const move = opening.trackedMoves![0];
  const manual = {
    ...opening,
    scoring: {
      ...opening.scoring!,
      you: { ...opening.scoring!.you, points: 10, best: 10 },
    },
    trackedMoves: [{ ...move, score: 10 }],
  };
  const manualFixed = correctSuperLexulousCenter(manual);
  assert.equal(manualFixed.template.premiums[template.start], "DW");
  assert.equal(manualFixed.scoring?.you.points, 10);
  assert.equal(manualFixed.trackedMoves?.[0].score, 10);

  const missing = {
    ...opening,
    trackedMoves: [{ ...move, review: undefined }],
    past: [],
  };
  const missingFixed = correctSuperLexulousCenter(missing);
  assert.equal(missingFixed.template.premiums[template.start], "DW");
  assert.equal(missingFixed.scoring?.you.points, 3);

  const premiums = [...before.template.premiums];
  premiums[0] = "TL";
  const custom = {
    ...before,
    future: [],
    template: { ...before.template, premiums },
  };
  assert.equal(correctSuperLexulousCenter(custom), custom);
});

test("the database upgrade fixes existing saved and archived games and accepts an old draft safely", () => {
  const dir = mkdtempSync(join(tmpdir(), "tilemaxx-super-lexulous-"));
  let store = createStore(dir, process.cwd());
  try {
    const opening = legacyOpening();
    const archived = archiveGame({
      ...opening,
      id: "super-archived",
      scoring: {
        ...opening.scoring!,
        end: { manual: true, scores: { you: 170, opponent: 150 } },
      },
    });
    store.db.exec("PRAGMA user_version=2");
    for (const game of [opening, archived])
      store.db
        .prepare("INSERT INTO games VALUES (?, ?, ?)")
        .run(game.id, game.revision, JSON.stringify(game));
    store.index();

    store.db.close();
    store = createStore(dir, process.cwd());
    const saved = store.getGame(opening.id)!;
    assert.equal(saved.revision, opening.revision + 1);
    assert.equal(saved.updatedAt, opening.updatedAt);
    assert.equal(saved.scoring?.you.points, 6);
    const baseline = restoreArchivedGame(store.getGame(archived.id)!);
    assert.equal(baseline.template.premiums[template.start], "DW");
    assert.equal(baseline.scoring?.you.points, 6);
    assert.deepEqual(baseline.scoring?.end, archived.scoring?.end);

    const synced = store.saveGame({ ...opening, revision: saved.revision })!;
    assert.equal(synced.template.premiums[template.start], "DW");
    assert.equal(synced.scoring?.you.points, 6);
    store.db.close();
    store = createStore(dir, process.cwd());
    assert.deepEqual(
      store.getGame(opening.id),
      JSON.parse(JSON.stringify(synced)),
    );
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
