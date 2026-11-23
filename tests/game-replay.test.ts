import assert from "node:assert/strict";
import { test } from "node:test";
import { gameReplayFrames, hasRecordedMoves } from "../shared/game-replay";
import {
  archiveGame,
  emptyBoard,
  type Game,
  type TrackedMove,
} from "../shared/model";
import { PRESETS } from "../shared/presets";

function gameWithMoves(trackedMoves: TrackedMove[]): Game {
  return {
    id: "game",
    profileId: "profile",
    name: "Replay",
    dictionaryId: "test",
    template: PRESETS[0],
    board: emptyBoard(15),
    rack: "ZYXWVUT",
    trackedMoves,
    past: [],
    future: [],
    revision: 0,
    updatedAt: "",
    archived: false,
  };
}

test("replay uses the saved archive, historical premiums, placed blanks, and rack leave", () => {
  const board = emptyBoard(15);
  const premiums = [...PRESETS[0].premiums];
  premiums[111] = "DL";
  const move: TrackedMove = {
    player: "you",
    word: "CAT",
    score: 14,
    at: "",
    review: {
      board,
      premiums,
      dictionaryId: "test",
      rack: "CA?E",
      tiles: [
        { index: 111, letter: "C" },
        { index: 112, letter: "A" },
        { index: 113, letter: "t" },
      ],
    },
  };
  const game = archiveGame(gameWithMoves([move]));
  game.board = game.board.map((tile, i) => (i === 0 ? "X" : tile));
  game.trackedMoves = [];

  assert.equal(hasRecordedMoves(game), true);
  const [before, after] = gameReplayFrames(game);
  assert.equal(before.board, board);
  assert.equal(before.rack, "CA?E");
  assert.equal(after.template.premiums, premiums);
  assert.equal(after.position?.tiles[2].letter, "t");
  assert.equal(after.rack, "E");
  assert.deepEqual(after.scores, { you: 14, opponent: 0 });
  assert.equal(game.board[0], "X");
});

test("score-only moves keep their points and do not invent a board or rack", () => {
  const game = gameWithMoves([
    { player: "opponent", word: "CAT", score: 10, at: "" },
  ]);
  const [opening, scoreOnly] = gameReplayFrames(game);
  assert.equal(opening.board, undefined);
  assert.equal(scoreOnly.board, undefined);
  assert.equal(scoreOnly.rack, undefined);
  assert.deepEqual(scoreOnly.scores, { you: 0, opponent: 10 });
  assert.equal(hasRecordedMoves(gameWithMoves([])), false);
});
