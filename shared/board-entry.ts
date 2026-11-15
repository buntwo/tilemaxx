import {
  BOARD_EDIT_LABELS,
  remember,
  trackedMoveHistory,
  type Board,
  type Game,
} from "./model";
import { recordOpponentRackOut, trackBoardEdit } from "./game-scoring";

type EditKind = keyof typeof BOARD_EDIT_LABELS;

// Local save acknowledgments retain the position and history references.
function sameEditPosition(a: Game, b: Game) {
  return (
    a.id === b.id &&
    a.board === b.board &&
    a.rack === b.rack &&
    a.excludedRackSlots === b.excludedRackSlots &&
    a.past === b.past &&
    a.future === b.future &&
    a.scoring === b.scoring &&
    a.trackScores === b.trackScores &&
    a.trackedMoves === b.trackedMoves
  );
}

export class BoardEditHistory {
  private group: { kind: EditKind; game: Game } | null = null;

  reset() {
    this.group = null;
  }

  apply(game: Game, board: Board, kind: EditKind): Game {
    if (board.every((letter, i) => letter === game.board[i])) return game;
    const continuing =
      this.group?.kind === kind && sameEditPosition(this.group.game, game);
    const { scoring, trackedMoves } = trackBoardEdit(game, board);
    const next = {
      ...game,
      ...(continuing ? {} : remember(game, BOARD_EDIT_LABELS[kind])),
      board,
      scoring,
    };
    if (trackedMoves) {
      next.trackedMoves = trackedMoves;
      const last = next.past.at(-1)!;
      if (!last.trackedMoves) {
        next.past = [
          ...next.past.slice(0, -1),
          {
            ...last,
            trackedMoves: trackedMoveHistory(game),
          },
        ];
      }
    }
    const recorded = recordOpponentRackOut(next);
    this.group = recorded === next ? { kind, game: next } : null;
    return recorded;
  }
}
