import assert from "node:assert/strict";
import { test } from "node:test";
import { gameSchema } from "../server/validation";
import { BoardEditHistory } from "../shared/board-entry";
import { summarizeGame } from "../shared/game-index";
import {
  backfillGameResult,
  boardWordsAt,
  correctTrackedMove,
  displayedGameScoring,
  emptyScoring,
  endGameManually,
  gameScoreTotals,
  lastRecordedBoardPlay,
  nextPlayerToMove,
  pendingOpponentPlay,
  pendingOpponentTurns,
  playTrackedMove,
  recordOpponentPlay,
  recordOpponentPlayForSearch,
  recordOpponentRackOut,
  reopenSearchRecordedOpponentPlay,
  scoreTotalsAtPosition,
  setScoreTracking,
  summarizeGameScore,
  tracksScores,
  treatBoardEditAsCorrection,
  unplayedRackPoints,
} from "../shared/game-scoring";
import { Lexicon } from "../shared/lexicon";
import {
  archiveGame,
  emptyBoard,
  localDate,
  redo,
  remember,
  restoreArchivedGame,
  trackedMoveHistory,
  tileScore,
  undo,
  type Game,
} from "../shared/model";
import { PRESETS } from "../shared/presets";
import { importBoard } from "../shared/screenshot";
import { solve } from "../shared/solver";
import { TILE_SYMBOLS } from "../shared/tile-pool";

function fixture(): Game {
  return {
    id: "g",
    profileId: "p",
    name: "Test game",
    template: PRESETS[0],
    dictionaryId: "test",
    board: emptyBoard(15),
    rack: "",
    past: [],
    future: [],
    revision: 0,
    updatedAt: "",
    archived: false,
  };
}

test("the turn indicator follows the latest recorded word, including consecutive plays by one player", () => {
  const game = { ...fixture(), rack: "S" };
  const edits = new BoardEditHistory();
  const { start } = game.template;
  const opening = [...game.board];
  opening.splice(start, 3, ..."CAT");
  const entered = edits.apply(game, opening, "enter");
  assert.equal(nextPlayerToMove(entered), undefined);

  const recorded = recordOpponentPlayForSearch(entered);
  const extension = [...opening];
  extension[start + 3] = "S";
  const consecutive = recordOpponentPlayForSearch(edits.apply(recorded, extension, "enter"));
  const saved = gameSchema.parse(JSON.parse(JSON.stringify(consecutive)));
  assert.equal(nextPlayerToMove(recorded), "you");
  assert.equal(nextPlayerToMove(saved), "you");
  assert.equal(nextPlayerToMove({ ...saved, rack: "E" }), "you");
  assert.equal(nextPlayerToMove(archiveGame(saved)), undefined);
  assert.equal(nextPlayerToMove(endGameManually(saved, { manual: true })), undefined);
  assert.equal(nextPlayerToMove(setScoreTracking(saved, false)), undefined);
});

test("manual game results preserve the end date through saves, undo, redo, and archives", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 10, 16, 20) });
  const endedOn = "2026-11-16";
  const base = fixture();
  const game = {
    ...base,
    rack: "Q",
    template: {
      ...base.template,
      tileCounts: Object.fromEntries(
        TILE_SYMBOLS.map((tile) => [tile, Number("QS".includes(tile))]),
      ),
    },
    scoring: emptyScoring(),
  };
  game.scoring.you.points = 7;
  game.scoring.opponent.points = 15;
  assert.deepEqual(unplayedRackPoints(game), { you: 10, opponent: 1 });
  assert.equal(
    unplayedRackPoints({
      ...game,
      template: { ...game.template, rules: "crossplay" },
    }),
    undefined,
  );
  const scores = { you: -3, opponent: 14 };
  const ended = endGameManually(game, { manual: true, scores, outcome: "win" });
  const saved = gameSchema.parse(JSON.parse(JSON.stringify(ended)));
  assert.equal(saved.scoring?.end?.endedOn, endedOn);
  assert.deepEqual(gameScoreTotals(saved.scoring), scores);
  const archive = summarizeGame(archiveGame(saved));
  assert.equal(archive.endedOn, endedOn);
  assert.deepEqual(archive.score, {
    ...scores,
    outcome: "win",
  });
  assert.deepEqual(saved.board, game.board);
  assert.equal(saved.rack, "Q");
  const resumed = undo(saved);
  assert.deepEqual(resumed.scoring, game.scoring);
  assert.equal(summarizeGame(resumed).endedOn, undefined);
  t.mock.timers.setTime(new Date(2026, 10, 17, 8).getTime());
  assert.deepEqual(redo(resumed).scoring?.end, ended.scoring?.end);
  assert.deepEqual(trackedMoveHistory(saved), trackedMoveHistory(game));
  const unscored = endGameManually(
    { ...base, trackScores: false },
    { manual: true },
  );
  assert.deepEqual(unscored.scoring?.end, {
    manual: true,
    endedOn: "2026-11-17",
  });
  const unscoredArchive = summarizeGame(archiveGame(unscored));
  assert.equal(unscoredArchive.score, null);
  assert.equal(unscoredArchive.endedOn, "2026-11-17");
});

test("recording a pending turn folds separate board edits into one scored move after saving", () => {
  const game = fixture();
  const { start } = game.template;
  const edits = new BoardEditHistory();
  const board = [...game.board];
  board.splice(start, 3, "C", "A", "Q");
  const typo = edits.apply(game, [...board], "enter");
  board[start + 2] = "";
  const erased = edits.apply(typo, [...board], "erase");
  board[start + 2] = "T";
  const entered = edits.apply(erased, board, "enter");
  const pending = gameSchema.parse(
    JSON.parse(JSON.stringify({ ...entered, rack: "S" })),
  );
  assert.equal(pending.past.length, 3);

  const recorded = recordOpponentPlay(pending);
  assert.deepEqual(
    recorded.past.map(({ label }) => label),
    ["CAT"],
  );
  assert.deepEqual(undo(recorded).board, game.board);
  assert.deepEqual(undo(recorded).scoring, game.scoring);

  const move = solve(
    new Lexicon(["CATS"]),
    pending.board,
    "S",
    game.template,
  ).find((move) => move.tiles[0].index === start + 3)!;
  assert.ok(move);
  const played = playTrackedMove(pending, move);
  assert.deepEqual(
    played.past.map(({ label }) => label),
    ["CAT", "CATS"],
  );
  const afterOpponent = undo(played);
  assert.deepEqual(afterOpponent.board, pending.board);
  assert.equal(afterOpponent.rack, "S");
  assert.deepEqual(gameScoreTotals(afterOpponent.scoring), {
    you: 0,
    opponent: 10,
  });
  const beforeOpponent = undo(afterOpponent);
  assert.deepEqual(beforeOpponent.board, game.board);
  assert.equal(beforeOpponent.rack, game.rack);
  assert.deepEqual(trackedMoveHistory(beforeOpponent), []);
  const restored = redo(redo(beforeOpponent));
  assert.deepEqual(restored.board, played.board);
  assert.deepEqual(restored.scoring, played.scoring);
  assert.deepEqual(trackedMoveHistory(restored), trackedMoveHistory(played));
});

