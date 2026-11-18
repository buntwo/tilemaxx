import {
  BOARD_EDIT_LABELS,
  remember,
  trackedMoveHistory,
  type Board,
  type Game,
} from "./model";
import {
  recordOpponentRackOut,
  reopenSearchRecordedOpponentPlay,
  trackBoardEdit,
} from "./game-scoring";

type EditKind = keyof typeof BOARD_EDIT_LABELS;

export function inferBoardEntryDirection(
  board: readonly string[],
  index: number,
  size: number,
  rackTiles: number,
): "across" | "down" {
  if (rackTiles === 0) return "across";
  const row = Math.floor(index / size);
  const column = index % size;

  function connects(across: boolean) {
    const length = size - (across ? column : row);
    const stride = across ? 1 : size;
    const crossStride = across ? size : 1;
    const crossCoordinate = across ? row : column;
    let remaining = rackTiles;

    for (let offset = 0; offset < length; offset++) {
      const square = index + offset * stride;
      if (board[square]) {
        if (offset > 0) return true;
        continue;
      }

      if (remaining === 0) return false;
      remaining--;
      // An empty square we can fill also connects via a perpendicular hook.
      if (
        (crossCoordinate > 0 && board[square - crossStride]) ||
        (crossCoordinate + 1 < size && board[square + crossStride])
      )
        return true;
    }
    return false;
  }

  return !connects(true) && connects(false) ? "down" : "across";
}

// Local save acknowledgments retain the position and history references.
function sameEditPosition(a: Game, b: Game) {
  return (
    a.id === b.id &&
    a.board === b.board &&
    a.rack === b.rack &&
    a.excludedRackSlots === b.excludedRackSlots &&
    a.requiredRackSlots === b.requiredRackSlots &&
    a.past === b.past &&
    a.future === b.future &&
    a.scoring === b.scoring &&
    a.trackScores === b.trackScores &&
    a.trackedMoves === b.trackedMoves
  );
}

export class BoardEditHistory {
  private group: { kind: EditKind; game: Game; reopenedFrom?: Game } | null = null;

  reset() {
    this.group = null;
  }

  apply(game: Game, board: Board, kind: EditKind): Game {
    if (board.every((letter, i) => letter === game.board[i])) return game;
    const editable = reopenSearchRecordedOpponentPlay(game, board);
    const continuing =
      (this.group?.kind === kind && sameEditPosition(this.group.game, editable));
    const reopened = editable !== game;
    const reopenedFrom = reopened ? game : continuing ? this.group?.reopenedFrom : undefined;
    const { scoring, trackedMoves } = trackBoardEdit(editable, board);
    // A complete deletion is an edit of the recorded turn, even though there
    // is nothing left to rescore on the next search. Undo should restore it.
    const removed = reopenedFrom && !scoring?.pendingBase;
    const reuseBoundary =
      continuing || (reopened && editable.past.length === game.past.length);
    const snapshot = removed ? reopenedFrom : editable;
    const next = {
      ...editable,
      ...(reuseBoundary && !removed ? {} : remember(snapshot, BOARD_EDIT_LABELS[kind])),
      board,
      scoring,
    };
    if (trackedMoves || removed) {
      next.trackedMoves = trackedMoves ?? trackedMoveHistory(editable);
      const last = next.past.at(-1)!;
      if (!last.trackedMoves) {
        next.past = [
          ...next.past.slice(0, -1),
          {
            ...last,
            trackedMoves: trackedMoveHistory(snapshot),
          },
        ];
      }
    }
    const recorded = recordOpponentRackOut(next);
    this.group =
      recorded === next
        ? { kind, game: next, reopenedFrom: removed ? undefined : reopenedFrom }
        : null;
    return recorded;
  }
}
