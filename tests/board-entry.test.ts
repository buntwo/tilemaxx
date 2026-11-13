import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardEditHistory } from "../shared/board-entry";
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