test("legacy rack-outs can be recovered from a recorded final play and a matching position", () => {
  const game = rackOutFixture("S");
  const move = solve(
    new Lexicon(["CATS"]),
    game.board,
    game.rack,
    game.template,
  ).find((move) => move.tiles[0].index === game.template.start + 3)!;
  const completed = playTrackedMove(game, move);
  const old = {
    ...completed,
    scoring: { ...completed.scoring!, end: undefined },
  };
  const finished = backfillGameResult(old);
  assert.deepEqual(finished.scoring?.end, { out: "you", rackPoints: 10 });
  assert.deepEqual(gameScoreTotals(finished.scoring), { you: 36, opponent: 0 });
  assert.deepEqual(trackedMoveHistory(finished), trackedMoveHistory(old));
  assert.equal(backfillGameResult(finished), finished);
  assert.equal(undo(finished).scoring?.end, undefined);
  assert.deepEqual(redo(undo(finished)).scoring?.end, finished.scoring?.end);

  const archived = archiveGame(old);
  const edited = { ...archived, board: [...archived.board] };
  edited.board[0] = "Q";
  const recoveredArchive = backfillGameResult(edited);
  assert.equal(recoveredArchive.board, edited.board);
  assert.equal(recoveredArchive.scoring, edited.scoring);
  assert.deepEqual(gameScoreTotals(displayedGameScoring(recoveredArchive)), {
    you: 36,
    opponent: 0,
  });
  assert.deepEqual(
    restoreArchivedGame(recoveredArchive).scoring?.end,
    finished.scoring?.end,
  );

  // Clearing a rack after a move does not establish that the play used it up.
  const incomplete = playTrackedMove(
    { ...game, rack: "SQ" },
    { ...move, leave: "Q" },
  );
  const cleared = { ...incomplete, rack: "" };
  assert.equal(backfillGameResult(cleared), cleared);
  assert.equal(
    backfillGameResult({ ...old, board: edited.board }).scoring?.end,
    undefined,
  );
});

test("correcting a finished rack-out transfers the corrected opponent rack value", () => {
  const game = fixture();
  game.rack = "AT";
  game.template = {
    ...game.template,
    tileCounts: Object.fromEntries(
      TILE_SYMBOLS.map((tile) => [tile, Number("AT?".includes(tile))]),
    ),
  };
  const opening = solve(new Lexicon(["AT"]), game.board, game.rack, game.template)[0];
  const finished = playTrackedMove(game, opening, 0);
  const end = { out: "you", rackPoints: 0, endedOn: localDate() };
  assert.deepEqual(finished.scoring?.end, end);
  const board = [...finished.board];
  const square = opening.tiles.find(({ letter }) => letter === "A")!.index;
  board[square] = "a";
  const corrected = new BoardEditHistory().apply(finished, board, "blank");
  assert.deepEqual(corrected.scoring?.end, { ...end, rackPoints: 1 });
  assert.deepEqual(gameScoreTotals(corrected.scoring), {
    you: opening.score - 1,
    opponent: -1,
  });
  assert.deepEqual(undo(corrected).scoring, finished.scoring);
  assert.deepEqual(redo(undo(corrected)).scoring, corrected.scoring);

  const withoutTile = [...finished.board];
  withoutTile[square] = "";
  const edits = new BoardEditHistory();
  const reentered = edits.apply(edits.apply(finished, withoutTile, "erase"), board, "enter");
  assert.deepEqual(reentered.scoring, corrected.scoring);
  assert.deepEqual(reentered.trackedMoves, corrected.trackedMoves);

  const archived = archiveGame(finished);
  const sandbox = new BoardEditHistory().apply(archived, board, "blank");
  assert.deepEqual(displayedGameScoring(sandbox), archived.archivedState?.scoring);
});

function rackOutFixture(rack: string): Game {
  const game = fixture();
  const { start } = game.template;
  game.board.splice(start, 3, "C", "A", "T");
  game.rack = rack;
  game.scoring = emptyScoring();
  game.scoring.you.points = 20;
  game.scoring.opponent.points = 10;
  game.template = {
    ...game.template,
    tileCounts: Object.fromEntries(
      TILE_SYMBOLS.map((tile) => [tile, Number("ACQST".includes(tile))]),
    ),
  };
  return game;
}

test("entering an opponent rack-out records their play and finish in one undo step", () => {
  const game = rackOutFixture("Q");
  const { start } = game.template;
  game.board[start + 2] = "";
  const history = new BoardEditHistory();
  const partial = [...game.board];
  partial[start + 2] = "T";
  const entered = history.apply(game, partial, "enter");
  assert.equal(entered.scoring?.end, undefined);
  const board = [...partial];
  board[start + 3] = "S";
  const finished = history.apply(entered, board, "enter");
  assert.deepEqual(finished.scoring?.end, {
    out: "opponent",
    rackPoints: 10,
    endedOn: localDate(),
  });
  assert.deepEqual(gameScoreTotals(finished.scoring), {
    you: 10,
    opponent: 26,
  });
  assert.equal(finished.scoring?.pendingBase, undefined);
  assert.deepEqual(
    trackedMoveHistory(finished).map(({ word, player, score }) => [
      word,
      player,
      score,
    ]),
    [["CATS", "opponent", 6]],
  );
  assert.equal(finished.past.length, 1);

  const restored = undo(finished);
  assert.deepEqual(restored.board, game.board);
  assert.deepEqual(restored.scoring, game.scoring);
  assert.deepEqual(trackedMoveHistory(restored), []);
  const redone = redo(restored);
  assert.deepEqual(redone.scoring, finished.scoring);
  assert.deepEqual(trackedMoveHistory(redone), trackedMoveHistory(finished));
  const stored = gameSchema.parse(
    JSON.parse(JSON.stringify(archiveGame(finished))),
  );
  assert.deepEqual(stored.scoring?.end, finished.scoring?.end);
  assert.deepEqual(stored.archivedState?.scoring?.end, finished.scoring?.end);
});

test("opponent rack-out waits for complete valid counts and a scoreable play", () => {
  const game = rackOutFixture("");
  const board = [...game.board];
  board[game.template.start + 3] = "S";
  const entered = new BoardEditHistory().apply(game, board, "enter");
  assert.equal(entered.scoring?.end, undefined);
  assert.equal(pendingOpponentPlay(entered)?.word, "CATS");
  for (const position of [
    { ...entered, rack: "QQ" },
    { ...entered, rack: "Q", archived: true },
    { ...entered, rack: "Q", trackScores: false },
    {
      ...entered,
      rack: "Q",
      template: { ...entered.template, rules: "crossplay" as const },
    },
  ]) {
    assert.equal(recordOpponentRackOut(position), position);
  }
  const disconnected = [...game.board];
  disconnected[0] = "S";
  const invalid = new BoardEditHistory().apply(
    { ...game, rack: "Q" },
    disconnected,
    "enter",
  );
  assert.equal(invalid.scoring?.end, undefined);
  assert.equal(pendingOpponentPlay(invalid), null);
  const finished = recordOpponentRackOut({ ...entered, rack: "Q" });
  assert.deepEqual(finished.scoring?.end, {
    out: "opponent",
    rackPoints: 10,
    endedOn: localDate(),
  });
  assert.equal(recordOpponentRackOut(finished), finished);
  assert.equal(finished.past.length, 1);
  const restored = undo(finished);
  assert.deepEqual(restored.board, game.board);
  assert.deepEqual(restored.scoring, game.scoring);
  assert.deepEqual(redo(restored).scoring, finished.scoring);
});

