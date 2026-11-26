import {
  boardWordsAt,
  boardWordScoreSignature,
  emptyScoring,
  isImportedPosition,
  reviewTurns,
} from "./game-scoring";
import { captureArchiveReplay } from "./game-replay";
import {
  archiveGame,
  remember,
  restoreArchivedGame,
  type Game,
  type SavedBoardWordScores,
} from "./model";

function removeUndoHistory(game: Game): Game {
  if (!game.past.length && !game.future.length) return game;

  // Older saves can reconstruct moves, rack marks, or bingo flags from Undo.
  // Make these independent of Undo before removing the editing steps.
  let trackedMoves = game.trackedMoves;
  let scoring = game.scoring;
  if (game.past.length) {
    const turns = reviewTurns(game);
    if (turns.length) {
      trackedMoves = turns.map(({ move, position }) =>
        position &&
        (!move.review ||
          position.excludedRackSlots !== move.review.excludedRackSlots)
          ? {
              ...move,
              review: {
                ...position,
                dictionaryId:
                  move.review?.dictionaryId ?? position.dictionaryId,
              },
            }
          : move,
      );
    }
    if (scoring?.imported === undefined && isImportedPosition(game)) {
      scoring = { ...(scoring ?? emptyScoring()), imported: true };
    }
  }
  const compacted = { ...game, scoring, trackedMoves, past: [], future: [] };
  if (!game.past.length) return compacted;

  // Some early games recorded hover scores only in Undo. Preserve differences
  // on this exact board, including where edits had broken a score's attribution.
  const baseline = { ...compacted, savedBoardWordScores: undefined };
  const words: SavedBoardWordScores["words"] = [];
  for (const [index, tile] of game.board.entries()) {
    if (!tile) continue;
    const after = boardWordsAt(baseline, index);
    for (const before of boardWordsAt(game, index)) {
      if (before.cells[0] !== index) continue;
      const next = after.find(
        ({ direction }) => direction === before.direction,
      );
      const { direction, score, fromPlay, player, bingo } = before;
      if (
        score !== next?.score ||
        fromPlay !== next.fromPlay ||
        player !== next.player ||
        bingo !== next.bingo
      )
        words.push({ start: index, direction, score, fromPlay, player, bingo });
    }
  }
  return words.length
    ? {
        ...compacted,
        savedBoardWordScores: {
          board: boardWordScoreSignature(game.board),
          words,
        },
      }
    : compacted;
}

export function compactArchivedHistory(game: Game): Game {
  if (!game.archived) return game;
  const current = removeUndoHistory(game);
  const snapshot = game.archivedState;
  if (!snapshot || !game.archivedBoard || (!snapshot.past.length && !snapshot.future.length))
    return current;

  // An edited archive and its original finish can have different move logs.
  const { scoring, trackedMoves, savedBoardWordScores } = removeUndoHistory(
    restoreArchivedGame(game),
  );
  return {
    ...current,
    archivedState: {
      ...snapshot,
      scoring,
      trackedMoves,
      savedBoardWordScores,
      past: [],
      future: [],
    },
  };
}

export function archiveForReview(game: Game): Game {
  return compactArchivedHistory(saveArchiveReplay(archiveGame(game)));
}

export function resumeFinishedGame(game: Game): Game {
  const saved = restoreArchivedGame(game);
  if (!saved.scoring?.end) return game;
  const position = game.archived ? removeUndoHistory(saved) : saved;
  return {
    ...position,
    ...(!game.archived && remember(position, "Resumed game")),
    scoring: { ...(position.scoring ?? saved.scoring), end: undefined },
    archived: false,
    archivedBoard: undefined,
    archivedState: undefined,
    replayRecovery: game.archivedState?.replayRecovery ?? game.replayRecovery,
  };
}

export function saveArchiveReplay(game: Game): Game {
  const snapshot = game.archivedState;
  if (!game.archived || !game.archivedBoard || !snapshot || snapshot.replayRecovery) return game;
  const replayRecovery = captureArchiveReplay(restoreArchivedGame(game));
  return replayRecovery || game.replayRecovery
    ? { ...game, replayRecovery: undefined, archivedState: { ...snapshot, replayRecovery } }
    : game;
}
