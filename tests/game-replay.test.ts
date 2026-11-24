import assert from "node:assert/strict";
import { test } from "node:test";
import {
  archiveForReview,
  compactArchivedHistory,
} from "../shared/archive-history";
import { summarizeGame } from "../shared/game-index";
import { gameReplayFrames, hasRecordedMoves } from "../shared/game-replay";
import {
  boardWordsAt,
  emptyScoring,
  reviewTurns,
  scorePlacement,
  tracksScores,
} from "../shared/game-scoring";
import {
  archiveGame,
  emptyBoard,
  restoreArchivedGame,
  trackedMoveHistory,
  type Game,
  type TrackedMove,
} from "../shared/model";
import { PRESETS } from "../shared/presets";
import { gameSchema } from "../server/validation";

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

test("archiving keeps legacy moves, the original rack, blanks, and historical premiums", () => {
  const before = emptyBoard(15);
  before[110] = "S";
  const board = [...before];
  board.splice(111, 3, "C", "A", "t");
  const premiums = [...PRESETS[0].premiums];
  premiums[111] = "DL";
  const played = scorePlacement(before, board, { ...PRESETS[0], premiums })!;
  const scoring = {
    ...emptyScoring(),
    you: { points: played.score, moves: 1, best: played.score, bingos: 0 },
  };
  const game: Game = {
    ...gameWithMoves([]),
    board,
    rack: "EE",
    trackedMoves: undefined,
    scoring,
    past: [
      {
        board: before,
        rack: "CA?ERS",
        excludedRackSlots: [5],
        requiredRackSlots: [0],
        premiums,
        player: "you",
        label: played.word,
        score: played.score,
        at: "1",
      },
      { board, rack: "ERS", scoring, label: "Edited rack", at: "2" },
    ],
    future: [{ board, rack: "QQ", label: "Edited rack", at: "3" }],
  };
  const archived = archiveForReview(game);
  const frozen = restoreArchivedGame(archived);
  assert.deepEqual(
    [archived.past, archived.future, frozen.past, frozen.future],
    [[], [], [], []],
  );
  assert.deepEqual(archived.board, board);
  assert.equal(archived.rack, "EE");
  assert.deepEqual(frozen.scoring, scoring);
  const [turn] = reviewTurns(frozen);
  assert.equal(turn.move.bingo, false);
  assert.equal(turn.position?.rack, "CA?ERS");
  assert.deepEqual(turn.position?.excludedRackSlots, [5]);
  assert.deepEqual(turn.position?.requiredRackSlots, [0]);
  assert.deepEqual(turn.position?.board, before);
  assert.deepEqual(turn.position?.premiums, premiums);
  assert.equal(turn.position?.tiles.at(-1)?.letter, "t");
  assert.equal(gameReplayFrames(archived)[0].rack, "CA?ERS");
  assert.equal(summarizeGame(archived).fullMoveHistory, false);
  assert.equal(compactArchivedHistory(archived), archived);
  assert.equal(compactArchivedHistory(game), game);
  assert.equal(game.past.length, 2);
});