test("corrections to an opponent play recorded on search rescore it immediately after saving or redoing it", () => {
  const game = { ...fixture(), rack: "S" };
  const { start } = game.template;
  const edits = new BoardEditHistory();
  const opening = [...game.board];
  opening.splice(start, 3, ..."CAT");
  const recorded = recordOpponentPlayForSearch(edits.apply(game, opening, "enter"));
  const saved = gameSchema.parse(JSON.parse(JSON.stringify(recorded)));
  assert.equal(saved.past.at(-1)?.recordedOnSearch, true);
  assert.equal(saved.scoring?.opponent.points, 10);
  assert.equal(recordOpponentPlayForSearch(saved), saved);

  const redone = redo(undo(saved));
  const correctedBoard = [...redone.board];
  correctedBoard[start] = "c";
  const corrected = edits.apply(redone, correctedBoard, "blank");
  assert.equal(corrected.scoring?.opponent.points, 4);
  assert.equal(corrected.scoring?.pendingBase, undefined);
  assert.equal(nextPlayerToMove(corrected), "you");
  const [move] = trackedMoveHistory(corrected);
  assert.equal(move.at, trackedMoveHistory(redone)[0].at);
  assert.equal(move.review?.tiles[0].letter, "c");
  const last = lastRecordedBoardPlay(corrected);
  assert.equal(last?.move, move);
  assert.equal(last?.breakdown?.score, 4);
  assert.equal(last?.main?.tiles[0].blank, true);
  assert.equal(boardWordsAt(corrected, start)[0].score, 4);
  assert.equal(recordOpponentPlayForSearch(corrected), corrected);
  assert.deepEqual(undo(corrected).board, opening);
  assert.deepEqual(undo(corrected).scoring, redone.scoring);
  assert.deepEqual(redo(undo(corrected)).scoring, corrected.scoring);

  const reopened = reopenSearchRecordedOpponentPlay(corrected);
  assert.equal(reopened.scoring?.opponent.points, 0);
  assert.equal(pendingOpponentPlay(reopened)?.score, 4);
  assert.deepEqual(trackedMoveHistory(undo(reopened)), [move]);
  const extended = [...corrected.board];
  extended[start + 3] = "S";
  const revised = recordOpponentPlayForSearch(edits.apply(reopened, extended, "enter"));
  assert.deepEqual(trackedMoveHistory(revised).map(({ word, score }) => [word, score]), [
    ["CATS", 6],
  ]);

  const erasedBoard = [...corrected.board];
  erasedBoard[start + 2] = "";
  const erased = edits.apply(corrected, erasedBoard, "erase");
  assert.equal(pendingOpponentPlay(erased)?.word, "CA");
  assert.deepEqual(trackedMoveHistory(erased), []);
  assert.deepEqual(trackedMoveHistory(undo(erased)), [move]);
});

test("replacing the only tile of a search-recorded turn matches toggling or overwriting it", () => {
  const played = crossedCat();
  const { start, size } = played.template;
  const square = start + size;
  const edits = new BoardEditHistory();
  const board = [...played.board];
  board[square] = "T";
  const recorded = recordOpponentPlayForSearch(edits.apply(played, board, "enter"));
  assert.equal(lastRecordedBoardPlay(recorded)?.move.word, "RAT");
  const withoutTile = [...board];
  withoutTile[square] = "";
  const erased = edits.apply(recorded, withoutTile, "erase");
  assert.equal(erased.scoring?.pendingBase, undefined);
  assert.equal(trackedMoveHistory(erased).length, 2);

  // Re-entering still finds the original turn after a remount or reload.
  const saved = gameSchema.parse(JSON.parse(JSON.stringify(erased)));
  for (const [letter, kind] of [
    ["T", "enter"],
    ["t", "blank"],
    ["S", "enter"],
  ] as const) {
    const replacement = [...board];
    replacement[square] = letter;
    const direct = new BoardEditHistory().apply(recorded, replacement, kind);
    const reentered = new BoardEditHistory().apply(saved, replacement, "enter");
    assert.deepEqual(reentered.scoring, direct.scoring);
    assert.deepEqual(trackedMoveHistory(reentered), trackedMoveHistory(direct));
    assert.equal(
      lastRecordedBoardPlay(reentered)?.breakdown?.score,
      lastRecordedBoardPlay(direct)?.breakdown?.score,
    );
    assert.equal(nextPlayerToMove(reentered), "you");
    assert.equal(recordOpponentPlayForSearch(reentered), reentered);
    assert.deepEqual(undo(reentered).board, withoutTile);
    assert.deepEqual(undo(undo(reentered)).board, board);
    assert.deepEqual(redo(undo(reentered)).trackedMoves, reentered.trackedMoves);
  }

  const differentPlay = [...withoutTile];
  differentPlay[start + 2] = "S";
  const revised = edits.apply(erased, differentPlay, "enter");
  assert.equal(pendingOpponentPlay(revised)?.word, "CATS");
  assert.equal(trackedMoveHistory(revised).length, 2);
});

test("finished games rescore tiles erased in separate edits in either refill order", () => {
  const game = fixture();
  const { start } = game.template;
  const cat = [...game.board];
  cat.splice(start, 3, ..."CAT");
  const edits = new BoardEditHistory();
  const finished = endGameManually(
    recordOpponentPlayForSearch(edits.apply(game, cat, "enter")),
    { manual: true },
  );
  function change(game: Game, offset: number, letter: string, kind: "erase" | "enter") {
    const board = [...game.board];
    board[start + offset] = letter;
    return new BoardEditHistory().apply(game, board, kind);
  }
  const erased = change(change(finished, 0, "", "erase"), 1, "", "erase");
  for (const [first, second] of [[0, 1], [1, 0]]) {
    const letters = ["c", "a"];
    const partial = change(erased, first, letters[first], "enter");
    const loaded = gameSchema.parse(JSON.parse(JSON.stringify(partial)));
    const corrected = change(loaded, second, letters[second], "enter");
    assert.equal(corrected.scoring?.opponent.points, 2);
    assert.equal(lastRecordedBoardPlay(corrected)?.breakdown?.score, 2);
    assert.deepEqual(trackedMoveHistory(corrected)[0].review?.tiles.map(({ letter }) => letter), ["c", "a", "T"]);
    assert.deepEqual(undo(corrected).scoring, loaded.scoring);
    assert.deepEqual(redo(undo(corrected)).trackedMoves, corrected.trackedMoves);
  }
});

test("an explicitly reopened play can take more tiles, while a fresh placement can be a second opponent turn", () => {
  const game = fixture();
  const { start } = game.template;
  const history = new BoardEditHistory();
  const opening = [...game.board];
  opening.splice(start, 3, ..."CAT");
  const recorded = recordOpponentPlayForSearch(history.apply(game, opening, "enter"));
  const extended = [...opening];
  extended[start + 3] = "S";

  const anotherTurn = recordOpponentPlayForSearch(history.apply(recorded, extended, "enter"));
  assert.deepEqual(trackedMoveHistory(anotherTurn).map(({ word, score }) => [word, score]), [
    ["CAT", 10], ["CATS", 6],
  ]);
  assert.deepEqual(undo(anotherTurn).board, opening);

  const reopened = reopenSearchRecordedOpponentPlay(recorded);
  const revised = recordOpponentPlayForSearch(history.apply(reopened, extended, "enter"));
  assert.deepEqual(trackedMoveHistory(revised).map(({ word, score }) => [word, score]), [
    ["CATS", 12],
  ]);
  assert.deepEqual(undo(revised).board, game.board);
});

test("a continuous deletion of the full auto-recorded word can be undone in one step", () => {
  const game = fixture();
  const { start } = game.template;
  const edits = new BoardEditHistory();
  const opening = [...game.board];
  opening.splice(start, 3, ..."CAT");
  const recorded = recordOpponentPlayForSearch(edits.apply(game, opening, "enter"));
  let erased = recorded;
  for (let i = start + 2; i >= start; i--) {
    const board = [...erased.board];
    board[i] = "";
    erased = edits.apply(erased, board, "erase");
  }
  assert.deepEqual(erased.board, game.board);
  assert.equal(erased.scoring?.opponent.moves, 0);
  assert.deepEqual(trackedMoveHistory(erased), []);
  const restored = undo(erased);
  assert.deepEqual(restored.board, opening);
  assert.deepEqual(restored.scoring, recorded.scoring);
  assert.deepEqual(trackedMoveHistory(restored), trackedMoveHistory(recorded));
  assert.deepEqual(trackedMoveHistory(redo(restored)), []);
});

