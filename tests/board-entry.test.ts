import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardEditHistory, inferBoardEntryDirection } from "../shared/board-entry";
import { emptyBoard, undo, redo, type Game } from "../shared/model";
import { PRESETS } from "../shared/presets";

function fixture(): Game {
  return {
    id: "entry",
    profileId: "p",
    template: PRESETS[0],
    name: "Entry",
    dictionaryId: "test",
    board: emptyBoard(15),
    rack: "DOG",
    past: [],
    future: [],
    revision: 0,
    updatedAt: "",
    archived: false,
  };
}
function write(
  history: BoardEditHistory,
  game: Game,
  index: number,
  letter: string,
) {
  const board = [...game.board];
  board[index] = letter;
  return history.apply(game, board, letter ? "enter" : "erase");
}
test("board entry starts down only if another tile shares the column and none share the row", () => {
  const board = emptyBoard(5);
  const at = (row: number, column: number) => row * 5 + column;
  const direction = (row: number, column: number) =>
    inferBoardEntryDirection(board, at(row, column), 5);

  assert.equal(direction(2, 2), "across");
  board[at(2, 2)] = "C";
  assert.equal(direction(2, 2), "across"); // The selected tile itself does not count.
  assert.equal(direction(2, 0), "across");
  assert.equal(direction(2, 4), "across");
  assert.equal(direction(0, 2), "down");
  assert.equal(direction(4, 2), "down");

  board[at(4, 4)] = "a";
  assert.equal(direction(4, 2), "across"); // Both axes touch.
  assert.equal(direction(1, 4), "down"); // An assigned blank still occupies a square.
  assert.equal(direction(1, 1), "across"); // Diagonal tiles do not count.
});

test("typing and deletion form separate whole-word undo/redo steps across save acknowledgments", () => {
  const history = new BoardEditHistory();
  let game = fixture();
  for (const [offset, letter] of [..."CAT"].entries()) {
    game = write(history, game, 112 + offset, letter);
    game = { ...game, revision: game.revision + 1 };
  }
  assert.equal(game.past.length, 1);
  assert.equal(undo(game).board.filter(Boolean).length, 0);
  assert.deepEqual(redo(undo(game)).board, game.board);
  for (const i of [114, 113, 112]) game = write(history, game, i, "");
  assert.equal(game.past.length, 2);
  assert.equal(undo(game).board.slice(112, 115).join(""), "CAT");
  assert.equal(redo(undo(game)).board.filter(Boolean).length, 0);
  assert.equal(game.rack, "DOG");
});
test("explicit boundary, undo and outside edits cannot merge unrelated history", () => {
  const history = new BoardEditHistory();
  let game = write(history, fixture(), 112, "A");
  history.reset();
  game = write(history, game, 113, "T");
  assert.equal(game.past.length, 2);
  game = write(history, undo(game), 113, "S");
  assert.equal(game.future.length, 0);
  assert.equal(undo(game).board[112], "A");
  assert.equal(undo(game).board[113], "");
  game = write(history, { ...game, rack: "CAT" }, 114, "H");
  assert.equal(game.past.length, 3);
  assert.equal(undo(game).rack, "CAT");
});
