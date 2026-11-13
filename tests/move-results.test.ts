import assert from "node:assert/strict";
import { test } from "node:test";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard } from "../shared/model";
import { MoveResultIndex, MOVE_PAGE_SIZE } from "../shared/move-results";
import { PRESETS } from "../shared/presets";
import { solve } from "../shared/solver";

test("the worker index keeps all placements while sending bounded windows", () => {
  const lexicon = new Lexicon(["AT", "CAT", "CATS", "CAST", "ACT", "SAT"]);
  const moves = solve(lexicon, emptyBoard(15), "CATS??", PRESETS[0]);
  assert.ok(moves.length > MOVE_PAGE_SIZE);
  const index = new MoveResultIndex(moves);
  const result = index.summary(1);
  assert.equal(result.total, moves.length);
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