test("search leaves ambiguous, untracked, archived, and undone board entries alone", () => {
  const game = fixture();
  const { start } = game.template;
  const edits = new BoardEditHistory();
  const board = [...game.board];
  board[start] = "C";
  const partial = edits.apply(game, [...board], "enter");
  assert.equal(recordOpponentPlayForSearch(partial), partial);
  board[start + 1] = "A";
  const entered = edits.apply(partial, [...board], "enter");
  for (const position of [
    { ...entered, trackScores: false },
    archiveGame(entered),
    insertThenUndo(entered),
  ]) {
    assert.equal(recordOpponentPlayForSearch(position), position);
  }
  function insertThenUndo(position: Game) {
    const next = [...position.board];
    next[start + 2] = "T";
    edits.reset();
    return undo(edits.apply(position, next, "enter"));
  }
});

test("a rack refill after searching can establish opponent rack-out without a second score entry", () => {
  const game = rackOutFixture("");
  const board = [...game.board];
  board[game.template.start + 3] = "S";
  const entered = new BoardEditHistory().apply(game, board, "enter");
  const recorded = recordOpponentPlayForSearch(entered);
  assert.equal(recorded.scoring?.opponent.points, 16);
  assert.equal(recorded.scoring?.end, undefined);

  const finished = recordOpponentRackOut({ ...recorded, rack: "Q" });
  assert.deepEqual(finished.scoring?.end, {
    out: "opponent",
    rackPoints: 10,
    endedOn: localDate(),
  });
  assert.equal(trackedMoveHistory(finished).length, 1);
  assert.equal(finished.past.length, 1);
  assert.deepEqual(undo(finished).board, game.board);
});

test("playing out uses the actual remaining rack and respects a known nonempty bag", () => {
  const game = rackOutFixture("S");
  const move = solve(
    new Lexicon(["CATS"]),
    game.board,
    game.rack,
    game.template,
  ).find((move) => move.tiles[0].index === game.template.start + 3)!;
  assert.ok(move);
  const finished = playTrackedMove(game, move, 0);
  assert.deepEqual(finished.scoring?.end, {
    out: "you",
    rackPoints: 10,
    endedOn: localDate(),
  });
  assert.deepEqual(gameScoreTotals(finished.scoring), { you: 36, opponent: 0 });
  assert.equal(undo(finished).scoring?.end, undefined);
  assert.throws(() => playTrackedMove(finished, move), /game has ended/);
  assert.equal(playTrackedMove(game, move, 1).scoring?.end, undefined);
  const held = playTrackedMove(
    { ...game, rack: "S..Q", excludedRackSlots: [3] },
    move,
  );
  assert.equal(held.scoring?.end, undefined);
});

test("the full history badge requires tracked plays from an empty board to the saved position", () => {
  const game = { ...fixture(), rack: "CAT" };
  const lexicon = new Lexicon(["CAT", "CATS"]);
  const opening = solve(lexicon, game.board, game.rack, game.template)[0];
  const first = { ...playTrackedMove(game, opening), rack: "S" };
  const nextMove = solve(lexicon, first.board, first.rack, first.template)[0];
  const complete = playTrackedMove(first, nextMove);
  assert.equal(summarizeGame(game).fullMoveHistory, false);
  assert.equal(summarizeGame(complete).fullMoveHistory, true);
  assert.equal(summarizeGame({ ...complete, past: [] }).fullMoveHistory, true);
  const archived = archiveGame(complete);
  assert.equal(
    summarizeGame({ ...archived, board: game.board }).fullMoveHistory,
    true,
  );
  const partial = {
    ...setScoreTracking(importBoard(game, first.board), true),
    rack: "S",
  };
  assert.equal(
    summarizeGame(playTrackedMove(partial, nextMove)).fullMoveHistory,
    false,
  );
  const pending = [...first.board];
  for (const { index, letter } of nextMove.tiles) pending[index] = letter;
  assert.equal(
    summarizeGame(new BoardEditHistory().apply(first, pending, "enter"))
      .fullMoveHistory,
    false,
  );
});

test("board hover scores each crossing word with its original premiums when available", () => {
  const game = fixture();
  const history = new BoardEditHistory();
  const opening = [...game.board];
  opening[111] = "C";
  opening[112] = "A";
  opening[113] = "T";
  const first = recordOpponentPlay(history.apply(game, opening, "enter"));
  const crossing = [...first.board];
  crossing[83] = "a";
  crossing[98] = "R";
  const pending = history.apply(first, crossing, "enter");
  for (const position of [pending, recordOpponentPlay(pending)]) {
    assert.deepEqual(boardWordsAt(position, 113), [
      {
        word: "CAT",
        direction: "across",
        cells: [111, 112, 113],
        score: 10,
        fromPlay: true,
      },
      {
        word: "ART",
        direction: "down",
        cells: [83, 98, 113],
        score: 3,
        fromPlay: true,
      },
    ]);
  }
  const imported = importBoard(first, crossing);
  assert.deepEqual(
    boardWordsAt(imported, 113).map(({ score, fromPlay }) => [score, fromPlay]),
    [
      [5, false],
      [2, false],
    ],
  );
});

test("board hover does not join the end of one row to the start of another", () => {
  const game = fixture();
  game.board[14] = "A";
  game.board[15] = "T";
  assert.deepEqual(boardWordsAt(game, 14), []);
});

test("board hover adds the bingo bonus only to the main word, using retained tracked moves", () => {
  for (const template of PRESETS.slice(0, 2)) {
    const game = { ...fixture(), template, rack: "RETAINS" };
    // An existing T above the S forms TS in the same turn.
    game.board[104] = "T";
    const move = solve(
      new Lexicon(["RETAINS", "TS"]),
      game.board,
      game.rack,
      template,
    ).find(
      (move) => move.direction === "across" && move.tiles.at(-1)?.index === 119,
    )!;
    assert.ok(move);
    const played = playTrackedMove(game, move);
    const [main, cross] = boardWordsAt(played, 119);
    assert.equal(main.word, "RETAINS");
    assert.equal(main.bingo, true);
    assert.equal(cross.word, "TS");
    assert.equal(cross.bingo, undefined);
    assert.equal(main.score + cross.score, move.score);
    const wordValue = boardWordsAt(
      { ...played, template: { ...template, bingo: 0 } },
      119,
    )[0].score;
    assert.equal(main.score - wordValue, template.bingo);
    assert.deepEqual(boardWordsAt({ ...played, past: [] }, 119), [main, cross]);
    assert.deepEqual(boardWordsAt(redo(undo(played)), 119), [main, cross]);
    const imported = importBoard({ ...played, past: [] }, played.board);
    const faceValue = [...move.word].reduce(
      (sum, letter) => sum + tileScore(letter, template.rules),
      0,
    );
    assert.equal(boardWordsAt(imported, 119)[0].score, faceValue);
    assert.equal(
      boardWordsAt({ ...imported, past: [] }, 119)[0].score,
      faceValue,
    );
  }
});

test("inferred plays match solver scoring for crosses, premiums, blanks and a bingo", () => {
  const game = fixture();
  game.board[112] = "A";
  const lexicon = new Lexicon(["AT", "TA", "CAT", "CATS", "ABCDEFG"]);
  const history = new BoardEditHistory();
  for (const [position, rack] of [
    [game, "CT?"],
    [{ ...game, board: emptyBoard(15) }, "ABCDEFG"],
  ] as const) {
    const moves = solve(lexicon, position.board, rack, position.template);
    assert.ok(moves.length);
    for (const move of moves) {
      const board = [...position.board];
      for (const { index, letter } of move.tiles) board[index] = letter;
      const edited = history.apply(position, board, "enter");
      const inferred = pendingOpponentPlay(edited);
      assert.equal(inferred?.score, move.score, move.id);
      assert.equal(inferred?.bingo, move.tiles.length === 7, move.id);
    }
  }
});

