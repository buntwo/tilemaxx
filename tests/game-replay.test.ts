import assert from "node:assert/strict";
import { test } from "node:test";
import {
  archiveForReview,
  compactArchivedHistory,
} from "../shared/archive-history";
import { summarizeGame } from "../shared/game-index";
import { gameReplayTimeline, hasRecordedMoves, replayGamePosition } from "../shared/game-replay";
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
import { getTileCounts, TILE_SYMBOLS } from "../shared/tile-pool";
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

test("replay infers a refill from the next matching rack, preserving duplicates and blanks", () => {
  const board = emptyBoard(15);
  const tiles = [{ index: 111, letter: "C" }, { index: 112, letter: "A" }, { index: 113, letter: "T" }];
  const after = board.slice();
  for (const { index, letter } of tiles) after[index] = letter;
  const played: TrackedMove = {
    player: "you", word: "CAT", score: 10, at: "",
    review: { board, tiles, rack: "CATEEIN", dictionaryId: "test" },
  };
  const next: TrackedMove = {
    player: "opponent", word: "CATS", score: 6, at: "",
    review: { board: after, tiles: [{ index: 114, letter: "S" }], observerRack: "INE?OEE", dictionaryId: "test" },
  };
  const game = gameWithMoves([played, next]);
  const [opening, own, opponent] = gameReplayTimeline(game).frames;
  assert.equal(opening.draw, undefined);
  assert.deepEqual(own.draw, { tiles: "?EO", count: 3 });
  assert.equal(opponent.draw, undefined);

  for (const review of [
    { ...next.review!, observerRack: undefined },
    { ...next.review!, observerRack: "IAE?OUV" },
    { ...next.review!, observerRack: "INE?ZEE", board: after.map((tile, i) => i === 0 ? "Z" : tile) },
    { ...next.review!, observerRack: "INEZZEE" },
  ]) {
    const [, frame] = gameReplayTimeline({ ...game, trackedMoves: [played, { ...next, review }] }).frames;
    assert.deepEqual(frame.draw, { tiles: "", count: 3 });
  }

  const refillInProgress = { ...game, trackedMoves: [played], board: after, rack: "EEIO.N" };
  assert.deepEqual(gameReplayTimeline(refillInProgress).frames[1].draw, { tiles: "O", count: 3 });
  const archived = archiveForReview({ ...refillInProgress, rack: next.review!.observerRack! });
  assert.deepEqual(gameReplayTimeline({ ...archived, rack: "O" }).frames[1].draw, { tiles: "?EO", count: 3 });
});

test("replay shows a short solo refill and skips the shelf when the bag is empty", () => {
  const board = emptyBoard(15);
  const move: TrackedMove = {
    player: "you", word: "AT", score: 4, at: "",
    review: {
      board, rack: "ATE", dictionaryId: "test",
      tiles: [{ index: 112, letter: "A" }, { index: 113, letter: "T" }],
    },
  };
  const after = board.slice();
  after[112] = "A";
  after[113] = "T";
  for (const tiles of ["AET", "AETS"]) {
    const game: Game = {
      ...gameWithMoves([move]),
      solo: true,
      board: after,
      rack: "E" + (tiles.includes("S") ? "S" : ""),
      template: {
        ...PRESETS[0],
        tileCounts: Object.fromEntries(TILE_SYMBOLS.map((tile) => [tile, Number(tiles.includes(tile))])),
      },
    };
    assert.deepEqual(gameReplayTimeline(game).frames[1].draw, tiles.includes("S") ? { tiles: "S", count: 1 } : undefined);
  }
});

test("replay omits the draw when the two-player bag shows zero and the next rack is missing", () => {
  const board = emptyBoard(15);
  const tiles = [{ index: 112, letter: "A" }, { index: 113, letter: "T" }];
  const after = board.slice();
  for (const { index, letter } of tiles) after[index] = letter;
  const game: Game = {
    ...gameWithMoves([
      { player: "you", word: "AT", score: 4, at: "", review: { board, tiles, rack: "ATE", dictionaryId: "test" } },
      { player: "opponent", word: "ATS", score: 3, at: "", review: {
        board: after, tiles: [{ index: 114, letter: "S" }], dictionaryId: "test",
      } },
    ]),
    template: {
      ...PRESETS[0],
      tileCounts: Object.fromEntries(TILE_SYMBOLS.map((tile) => [tile, Number("AENTS".includes(tile))])),
    },
  };
  const [, frame] = gameReplayTimeline(game).frames;
  assert.equal(frame.unseen?.total, 2);
  assert.deepEqual(frame.bag, { count: 0, estimated: true, invalid: false });
  assert.equal(frame.draw, undefined);
});

