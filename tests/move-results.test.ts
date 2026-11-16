import assert from "node:assert/strict";
import { test } from "node:test";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard, type Move } from "../shared/model";
import { MoveResultIndex, MOVE_PAGE_SIZE } from "../shared/move-results";
import { PRESETS } from "../shared/presets";
import { solve } from "../shared/solver";

test("the worker index keeps all placements while sending bounded windows", () => {
  const lexicon = new Lexicon(["AT", "CAT", "CATS", "CAST", "ACT", "SAT"]);
  const moves = solve(lexicon, emptyBoard(15), "CATS??", PRESETS[0]);
  assert.ok(moves.length > MOVE_PAGE_SIZE);
  const index = new MoveResultIndex(moves, PRESETS[0]);
  const result = index.summary(1);
  assert.equal(result.total, moves.length);
  assert.equal(result.bingoCount, 0);
  assert.deepEqual(result.head, moves.slice(0, 30));
  const end = index.page({ filter: "", sort: "score", offset: moves.length });
  assert.equal(end.total, moves.length);
  assert.equal(end.offset, moves.length - MOVE_PAGE_SIZE);
  assert.deepEqual(end.rows, moves.slice(-MOVE_PAGE_SIZE));

  const expected = moves
    .filter((move) => move.word.includes("AT"))
    .sort((a, b) => a.word.localeCompare(b.word) || b.score - a.score);
  const query = { filter: " at ", sort: "word" as const, offset: 0 };
  const first = index.page(query);
  assert.equal(first.total, expected.length);
  assert.deepEqual(first.head, expected.slice(0, 30));
  assert.deepEqual(first.rows, expected.slice(0, MOVE_PAGE_SIZE));
  const later = index.page({ ...query, offset: 70 });
  assert.deepEqual(later.head, first.head);
  assert.deepEqual(
    later.rows,
    expected.slice(later.offset, later.offset + MOVE_PAGE_SIZE),
  );
  assert.equal(index.page({ ...query, filter: "ZZZ" }).total, 0);
  assert.deepEqual(index.shortlist({})[0]?.move, moves[0]);
});

test("endgame ranking includes lower-scoring moves outside the initial page and returns only visible estimates", () => {
  const lexicon = new Lexicon(["AT", "CAT", "CATS", "CAST", "ACT", "SAT"]);
  const moves = solve(lexicon, emptyBoard(15), "CATS??", PRESETS[0]);
  const first = moves[0];
  const last = moves.at(-1)!;
  const index = new MoveResultIndex(moves, PRESETS[0]);
  const ranked = index.setEndgame(
    2,
    new Map([
      [first.id, { spread: 50, exact: false }],
      [last.id, { spread: 15, exact: true }],
    ]),
  );
  assert.equal(ranked.checked, 2);
  assert.deepEqual(ranked.head.slice(0, 2), [first, last]);
  assert.deepEqual(index.summary(1).head, moves.slice(0, 30));

  const query = {
    filter: "",
    sort: "endgame" as const,
    offset: 0,
    endgameId: 2,
  };
  assert.deepEqual(index.page(query).head.slice(0, 2), [last, first]);
  assert.equal(index.page(query).exactEndgameCount, 1);
  assert.equal(index.page({ ...query, reversed: true }).rows[0], last);
  const raw = index.page({ ...query, sort: "score" });
  assert.equal(raw.rows[0], first);
  assert.deepEqual(raw.endgame, { [first.id]: { spread: 50, exact: false } });
  assert.equal(raw.exactEndgameCount, undefined);
  assert.equal(index.page({ ...query, endgameId: 1 }).endgame, undefined);

  const exactEndgameSpreads = { [first.id]: 20, [last.id]: 0 };
  const corrected = { ...query, exactEndgameSpreads };
  assert.deepEqual(index.page(corrected).head.slice(0, 2), [first, last]);
  assert.equal(index.page(corrected).exactEndgameCount, 2);
  assert.equal(
    index.page({ ...corrected, offset: moves.length }).exactEndgameCount,
    2,
  );
  assert.deepEqual(
    index.page({ ...corrected, reversed: true }).head.slice(0, 2),
    [last, first],
  );
  assert.deepEqual(
    index.page({ ...corrected, sort: "score" }).head,
    raw.head,
  );
  assert.equal(index.page(query).head[0], last);
});

test("square filtering finds every required square in the main word before paginating", () => {
  const lexicon = new Lexicon([
    "AT",
    "CAT",
    "CATS",
    "CAST",
    "ACT",
    "SAT",
    "ST",
  ]);
  const board = emptyBoard(15);
  board[112] = "A";
  const template = { ...PRESETS[0], rackSize: 3 };
  const moves = solve(lexicon, board, "CTS", template);
  const playedAt = (move: Move, index: number) =>
    move.tiles.some((tile) => tile.index === index);
  const expected = moves.filter(
    (move) =>
      playedAt(move, 113) &&
      move.word.includes("AT") &&
      move.direction === "across" &&
      move.row === 7,
  );
  assert.ok(expected.length > 1);
  assert.ok(expected.every((move) => !playedAt(move, 112)));
  assert.ok(
    moves.some(
      (move) =>
        move.direction === "down" && playedAt(move, 113) && move.crosses.length,
    ),
  );
  const index = new MoveResultIndex(moves, template);
  const query = { filter: " at ", sort: "score" as const, offset: 0 };
  const squares = { size: 15, indices: [112, 113] };
  assert.ok(
    index
      .page({ ...query, filter: "", requiredSquares: squares })
      .rows.every((move) => move.direction === "across"),
  );
  const page = index.page({ ...query, requiredSquares: squares });
  assert.deepEqual(page.rows, expected);
  assert.equal(page.total, expected.length);
  assert.equal(
    page.bingoCount,
    expected.filter((move) => move.tiles.length === 3).length,
  );
  const down = index.page({
    ...query,
    requiredSquares: { size: 15, indices: [112, 127] },
  });
  assert.ok(down.rows.length);
  assert.ok(
    down.rows.every(
      (move) =>
        move.direction === "down" && move.col === 7 && playedAt(move, 127),
    ),
  );
  assert.equal(
    index.page({
      ...query,
      requiredSquares: { size: 15, indices: [112, 113, 127] },
    }).total,
    0,
  );
  assert.ok(index.page(query).total > page.total);
});