test("restoring an archived game restores its rack, scores and history while keeping metadata", () => {
  const game = fixture();
  game.rack = "CAT";
  const lexicon = new Lexicon(["CAT", "CATS"]);
  const opening = solve(lexicon, game.board, game.rack, game.template)[0];
  const archived = archiveGame({
    ...playTrackedMove(game, opening),
    rack: "S",
  });
  const reply = solve(
    lexicon,
    archived.board,
    archived.rack,
    archived.template,
  )[0];
  const edited = { ...playTrackedMove(archived, reply), notes: "New notes" };
  assert.notDeepEqual(edited.board, archived.board);
  const restored = restoreArchivedGame(JSON.parse(JSON.stringify(edited)));
  assert.deepEqual(
    JSON.parse(JSON.stringify(restored)),
    JSON.parse(JSON.stringify({ ...archived, notes: "New notes" })),
  );
});

test("deletion and replacement of recorded tiles remain corrections", () => {
  const history = new BoardEditHistory();
  const game = fixture();
  game.board[112] = "A";
  game.board[113] = "T";
  const changed = [...game.board];
  changed[113] = "";
  let edited = history.apply(game, changed, "erase");
  changed[113] = "S";
  edited = history.apply(edited, [...changed], "enter");
  assert.equal(pendingOpponentPlay(edited), null);
  assert.equal(recordOpponentPlay(edited), edited);
  assert.equal(
    treatBoardEditAsCorrection(edited).scoring?.pendingBase,
    undefined,
  );
  assert.equal(edited.scoring?.opponent.moves, 0);
});

function crossedCat() {
  // CAT spans G8–I8 through the opening double word. RA and AT cross the A
  // and T when RA is played next. The T and A score on both turns.
  const game = { ...fixture(), rack: "CATQ", excludedRackSlots: [3] };
  const lexicon = new Lexicon(["CAT", "ART", "RAT", "AR"]);
  const opening = solve(lexicon, game.board, "CAT", game.template).find(
    ({ direction, tiles }) => direction === "across" && tiles[0].index === 111,
  )!;
  const first = playTrackedMove(game, { ...opening, leave: "Q" });
  const next = [...first.board];
  next[98] = "A";
  next[97] = "R";
  return recordOpponentPlay(new BoardEditHistory().apply(first, next, "enter"));
}

test("blank corrections rescore both players using original premiums and survive save, undo and redo", () => {
  const played = crossedCat();
  const originalScores = trackedMoveHistory(played).map(({ score }) => score);
  assert.deepEqual(originalScores, [10, 8]);
  const edits = new BoardEditHistory();
  const board = [...played.board];
  board[112] = "a";
  const corrected = edits.apply(played, board, "blank");
  assert.equal(corrected.scoring?.pendingBase, undefined);
  assert.deepEqual(
    trackedMoveHistory(corrected).map(({ score }) => score),
    [8, 7],
  );
  assert.deepEqual(corrected.scoring?.you, {
    points: 8,
    moves: 1,
    best: 8,
    bingos: 0,
  });
  assert.deepEqual(corrected.scoring?.opponent, {
    points: 7,
    moves: 1,
    best: 7,
    bingos: 0,
  });
  assert.equal(corrected.rack, played.rack);
  const [opening, reply] = trackedMoveHistory(corrected);
  assert.equal(
    opening.review?.tiles.find(({ index }) => index === 112)?.letter,
    "a",
  );
  assert.equal(opening.review?.rack, "C?TQ");
  assert.deepEqual(opening.review?.excludedRackSlots, [3]);
  assert.equal(reply.review?.board[112], "a");
  assert.ok(summarizeGame(corrected).fullMoveHistory);
  assert.equal(boardWordsAt(corrected, 112)[0].score, 8);
  assert.equal(boardWordsAt(corrected, 112)[0].fromPlay, true);

  const original = gameSchema.parse(JSON.parse(JSON.stringify(played)));
  const saved = gameSchema.parse(JSON.parse(JSON.stringify(corrected)));
  const reverted = undo(saved);
  assert.deepEqual(reverted.board, played.board);
  assert.deepEqual(reverted.scoring, original.scoring);
  assert.deepEqual(reverted.trackedMoves, original.trackedMoves);
  assert.deepEqual(redo(reverted).trackedMoves, saved.trackedMoves);
  assert.deepEqual(redo(reverted).scoring, saved.scoring);
  assert.deepEqual(redo(reverted).board, saved.board);

  const switchedBack = new BoardEditHistory().apply(
    saved,
    played.board,
    "blank",
  );
  assert.deepEqual(
    gameSchema.parse(JSON.parse(JSON.stringify(switchedBack))).scoring,
    original.scoring,
  );
  assert.deepEqual(switchedBack.trackedMoves, played.trackedMoves);
});

test("a grouped letter replacement and a pending opponent play are tracked separately", () => {
  const played = crossedCat();
  const edits = new BoardEditHistory();
  const board = [...played.board];
  board[111] = "B";
  const replacement = edits.apply(played, [...board], "enter");
  board[113] = "t";
  const corrected = edits.apply(replacement, [...board], "enter");
  assert.equal(corrected.past.length, played.past.length + 1);
  assert.deepEqual(
    trackedMoveHistory(corrected).map(({ word, score }) => [word, score]),
    [
      ["BAT", 8],
      ["RA", 7],
    ],
  );
  assert.deepEqual(undo(corrected).trackedMoves, played.trackedMoves);
  assert.equal(corrected.scoring?.pendingBase, undefined);

  board[114] = "S";
  const pending = edits.apply(corrected, [...board], "enter");
  board[111] = "b";
  const edited = edits.apply(pending, [...board], "blank");
  assert.equal(pendingOpponentPlay(edited)?.word, "BATS");
  assert.equal(pendingOpponentPlay(edited)?.score, 2);
  assert.equal(edited.scoring?.opponent.moves, 1);
  const recorded = recordOpponentPlay(edited);
  assert.equal(recorded.scoring?.opponent.moves, 2);
  const reverted = undo(recorded);
  assert.deepEqual(reverted.board, edited.board);
  assert.deepEqual(reverted.trackedMoves, edited.trackedMoves);
  assert.deepEqual(undo(reverted).board, pending.board);
  assert.deepEqual(
    scoreTotalsAtPosition(edited),
    gameScoreTotals(recorded.scoring),
  );
  assert.equal(
    scoreTotalsAtPosition({ ...edited, trackScores: false }),
    undefined,
  );
});

test("bingo corrections use retained snapshots and leave previous scoring sessions alone", () => {
  const game = { ...fixture(), rack: "RETAINS" };
  const lexicon = new Lexicon(["RETAINS"]);
  const opening = solve(lexicon, game.board, game.rack, game.template)[0];
  const played = playTrackedMove(game, opening);
  const board = [...played.board];
  const tile = opening.tiles[0];
  board[tile.index] = tile.letter.toLowerCase();
  const corrected = new BoardEditHistory().apply(
    { ...played, past: [] },
    board,
    "blank",
  );
  assert.ok(corrected.scoring!.you.points < opening.score);
  assert.equal(corrected.scoring?.you.bingos, 1);
  assert.equal(corrected.scoring?.you.moves, 1);
  assert.equal(corrected.trackedMoves?.[0].bingo, true);
  assert.deepEqual(undo(corrected).trackedMoves, played.trackedMoves);

  const replacement = [...played.board];
  const replaced = opening.tiles[1].index;
  replacement[replaced] = "X";
  for (const position of [
    importBoard(played, played.board),
    setScoreTracking(importBoard(played, replacement), true),
  ]) {
    const tiles = [...position.board];
    tiles[tile.index] = board[tile.index];
    const edited = new BoardEditHistory().apply(position, tiles, "blank");
    assert.deepEqual(edited.scoring, position.scoring);
    assert.deepEqual(edited.trackedMoves, position.trackedMoves);
  }
});

