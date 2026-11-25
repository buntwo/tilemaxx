import test from "node:test";
import assert from "node:assert/strict";
import { emptyBoard, type Move } from "../shared/model";
import {
  moveLocation,
  moveNotation,
  recordedMoveDetails,
  recordedMoveNotation,
} from "../shared/notation";

const move: Move = {
  id: "test",
  word: "CATS",
  row: 7,
  col: 6,
  direction: "across",
  score: 10,
  tiles: [
    { index: 111, letter: "C" },
    { index: 113, letter: "t" },
    { index: 114, letter: "S" },
  ],
  leave: "",
  blanks: 1,
  crosses: [],
};

test("move locations encode across and down without changing square coordinates", () => {
  assert.equal(moveLocation(move), "8G");
  assert.equal(moveLocation({ ...move, direction: "down" }), "G8");
  assert.equal(moveLocation({ row: 20, col: 20, direction: "across" }), "21U");
});

test("move notation groups existing letters and lowercases newly played and old blanks", () => {
  const board = emptyBoard(15);
  board[112] = "A";
  assert.equal(moveNotation(move, 15, board), "C(A)tS");
  board[112] = "a";
  assert.equal(moveNotation(move, 15, board), "C(a)tS");
  assert.equal(
    moveNotation(
      {
        ...move,
        tiles: [
          { index: 111, letter: "C" },
          { index: 114, letter: "s" },
        ],
      },
      15,
    ),
    "C(AT)s",
  );
  assert.equal(moveNotation({ ...move, tiles: [] }, 15, board), "(CaTS)");
});

test("down words and custom boards use placement squares rather than letter matching", () => {
  const down = {
    ...move,
    word: "AAA",
    row: 0,
    col: 1,
    direction: "down" as const,
    tiles: [
      { index: 1, letter: "A" },
      { index: 11, letter: "a" },
    ],
  };
  const board = emptyBoard(5);
  board[6] = "A";
  assert.equal(moveNotation(down, 5, board), "A(A)a");
});

test("recorded notation recovers a played-through word but does not invent missing history", () => {
  const board = emptyBoard(15);
  board[112] = "a";
  const position = { board, tiles: move.tiles };
  assert.deepEqual(recordedMoveDetails(move, position, 15), {
    notation: "C(a)tS",
    location: "8G",
  });
  assert.equal(recordedMoveNotation(move, position, 15), "C(a)tS");

  const down = emptyBoard(15);
  down[112] = "E";
  assert.deepEqual(
    recordedMoveDetails({ word: "HONEY" }, {
      board: down,
      tiles: [
        { index: 67, letter: "h" },
        { index: 82, letter: "O" },
        { index: 97, letter: "N" },
        { index: 127, letter: "Y" },
      ],
    }, 15),
    { notation: "hON(E)Y", location: "H5" },
  );
  assert.equal(
    recordedMoveNotation({ word: "CORRECTED" }, position, 15),
    "CORRECTED",
  );
  assert.equal(recordedMoveNotation(move, undefined, 15), "CATS");
});
