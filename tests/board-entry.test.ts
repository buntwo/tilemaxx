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
const layout = { size: 5, start: 12 };

test("across wins even when down has a more direct connection", () => {
  const board = emptyBoard(5);
  board[7] = "t";
  assert.equal(inferBoardEntryDirection(board, 12, layout, 1), "down");
  assert.equal(inferBoardEntryDirection(board, 12, layout, 2), "across");
  board[11] = "A";
  assert.equal(inferBoardEntryDirection(board, 12, layout, 1), "across");
  assert.equal(inferBoardEntryDirection(board, 12, layout, 0), "across");
});

test("board entry stays on the selected row or column at the edges", () => {
  const edge = emptyBoard(5);
  edge[5] = "R"; // Next row, outside the rightward path.
  edge[14] = "Y";
  assert.equal(inferBoardEntryDirection(edge, 4, layout, 2), "down");
  edge[3] = "B"; // An across extension still fits in the last column.
  assert.equal(inferBoardEntryDirection(edge, 4, layout, 2), "across");

  const left = emptyBoard(5);
  left[4] = "X"; // Previous row, outside the leftward prefix.
  left[15] = "D";
  assert.equal(inferBoardEntryDirection(left, 5, layout, 2), "down");
  assert.equal(inferBoardEntryDirection(left, 20, layout, 1), "down");
});

test("reachable side connections count for parallel plays in either direction", () => {
  const board = emptyBoard(15);
  const j13 = 12 * 15 + 9;
  board[j13 + 15] = "G";
  board[j13 + 16] = "I";
  assert.equal(inferBoardEntryDirection(board, j13, PRESETS[0], 2), "across");
  assert.equal(inferBoardEntryDirection(board, j13, PRESETS[0], 1), "down");

  const column = emptyBoard(5);
  column[17] = "A";
  column[22] = "T";
  assert.equal(inferBoardEntryDirection(column, 6, layout, 2), "across");
  assert.equal(inferBoardEntryDirection(column, 6, layout, 3), "down");
});

test("played tiles extend the word without using rack tiles", () => {
  const board = emptyBoard(5);
  board[12] = "R";
  board[13] = "E";
  board[14] = "D";
  assert.equal(inferBoardEntryDirection(board, 12, layout, 1), "down");
  board[14] = "";
  assert.equal(inferBoardEntryDirection(board, 12, layout, 1), "across");
  assert.equal(inferBoardEntryDirection(board, 14, layout, 1), "across");
});

test("only a reachable opening square or an orthogonal connection counts", () => {
  const board = emptyBoard(5);
  assert.equal(inferBoardEntryDirection(board, 7, layout, 2), "down");
  assert.equal(inferBoardEntryDirection(board, 7, layout, 1), "across");
  assert.equal(inferBoardEntryDirection(board, 12, layout, 2), "across");
  assert.equal(inferBoardEntryDirection(board, 2, { ...layout, start: 7 }, 2), "down");

  board[20] = "X";
  assert.equal(inferBoardEntryDirection(board, 7, layout, 2), "across");
  // The tile at A5 is diagonal from the end of the attempted down play.
  assert.equal(inferBoardEntryDirection(board, 16, layout, 1), "across");
  assert.equal(inferBoardEntryDirection(board, 16, layout, 2), "down");
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