test("score corrections recover turns from both undo formats when review positions are missing", () => {
  const legacy = crossedCat();
  delete legacy.trackedMoves;
  for (const entry of legacy.past) delete entry.review;
  const board = [...legacy.board];
  board[113] = "t";
  const opponent = legacy.past.at(-1)!;
  const { label, player, score, bingo, ...before } = opponent;
  const split = {
    ...legacy,
    past: [
      ...legacy.past.slice(0, -1),
      { ...before, label: "Entered board letters" },
      {
        ...before,
        label,
        player,
        score,
        bingo,
        board: legacy.board,
        scoring: { ...before.scoring!, pendingBase: before.board },
      },
    ],
  };
  for (const position of [legacy, split]) {
    const corrected = new BoardEditHistory().apply(position, board, "blank");
    assert.deepEqual(
      trackedMoveHistory(corrected).map(({ score }) => score),
      [8, 7],
    );
    assert.deepEqual(
      trackedMoveHistory(undo(corrected)).map(({ score }) => score),
      [10, 8],
    );
  }
  const { past, ...withoutUndoHistory } = legacy;
  const unknown = new BoardEditHistory().apply(
    { ...withoutUndoHistory, past: [] },
    board,
    "blank",
  );
  assert.deepEqual(unknown.scoring, legacy.scoring);
});

test("erasing then re-entering an existing tile as a blank rescored the original turn", () => {
  const played = crossedCat();
  const edits = new BoardEditHistory();
  const board = [...played.board];
  board[113] = "";
  const erased = edits.apply(played, [...board], "erase");
  assert.equal(erased.scoring?.pendingBase?.[113], "T");
  board[113] = "t";
  const corrected = edits.apply(erased, board, "enter");
  assert.equal(corrected.scoring?.pendingBase, undefined);
  assert.deepEqual(
    trackedMoveHistory(corrected).map(({ score }) => score),
    [8, 7],
  );
  assert.deepEqual(undo(corrected).scoring, erased.scoring);
});

test("import starts an untracked position and undo restores scores and the tracking preference", () => {
  const game = fixture();
  game.rack = "CAT";
  const move = solve(
    new Lexicon(["CAT"]),
    game.board,
    game.rack,
    game.template,
  )[0];
  const played = playTrackedMove(game, move);
  const imported = importBoard(played, emptyBoard(15));
  assert.equal(tracksScores(imported), false);
  assert.equal(imported.scoring?.you.points, 0);
  assert.deepEqual(trackedMoveHistory(imported), trackedMoveHistory(played));
  assert.equal(tracksScores(undo(imported)), true);
  assert.equal(undo(imported).scoring?.you.points, move.score);
  assert.equal(tracksScores(redo(undo(imported))), false);
  assert.equal(tracksScores(setScoreTracking(imported, true)), true);
  assert.equal(
    tracksScores(
      undo(importBoard(setScoreTracking(played, false), game.board)),
    ),
    false,
  );
});

test("reenabling tracking replays typed turns and solver plays from legacy saves", () => {
  const game = { ...fixture(), trackScores: false };
  const edits = new BoardEditHistory();
  const opening = [...game.board];
  opening.splice(game.template.start, 3, "C", "A", "Q");
  const typo = edits.apply(game, [...opening], "enter");
  opening[game.template.start + 2] = "";
  const erased = edits.apply(typo, [...opening], "erase");
  opening[game.template.start + 2] = "t";
  const entered = { ...edits.apply(erased, opening, "enter"), rack: "S" };
  const move = solve(
    new Lexicon(["CATS"]),
    entered.board,
    entered.rack,
    entered.template,
  ).find((move) => move.word === "CATS")!;
  const played = playTrackedMove(entered, move);
  const next = [...played.board];
  const hook = move.tiles[0].index;
  next[hook - game.template.size] = "I";
  const legacy = gameSchema.parse(
    JSON.parse(JSON.stringify(edits.apply(played, next, "enter"))),
  );

  const restored = setScoreTracking(legacy, true);
  assert.deepEqual(
    trackedMoveHistory(restored).map(({ player, word, score }) => [
      player,
      word,
      score,
    ]),
    [
      ["opponent", "CAT", 8],
      ["you", "CATS", move.score],
      ["opponent", "IS", 2],
    ],
  );
  assert.deepEqual(gameScoreTotals(restored.scoring), {
    you: move.score,
    opponent: 10,
  });
  assert.equal(restored.scoring?.pendingBase, undefined);
  assert.equal(restored.scoring?.incomplete, undefined);
  assert.equal(restored.board, legacy.board);
  assert.equal(restored.rack, legacy.rack);
  assert.equal(trackedMoveHistory(restored)[1].review?.rack, "S");

  const saved = gameSchema.parse(JSON.parse(JSON.stringify(restored)));
  const reverted = undo(saved);
  assert.equal(tracksScores(reverted), false);
  assert.deepEqual(reverted.trackedMoves, []);
  const reenabled = redo(reverted);
  assert.equal(tracksScores(reenabled), true);
  assert.deepEqual(reenabled.scoring, saved.scoring);
  assert.deepEqual(reenabled.trackedMoves, saved.trackedMoves);
  const twice = setScoreTracking(setScoreTracking(saved, false), true);
  assert.deepEqual(twice.trackedMoves, saved.trackedMoves);
  assert.deepEqual(
    gameSchema.parse(twice).scoring,
    gameSchema.parse(restored).scoring,
  );
});

test("a screenshot of a known board restores corrected scores and keeps recovering new moves", () => {
  const played = crossedCat();
  const corrected = correctTrackedMove(
    played,
    0,
    { player: "you", word: "CAT", score: 11 },
    false,
  );
  const imported = importBoard(corrected, corrected.board);
  assert.equal(tracksScores(imported), false);
  assert.equal(imported.scoring?.you.points, 0);
  const board = [...imported.board];
  board[114] = "S";
  const edited = new BoardEditHistory().apply(imported, board, "enter");
  const restored = setScoreTracking(edited, true);

  assert.deepEqual(
    trackedMoveHistory(restored).slice(0, 2),
    trackedMoveHistory(corrected),
  );
  assert.equal(trackedMoveHistory(restored)[2].word, "CATS");
  assert.equal(restored.scoring?.you.points, 11);
  assert.equal(
    restored.scoring?.opponent.points,
    corrected.scoring!.opponent.points + 6,
  );
  assert.equal(restored.scoring?.incomplete, undefined);
});

test("scores can be recovered after ending and archiving a game with tracking off", () => {
  const game = { ...fixture(), trackScores: false, rack: "CAT" };
  const opening = solve(
    new Lexicon(["CAT"]),
    game.board,
    game.rack,
    game.template,
  )[0];
  const ended = endGameManually(playTrackedMove(game, opening), {
    manual: true,
  });
  const archived = archiveGame(ended);
  const restored = setScoreTracking(archived, true);
  assert.equal(tracksScores(restored), true);
  assert.deepEqual(restored.scoring?.end, ended.scoring?.end);
  assert.deepEqual(gameScoreTotals(displayedGameScoring(restored)), {
    you: opening.score,
    opponent: 0,
  });
  assert.equal(summarizeGameScore(restored), null);
});