test("a short final refill uses the recovered observer rack in old and new archives", () => {
  const opening = emptyBoard(15);
  opening[112] = "O";
  const played = opening.slice();
  played[111] = "Z";
  played[113] = "O";
  const opponentPlayed = played.slice();
  opponentPlayed[97] = "D";
  const ownRack = "ZONAAEE";
  const nextRack = "AE.AENO";
  const physical = [...opening, ...ownRack, ..."DALEPST", "O"];
  const moves: TrackedMove[] = [
    {
      player: "you", word: "ZOO", score: 12, at: "1",
      review: { board: opening, rack: ownRack, dictionaryId: "test",
        tiles: [{ index: 111, letter: "Z" }, { index: 113, letter: "O" }] },
    },
    {
      player: "opponent", word: "DO", score: 3, at: "2",
      review: { board: played, dictionaryId: "test", tiles: [{ index: 97, letter: "D" }] },
    },
    {
      player: "you", word: "DON", score: 4, at: "3",
      review: { board: opponentPlayed, rack: nextRack, dictionaryId: "test",
        tiles: [{ index: 127, letter: "N" }] },
    },
  ];
  const game = {
    ...gameWithMoves(moves),
    board: opponentPlayed.map((tile, index) => index === 127 ? "N" : tile),
    rack: "AAEEO",
    template: {
      ...PRESETS[0],
      tileCounts: Object.fromEntries(TILE_SYMBOLS.map((tile) => [
        tile, physical.filter((symbol) => symbol === tile).length,
      ])),
    },
  };
  const archived = archiveForReview(game);
  const serialized = gameSchema.parse(JSON.parse(JSON.stringify(archived)));
  for (const candidate of [game, archiveGame(game), serialized]) {
    const [, own, opponent] = gameReplayTimeline(candidate).frames;
    assert.equal(own.rack, ownRack);
    assert.equal(own.bag?.count, 1);
    assert.deepEqual(own.draw, { tiles: "O", count: 1 });
    assert.equal(own.afterRack, "AAEENO");
    assert.equal(opponent.rack, "ADELPST");
    assert.equal(opponent.position?.observerRack, undefined);
  }
  assert.deepEqual(serialized.archivedState?.trackedMoves, moves);
  const recovery = serialized.archivedState?.replayRecovery;
  assert.deepEqual(recovery?.[0]?.draw, { tiles: "O", count: 1 });
  assert.equal(recovery?.[0]?.afterRack, "AAEENO");
  assert.equal(recovery?.[1]?.observerRack, nextRack);
  assert.equal(compactArchivedHistory(archived), archived);

  const savedOnly = structuredClone(serialized);
  delete savedOnly.archivedState!.trackedMoves![2].review!.rack;
  savedOnly.archivedState!.replayRecovery![1] = null;
  assert.deepEqual(gameReplayTimeline(savedOnly).frames[1].draw, { tiles: "O", count: 1 });
  savedOnly.archivedState!.replayRecovery![0]!.move = "stale";
  assert.deepEqual(gameReplayTimeline(savedOnly).frames[1].draw, { tiles: "", count: 1 });

  const mismatch = structuredClone(game);
  mismatch.trackedMoves![2].review!.board[0] = "T";
  assert.deepEqual(gameReplayTimeline(archiveGame(mismatch)).frames[1].draw, { tiles: "", count: 1 });
  const corrected = archiveForReview({
    ...game,
    past: [{ board: played, rack: nextRack, label: "Confirmed board correction", at: "1.5" }],
  });
  assert.deepEqual(gameReplayTimeline(corrected).frames[1].draw, { tiles: "", count: 1 });
});