test("an edited archive keeps both move logs and their separate rack contexts", () => {
  const board = emptyBoard(15);
  const move: TrackedMove = {
    player: "you",
    word: "AT",
    score: 4,
    at: "1",
    bingo: false,
    review: {
      board,
      rack: "ATX",
      dictionaryId: "previous",
      tiles: [
        { index: 112, letter: "A" },
        { index: 113, letter: "T" },
      ],
    },
  };
  const played = [...board];
  played.splice(112, 2, "A", "T");
  const original = archiveGame({
    ...gameWithMoves([move]),
    board: played,
    past: [
      {
        board,
        rack: "ATX",
        excludedRackSlots: [2],
        label: "AT",
        player: "you",
        score: 4,
        at: "1",
      },
    ],
  });
  const edited: Game = {
    ...original,
    trackedMoves: [
      ...trackedMoveHistory(original),
      {
        player: "opponent",
        word: "TO",
        score: 3,
        at: "2",
        review: {
          board: played,
          observerRack: "XYZABCD",
          dictionaryId: "test",
          tiles: [{ index: 128, letter: "O" }],
        },
      },
    ],
    rack: "XYZABCD",
  };
  const result = compactArchivedHistory(edited);
  const frozen = restoreArchivedGame(result);
  assert.deepEqual(result.trackedMoves?.[0].review?.excludedRackSlots, [2]);
  assert.deepEqual(frozen.trackedMoves?.[0].review?.excludedRackSlots, [2]);
  assert.equal(frozen.trackedMoves?.[0].review?.dictionaryId, "previous");
  assert.equal(result.trackedMoves?.[1].review?.observerRack, "XYZABCD");
  assert.equal(result.trackedMoves?.[1].review?.rack, undefined);
  assert.equal(gameReplayFrames(result).length, 2);
  assert.equal(frozen.trackedMoves?.length, 1);
});

test("old snapshot imports and score-only turns retain their meaning after archiving", () => {
  const game = {
    ...gameWithMoves([{ player: "opponent", word: "CAT", score: 10, at: "1" }]),
    past: [
      {
        board: emptyBoard(15),
        rack: "",
        label: "Imported screenshot",
        at: "2",
      },
    ],
  };
  const archived = archiveForReview(game);
  assert.equal(tracksScores(archived), false);
  assert.equal(restoreArchivedGame(archived).scoring?.imported, true);
  const [, frame] = gameReplayFrames(archived);
  assert.equal(frame.position, undefined);
  assert.equal(frame.rack, undefined);
  assert.equal(frame.scores.opponent, 10);
});

test("legacy hover scores keep their attribution on the original archived board", () => {
  const game = gameWithMoves([]);
  const initial = game.board;
  const board = [...initial];
  board.splice(111, 3, "C", "A", "T");
  const legacy: Game = {
    ...game,
    board,
    past: [{ board: initial, rack: "", label: "CAT", score: 10, at: "1" }],
  };
  const original = boardWordsAt(legacy, 112);
  assert.equal(original[0].fromPlay, true);
  const archived = gameSchema.parse(archiveForReview(legacy));
  assert.deepEqual(boardWordsAt(archived, 112), original);
  assert.equal(archived.trackedMoves?.length, 0);
  assert.deepEqual(archived.past, []);
  const edited = { ...archived, board: [...board] };
  edited.board[114] = "S";
  assert.equal(boardWordsAt(edited, 112)[0].fromPlay, false);
  assert.deepEqual(boardWordsAt(restoreArchivedGame(edited), 112), original);
});

test("pruning edits does not credit a removed and replaced word to an old move", () => {
  const game = gameWithMoves([]);
  const initial = game.board;
  const board = [...initial];
  board.splice(111, 3, "C", "A", "T");
  const scoring = {
    ...emptyScoring(),
    you: { points: 10, moves: 1, best: 10, bingos: 0 },
  };
  const replaced: Game = {
    ...game,
    board,
    scoring,
    trackedMoves: [
      {
        player: "you",
        word: "CAT",
        score: 10,
        at: "1",
        bingo: false,
        review: {
          board: initial,
          rack: "CAT",
          dictionaryId: "test",
          tiles: [
            { index: 111, letter: "C" },
            { index: 112, letter: "A" },
            { index: 113, letter: "T" },
          ],
        },
      },
    ],
    past: [
      { board, rack: "", scoring, label: "Erased board letters", at: "2" },
      {
        board: initial,
        rack: "",
        scoring,
        label: "Entered board letters",
        at: "3",
      },
    ],
  };
  const original = boardWordsAt(replaced, 112);
  assert.equal(original[0].fromPlay, false);
  const archived = gameSchema.parse(archiveForReview(replaced));
  assert.deepEqual(boardWordsAt(archived, 112), original);
  assert.equal(gameReplayFrames(archived)[1].position?.rack, "CAT");
});