test("a screenshot adding unknown tiles restores known moves and labels the totals partial", () => {
  const played = crossedCat();
  const board = [...played.board];
  board[114] = "S";
  const imported = importBoard(played, board);
  const restored = setScoreTracking(imported, true);

  assert.deepEqual(trackedMoveHistory(restored), trackedMoveHistory(played));
  assert.deepEqual(
    gameScoreTotals(restored.scoring),
    gameScoreTotals(played.scoring),
  );
  assert.equal(restored.scoring?.incomplete, true);
  assert.equal(summarizeGameScore(restored), null);
  assert.equal(scoreTotalsAtPosition(restored), undefined);
  assert.equal(tracksScores(undo(restored)), false);
  assert.deepEqual(undo(restored).scoring, imported.scoring);
});

test("importing a layout with Clear board starts fresh tracking and keeps the rack", () => {
  const game = setScoreTracking(
    { ...crossedCat(), rack: "Q?", excludedRackSlots: [0] },
    false,
  );
  const premiums = [...game.template.premiums];
  premiums[game.template.start] = "TW";
  const imported = importBoard(game, game.board, premiums, true);

  assert.equal(tracksScores(imported), true);
  assert.deepEqual(gameScoreTotals(imported.scoring), { you: 0, opponent: 0 });
  assert.deepEqual(imported.board, emptyBoard(game.template.size));
  assert.deepEqual(imported.template.premiums, premiums);
  assert.equal(imported.rack, "Q?");
  assert.deepEqual(imported.excludedRackSlots, [0]);
  assert.deepEqual(trackedMoveHistory(imported), trackedMoveHistory(game));

  const saved = gameSchema.parse(JSON.parse(JSON.stringify(imported)));
  assert.equal(tracksScores(undo(saved)), false);
  assert.deepEqual(undo(saved).board, game.board);
  assert.deepEqual(undo(saved).template.premiums, game.template.premiums);
  assert.equal(tracksScores(redo(undo(saved))), true);
  assert.deepEqual(redo(undo(saved)).board, imported.board);

  const kept = importBoard(game, game.board, premiums, false);
  assert.equal(tracksScores(kept), false);
  assert.deepEqual(kept.board, game.board);
  assert.deepEqual(kept.template.premiums, premiums);

  const enabledAgain = setScoreTracking(
    setScoreTracking(imported, false),
    true,
  );
  assert.deepEqual(gameScoreTotals(enabledAgain.scoring), {
    you: 0,
    opponent: 0,
  });
});

test("a screenshot-only board starts with partial scores and no invented moves", () => {
  const game = fixture();
  const board = [...game.board];
  board.splice(game.template.start, 3, "C", "A", "T");
  const restored = setScoreTracking(importBoard(game, board), true);
  assert.equal(restored.scoring?.incomplete, true);
  assert.deepEqual(trackedMoveHistory(restored), []);
  assert.deepEqual(gameScoreTotals(restored.scoring), { you: 0, opponent: 0 });

  const replacement = [...game.board];
  replacement[game.template.start] = "S";
  const restarted = setScoreTracking(
    importBoard(crossedCat(), replacement),
    true,
  );
  assert.equal(restarted.scoring?.incomplete, true);
  assert.deepEqual(gameScoreTotals(restarted.scoring), { you: 0, opponent: 0 });
});

test("ambiguous edits are skipped and a manually added score takes precedence", () => {
  const game = { ...fixture(), trackScores: false };
  const edits = new BoardEditHistory();
  const opening = [...game.board];
  opening.splice(game.template.start, 3, "C", "A", "T");
  const entered = edits.apply(game, opening, "enter");
  const added = correctTrackedMove(
    entered,
    0,
    { player: "opponent", word: "CAT", score: 12 },
    true,
  );
  const restored = setScoreTracking(added, true);
  assert.equal(trackedMoveHistory(restored).length, 1);
  assert.equal(restored.scoring?.opponent.points, 12);
  assert.equal(trackedMoveHistory(restored)[0].review?.tiles.length, 3);

  const ambiguous = [...opening];
  ambiguous[0] = "Z";
  const partial = setScoreTracking(
    edits.apply(added, ambiguous, "enter"),
    true,
  );
  assert.deepEqual(trackedMoveHistory(partial), trackedMoveHistory(added));
  assert.equal(partial.scoring?.opponent.points, 12);
  assert.equal(partial.scoring?.incomplete, true);
});

test("tracked moves from legacy saves survive the undo limit and new moves follow undo and redo", () => {
  const game = fixture();
  game.rack = "CAT";
  const move = solve(
    new Lexicon(["CAT"]),
    game.board,
    game.rack,
    game.template,
  )[0];
  let edited = playTrackedMove(game, move);
  delete edited.trackedMoves; // Older saves recorded the player only in board history.
  const opening = trackedMoveHistory(edited);
  assert.equal(opening.length, 1);
  for (let i = 0; i < 100; i++)
    edited = { ...edited, ...remember(edited, "Board edit") };
  assert.equal(
    edited.past.some((entry) => entry.player),
    false,
  );
  assert.deepEqual(trackedMoveHistory(edited), opening);
  const reply = solve(
    new Lexicon(["CATS"]),
    edited.board,
    "S",
    edited.template,
  )[0];
  const played = playTrackedMove({ ...edited, rack: "S" }, reply);
  assert.deepEqual(
    trackedMoveHistory(played).map((entry) => entry.word),
    ["CAT", "CATS"],
  );
  assert.deepEqual(trackedMoveHistory(undo(played)), opening);
  assert.deepEqual(
    trackedMoveHistory(redo(undo(played))),
    trackedMoveHistory(played),
  );
});

test("bingo markers persist for both players and can be recovered from legacy scoring snapshots", () => {
  const game = { ...fixture(), rack: "ABCDEFG" };
  const lexicon = new Lexicon(["ABCDEFG"]);
  const move = solve(lexicon, game.board, game.rack, game.template)[0];
  const yours = playTrackedMove(game, move);
  const edited = new BoardEditHistory().apply(game, yours.board, "enter");
  const theirs = recordOpponentPlay(edited);
  for (const [position, player] of [
    [yours, "you"],
    [theirs, "opponent"],
  ] as const) {
    assert.equal(trackedMoveHistory(position).at(-1)?.player, player);
    assert.equal(trackedMoveHistory(position).at(-1)?.bingo, true);
    const old = JSON.parse(JSON.stringify(position)) as Game;
    for (const entry of [...old.past, ...(old.trackedMoves ?? [])])
      delete entry.bingo;
    assert.equal(trackedMoveHistory(old).at(-1)?.bingo, true);
    assert.equal(trackedMoveHistory(redo(undo(old))).at(-1)?.bingo, true);
    assert.equal(trackedMoveHistory(redo(undo(position))).at(-1)?.bingo, true);
  }
});

test("blank corrections after a bingo do not hide the next opponent move", () => {
  const game = fixture();
  game.board[9] = "S"; // J1 is already on the board.
  game.board[game.template.start] = "o";
  game.board[game.template.start + 1] = "O";
  game.rack = "TOXI";
  const history = new BoardEditHistory();
  const corrected = [...game.board];
  corrected[game.template.start] = "O";
  corrected[game.template.start + 1] = "o";
  const afterCorrection = history.apply(game, corrected, "blank");
  const afterSad = [...corrected];
  afterSad[24] = "A";
  afterSad[39] = "D";
  const entered = history.apply(afterCorrection, afterSad, "enter");
  assert.equal(pendingOpponentPlay(entered)?.word, "SAD");

  const next = solve(
    new Lexicon(["TOXIC", "TAXI", "OX", "TO"]),
    afterSad,
    game.rack,
    game.template,
  );
  const move = next.find((candidate) => candidate.word === "TO");
  assert.ok(move);
  const played = playTrackedMove(entered, move);
  assert.deepEqual(
    trackedMoveHistory(played).map(({ word, player }) => [word, player]),
    [
      ["SAD", "opponent"],
      ["TO", "you"],
    ],
  );
});

