import assert from "node:assert/strict";
import { test } from "node:test";
import {
  archiveForReview,
  compactArchivedHistory,
} from "../shared/archive-history";
import { summarizeGame } from "../shared/game-index";
import { gameReplayTimeline, hasRecordedMoves } from "../shared/game-replay";
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
import { TILE_SYMBOLS } from "../shared/tile-pool";
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

test("replay keeps the archived rack order and highlights the slots played", () => {
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
      rack: "C.A?AE",
      requiredRackSlots: [4],
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
  const [before, after] = gameReplayTimeline(game).frames;
  assert.equal(before.board, board);
  assert.equal(before.rack, "C.A?AE");
  assert.equal(before.playedSlots, undefined);
  assert.equal(after.template.premiums, premiums);
  assert.equal(after.position?.tiles[2].letter, "t");
  assert.equal(after.rack, "C.A?AE");
  assert.deepEqual(after.bag, { count: 88, estimated: true, invalid: false });
  assert.deepEqual(before.bag, after.bag);
  assert.equal(after.unseen?.total, 95);
  assert.equal(after.unseen?.tiles.find(({ symbol }) => symbol === "?")?.count, 1);
  const solo = gameReplayTimeline({ ...restoreArchivedGame(game), solo: true });
  assert.deepEqual(solo.frames[1].bag, { count: 95, estimated: false, invalid: false });
  assert.deepEqual(after.playedSlots, [0, 4, 3]);
  assert.deepEqual(after.scores, { you: 14, opponent: 0 });
  assert.equal(game.board[0], "X");
});

test("replay only shows an opponent rack established by the historical tile pool", () => {
  const board = emptyBoard(15);
  board[112] = "e";
  const tileCounts = {
    ...Object.fromEntries(TILE_SYMBOLS.map((tile) => [tile, 0])),
    A: 2, N: 1, T: 2, "?": 2,
  };
  const review = {
    board,
    dictionaryId: "test",
    observerRack: "AT",
    tiles: [{ index: 111, letter: "A" }, { index: 113, letter: "t" }],
  };
  const move: TrackedMove = {
    player: "opponent", word: "AET", score: 2, at: "", review,
  };
  const game = {
    ...gameWithMoves([move]),
    template: { ...PRESETS[0], tileCounts },
  };
  const [, known] = gameReplayTimeline(game).frames;
  assert.equal(known.rack, "ANT?");
  assert.deepEqual(known.playedSlots, [0, 3]);
  assert.equal(known.opponentPlayedTiles, "A?");
  assert.deepEqual(known.bag, { count: 0, estimated: true, invalid: false });

  const [, midgame] = gameReplayTimeline({ ...game, template: PRESETS[0] }).frames;
  assert.equal(midgame.rack, undefined);
  assert.equal(midgame.opponentPlayedTiles, "A?");
  assert.equal(midgame.bag?.count, 90);

  const cases = [
    { ...game, template: PRESETS[0] },
    { ...game, trackedMoves: [{ ...move, review: { ...review, observerRack: undefined } }] },
    { ...game, trackedMoves: [{ ...move, review: { ...review, observerRack: "AAT" } }] },
    { ...game, trackedMoves: [{ ...move, review: { ...review, observerRack: "AX" } }] },
  ];
  for (const invalid of cases) {
    const [, frame] = gameReplayTimeline(invalid).frames;
    assert.equal(frame.rack, undefined);
    assert.equal(frame.playedSlots, undefined);
  }
});

test("replay recovers an exact endgame rack across contiguous older opponent turns", () => {
  const opening = emptyBoard(15);
  opening[112] = "E";
  const afterFirst = opening.slice();
  afterFirst[111] = "T";
  afterFirst[113] = "A";
  const final = afterFirst.slice();
  final[114] = "M";

  const moves: TrackedMove[] = [
    {
      player: "opponent", word: "TEA", score: 3, at: "",
      review: {
        board: opening, dictionaryId: "test",
        tiles: [{ index: 111, letter: "T" }, { index: 113, letter: "A" }],
      },
    },
    {
      player: "opponent", word: "TEAM", score: 6, at: "",
      review: {
        board: afterFirst, dictionaryId: "test",
        tiles: [{ index: 114, letter: "M" }],
      },
    },
  ];
  const game = {
    ...gameWithMoves(moves),
    board: final,
    rack: "SN",
    template: {
      ...PRESETS[0],
      tileCounts: Object.fromEntries(TILE_SYMBOLS.map((symbol) => [
        symbol, Number("AEMNSTZ".includes(symbol)),
      ])),
    },
  };
  const archived = archiveForReview(game);
  const [start, first, second] = gameReplayTimeline({ ...archived, rack: "ZZ" }).frames;
  assert.equal(start.rack, "SN");
  assert.equal(first.rack, "AMTZ");
  assert.equal(second.rack, "MZ");
  assert.equal(first.bag?.count, 0);
  assert.deepEqual(first.playedSlots, [2, 0]);

  const mismatched = final.slice();
  mismatched[0] = "Z";
  const [, unknown] = gameReplayTimeline({ ...game, board: mismatched }).frames;
  assert.equal(unknown.rack, undefined);
  assert.equal(unknown.opponentPlayedTiles, "TA");
});

test("score-only moves keep their points and do not invent a board or rack", () => {
  const game = gameWithMoves([
    { player: "opponent", word: "CAT", score: 10, at: "" },
  ]);
  const [opening, scoreOnly] = gameReplayTimeline(game).frames;
  assert.equal(opening.board, undefined);
  assert.equal(scoreOnly.board, undefined);
  assert.equal(scoreOnly.rack, undefined);
  assert.equal(scoreOnly.bag, undefined);
  assert.equal(scoreOnly.unseen, undefined);
  assert.equal(scoreOnly.opponentPlayedTiles, undefined);
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
  assert.equal(gameReplayTimeline(archived).frames[0].rack, "CA?ERS");
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
  assert.equal(gameReplayTimeline(result).frames.length, 2);
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
  const [, frame] = gameReplayTimeline(archived).frames;
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
  assert.equal(gameReplayTimeline(archived).frames[1].position?.rack, "CAT");
});