test("archive recovery retains a uniquely scored placement alongside score-only history", () => {
  const opening = emptyBoard(15);
  const afterCat = opening.slice();
  afterCat.splice(111, 3, "C", "A", "T");
  const afterCats = afterCat.slice();
  afterCats[114] = "S";
  const scored = scorePlacement(afterCat, afterCats, PRESETS[0])!;
  const first: TrackedMove = {
    player: "you", word: "CAT", score: 10, at: "1",
    review: { board: opening, rack: "CATEIRS", dictionaryId: "test",
      tiles: [{ index: 111, letter: "C" }, { index: 112, letter: "A" }, { index: 113, letter: "T" }] },
  };
  const missing: TrackedMove = { player: "opponent", word: "CATS", score: scored.score, at: "2" };
  const third: TrackedMove = {
    player: "you", word: "AT", score: 2, at: "3",
    review: { board: afterCats, rack: "EIRNOPT", dictionaryId: "test", tiles: [{ index: 127, letter: "T" }] },
  };
  const game = gameWithMoves([first, missing, third]);
  const archived = archiveForReview(game);
  const recovered = archived.archivedState?.replayRecovery?.[1]?.position;
  assert.deepEqual(recovered?.board, afterCat);
  assert.deepEqual(recovered?.tiles, [{ index: 114, letter: "S" }]);
  assert.equal(recovered?.direction, "across");
  assert.equal(archived.archivedState?.trackedMoves?.[1].review, undefined);
  for (const candidate of [archiveGame(game), gameSchema.parse(archived)]) {
    const frame = gameReplayTimeline(candidate).frames[2];
    assert.deepEqual(frame.position, recovered);
    assert.equal(frame.scores.opponent, scored.score);
  }

  const correction: Game = { ...game, past: [
    { board: afterCat, rack: "", label: "Confirmed board correction", at: "1.5" },
  ] };
  const compacted = gameSchema.parse(archiveForReview(correction));
  assert.deepEqual(compacted.archivedState?.past, []);
  assert.equal(compacted.archivedState?.replayRecovery?.[0]?.correctionAfter, true);
  assert.equal(gameReplayTimeline(compacted).frames[2].position, undefined);
  assert.deepEqual(gameReplayTimeline(compacted).frames[3].board, afterCats);

  const changedLayout = structuredClone(third);
  changedLayout.review!.premiums = [...PRESETS[0].premiums];
  changedLayout.review!.premiums[114] = "TW";
  const blankCorrection = structuredClone(third);
  blankCorrection.review!.board[111] = "c";
  for (const invalid of [
    [first, { ...missing, score: missing.score + 1 }, third],
    [first, missing, { ...missing, at: "2.5" }, third],
    [first, missing, changedLayout],
    [first, missing, blankCorrection],
  ]) {
    const frames = gameReplayTimeline(archiveForReview(gameWithMoves(invalid))).frames;
    assert.equal(frames[2].position, undefined);
  }

  const stale = structuredClone(archived);
  stale.archivedState!.trackedMoves![1].score += 1;
  assert.equal(gameReplayTimeline(stale).frames[2].position, undefined);
  const malformed = structuredClone(archived);
  malformed.archivedState!.replayRecovery![1]!.position!.tiles.push({ index: 114, letter: "S" });
  assert.equal(gameSchema.safeParse(malformed).success, false);
});

test("replay exposes a board-based tile pool and flags overdrawn placements without a saved rack", () => {
  const board = emptyBoard(15);
  board[112] = "A";
  const move: TrackedMove = {
    player: "opponent", word: "AAT", score: 3, at: "",
    review: {
      board, dictionaryId: "test",
      tiles: [{ index: 111, letter: "A" }, { index: 113, letter: "T" }],
    },
  };
  const game = {
    ...gameWithMoves([move]),
    template: { ...PRESETS[0], tileCounts: { ...getTileCounts(PRESETS[0]), A: 1 } },
  };
  const [before, after] = gameReplayTimeline(game).frames;
  assert.ok(before.unseenRackUnknown);
  assert.ok(after.unseenRackUnknown);
  assert.equal(before.bag?.count, after.bag?.count);
  assert.equal(before.bag?.invalid, false);
  assert.equal(after.bag?.invalid, true);
  assert.deepEqual(after.unseen?.excess.map(({ symbol, excess }) => [symbol, excess]), [["A", 1]]);
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

test("a replay trial starts with the historical layout, physical rack and scores", () => {
  const board = emptyBoard(15);
  board[112] = "A";
  const source = archiveGame(gameWithMoves([]));
  const move: TrackedMove = { player: "opponent", word: "CAT", score: 5, at: "" };
  const frame = {
    board,
    template: { ...source.template, bingo: 40 },
    move,
    position: {
      board, dictionaryId: "historical", tiles: [{ index: 111, letter: "c" }, { index: 113, letter: "T" }],
    },
    opponentPlayedTiles: "?T",
    scores: { you: 21, opponent: 15 },
  };
  const trial = replayGamePosition(source, frame, { you: 21, opponent: 10 }, 3);
  assert.equal(trial.rack, "?T");
  assert.equal(trial.scoring?.you.points, 10);
  assert.equal(trial.scoring?.opponent.points, 21);
  assert.equal(trial.dictionaryId, "historical");
  assert.equal(trial.template.bingo, 40);
  assert.deepEqual(trial.board, board);
  assert.deepEqual(trial.past, []);
  assert.deepEqual(trial.future, []);
  assert.equal(trial.archivedState, undefined);
  assert.equal(source.archived, true);
  assert.equal(source.rack, "ZYXWVUT");

  const own = replayGamePosition(source, {
    ...frame, move: { ...move, player: "you" }, rack: "ZC.AT", playedSlots: [1, 3, 4],
    position: { ...frame.position, requiredRackSlots: [3], excludedRackSlots: [0] },
  }, { you: 21, opponent: 10 }, 3);
  assert.equal(own.rack, "ZACT");
  assert.deepEqual(own.requiredRackSlots, [1]);
  assert.deepEqual(own.excludedRackSlots, [0]);
});