test("playing a suggestion requires resolving ambiguous new tiles but permits consecutive plays", () => {
  const game = fixture();
  game.rack = "CAT";
  const editedBoard = [...game.board];
  editedBoard[0] = "X"; // Disconnected and the opening square is empty.
  const edited = new BoardEditHistory().apply(game, editedBoard, "enter");
  const move = solve(
    new Lexicon(["CAT"]),
    game.board,
    game.rack,
    game.template,
  )[0];
  assert.throws(() => playTrackedMove(edited, move), /Keep as correction/);
  const played = playTrackedMove(treatBoardEditAsCorrection(edited), move);
  const extension = solve(
    new Lexicon(["CATS"]),
    played.board,
    "S",
    played.template,
  )[0];
  const next = playTrackedMove({ ...played, rack: "S" }, extension);
  assert.deepEqual(
    trackedMoveHistory(next).map(({ player }) => player),
    ["you", "you"],
  );
});

test("two typed opponent turns across an exchange are scored and undone individually", () => {
  const game = fixture();
  const { start, size } = game.template;
  const edits = new BoardEditHistory();
  const opening = [...game.board];
  opening.splice(start, 3, ..."CAT");
  const first = edits.apply(game, opening, "enter");
  edits.reset();
  const crossing = [...opening];
  crossing[start + size + 1] = "T";
  const second = edits.apply({ ...first, rack: "A" }, crossing, "enter");
  const pending = gameSchema.parse(
    JSON.parse(JSON.stringify({ ...second, rack: "S" })),
  );
  assert.deepEqual(scoreTotalsAtPosition(pending), { you: 0, opponent: 13 });
  assert.deepEqual(
    boardWordsAt(pending, start + 1).map(({ word, score }) => [word, score]),
    [
      ["CAT", 10],
      ["AT", 3],
    ],
  );

  const reply = solve(new Lexicon(["CATS"]), crossing, "S", game.template)[0];
  const played = playTrackedMove(pending, reply);
  assert.deepEqual(
    trackedMoveHistory(played).map(({ player, word, score }) => [
      player,
      word,
      score,
    ]),
    [
      ["opponent", "CAT", 10],
      ["opponent", "AT", 3],
      ["you", "CATS", 6],
    ],
  );
  const beforeReply = undo(played);
  assert.deepEqual(beforeReply.board, crossing);
  assert.equal(beforeReply.rack, "S");
  assert.equal(beforeReply.scoring?.pendingBase, undefined);
  const beforeSecond = undo(beforeReply);
  assert.deepEqual(beforeSecond.board, opening);
  assert.equal(beforeSecond.rack, "A");
  assert.deepEqual(gameScoreTotals(beforeSecond.scoring), {
    you: 0,
    opponent: 10,
  });
  const beforeFirst = undo(beforeSecond);
  assert.deepEqual(beforeFirst.board, game.board);
  assert.deepEqual(trackedMoveHistory(beforeFirst), []);
  const restored = redo(redo(redo(beforeFirst)));
  assert.deepEqual(restored.board, played.board);
  assert.deepEqual(restored.scoring, played.scoring);
  assert.deepEqual(trackedMoveHistory(restored), trackedMoveHistory(played));
});

test("multiple possible opponent turn boundaries leave the board edits unscored", () => {
  const game = fixture();
  const { start, size } = game.template;
  const edits = new BoardEditHistory();
  const board = [...game.board];
  board.splice(start, 2, ..."CA");
  const partial = edits.apply(game, [...board], "enter");
  edits.reset();
  board[start + 2] = "T";
  const opening = edits.apply(partial, [...board], "enter");
  edits.reset();
  board[start + 2 + size] = "O";
  const pending = edits.apply(opening, board, "enter");
  assert.deepEqual(pendingOpponentTurns(pending), []);
  assert.equal(recordOpponentPlay(pending), pending);
  assert.equal(scoreTotalsAtPosition(pending), undefined);
});

test("inserting and correcting tracked moves updates scores and can be undone independently", () => {
  const game = { ...fixture(), rack: "CAT" };
  const opening = solve(
    new Lexicon(["CAT"]),
    game.board,
    game.rack,
    game.template,
  )[0];
  const played = playTrackedMove(game, opening);
  const reply = solve(
    new Lexicon(["CATS"]),
    played.board,
    "S",
    played.template,
  )[0];
  const later = playTrackedMove({ ...played, rack: "S" }, reply);
  const inserted = correctTrackedMove(
    later,
    1,
    { word: "SAD", player: "opponent", score: 6, bingo: false },
    true,
  );
  const corrected = correctTrackedMove(
    inserted,
    0,
    { word: "CAT", player: "you", score: 8, bingo: false },
    false,
  );
  assert.deepEqual(
    trackedMoveHistory(corrected).map((move) => [move.word, move.score]),
    [
      ["CAT", 8],
      ["SAD", 6],
      ["CATS", reply.score],
    ],
  );
  assert.equal(corrected.board, later.board);
  assert.equal(corrected.rack, later.rack);
  assert.equal(corrected.scoring?.opponent.points, 6);
  assert.equal(corrected.scoring?.you.points, 8 + reply.score);
  assert.equal(corrected.scoring?.you.best, Math.max(8, reply.score));
  const saved = gameSchema.parse(JSON.parse(JSON.stringify(corrected)));
  const reverted = undo(saved);
  assert.deepEqual(reverted.trackedMoves, inserted.trackedMoves);
  assert.deepEqual(redo(reverted).trackedMoves, corrected.trackedMoves);
  assert.deepEqual(undo(undo(reverted)).trackedMoves, played.trackedMoves);
});

test("correcting a move from before a score reset keeps current totals and pending edits", () => {
  const game = { ...fixture(), rack: "CAT" };
  const opening = solve(
    new Lexicon(["CAT"]),
    game.board,
    game.rack,
    game.template,
  )[0];
  const imported = importBoard(playTrackedMove(game, opening), emptyBoard(15));
  const tracked = setScoreTracking(imported, true);
  const board = [...tracked.board];
  board[tracked.template.start] = "S";
  const pending = new BoardEditHistory().apply(tracked, board, "enter");
  const corrected = correctTrackedMove(
    pending,
    0,
    { word: "CAT", player: "you", score: 12 },
    false,
  );
  assert.deepEqual(corrected.scoring, pending.scoring);
  assert.equal(trackedMoveHistory(corrected)[0].score, 12);
});

test("opponent review saves a full observer rack from before entry, with older or changed racks left unknown", () => {
  const game = { ...fixture(), rack: "ZSEI?MR" };
  const board = [...game.board];
  board.splice(game.template.start, 3, "C", "A", "T");
  const entered = new BoardEditHistory().apply(game, board, "enter");
  const unchanged = recordOpponentPlay(entered);
  const saved = gameSchema.parse(JSON.parse(JSON.stringify(unchanged)));
  assert.equal(saved.trackedMoves?.[0].review?.observerRack, "?EIMRSZ");

  const changed = recordOpponentPlay({
    ...entered,
    ...remember(entered, "Entered rack letters"),
    rack: "ZSEILMR",
  });
  assert.equal(changed.trackedMoves?.[0].review?.observerRack, undefined);
  const older = JSON.parse(JSON.stringify(unchanged));
  delete older.trackedMoves[0].review.observerRack;
  assert.equal(
    gameSchema.parse(older).trackedMoves?.[0].review?.observerRack,
    undefined,
  );
});
