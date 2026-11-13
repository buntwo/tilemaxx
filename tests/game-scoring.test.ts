import assert from "node:assert/strict";
import { test } from "node:test";
import { gameSchema } from "../server/validation";
import { BoardEditHistory } from "../shared/board-entry";
import {
  correctTrackedMove,
  pendingOpponentPlay,
  playTrackedMove,
  recordOpponentPlay,
  setScoreTracking,
  tracksScores,
  treatBoardEditAsCorrection,
} from "../shared/game-scoring";
import { Lexicon } from "../shared/lexicon";
import {
  archiveGame,
  emptyBoard,
  redo,
  remember,
  restoreArchivedGame,
  trackedMoveHistory,
  undo,
  type Game,
} from "../shared/model";
import { PRESETS } from "../shared/presets";
import { importBoard } from "../shared/screenshot";
import { solve } from "../shared/solver";

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
