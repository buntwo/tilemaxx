import {
  BOARD_EDIT_LABELS,
  remember,
  trackedMoveHistory,
  type Board,
  type BoardTemplate,
  type Game,
} from "./model";
import {
  recordOpponentRackOut,
  reopenSearchRecordedOpponentPlay,
  trackBoardEdit,
  trackReenteredTiles,
} from "./game-scoring";

type EditKind = keyof typeof BOARD_EDIT_LABELS;

export function inferBoardEntryDirection(
  board: readonly string[],
  index: number,
  { size, start }: Pick<BoardTemplate, "size" | "start">,
  rackTiles: number,
): "across" | "down" {
  if (rackTiles === 0) return "across";
  const row = Math.floor(index / size);
  const column = index % size;
  const opening = !board.some(Boolean);

  function canPlay(across: boolean) {
    const coordinate = across ? column : row;
    const stride = across ? 1 : size;
    const crossStride = across ? size : 1;
    const crossCoordinate = across ? row : column;
    let length = 0;
    let remaining = rackTiles;
    let connected = false;

    // A contiguous played prefix is part of the word. New tiles can only
    // be entered from the selected square onward.
    while (length < coordinate && board[index - (length + 1) * stride]) {
      length++;
      connected = true;
    }

    for (let offset = 0; offset < size - coordinate; offset++) {
      const square = index + offset * stride;
      if (board[square]) {
        connected = true;
      } else {
        if (remaining === 0) break;
        remaining--;
        connected ||= opening
          ? square === start
          : !!(
              (crossCoordinate > 0 && board[square - crossStride]) ||
              (crossCoordinate + 1 < size && board[square + crossStride])
            );
      }
      length++;
      if (length >= 2 && remaining < rackTiles && connected) return true;
    }
    return false;
  }

  return !canPlay(true) && canPlay(false) ? "down" : "across";
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
  private group: { kind: EditKind; game: Game } | null = null;

  reset() {
    this.group = null;
  }

  apply(game: Game, board: Board, kind: EditKind): Game {
    if (board.every((letter, i) => letter === game.board[i])) return game;
    const editable =
      kind === "erase" ? reopenSearchRecordedOpponentPlay(game, board) : game;
    const continuing =
      this.group?.kind === kind && sameEditPosition(this.group.game, editable);
    const restored = kind === "enter" ? trackReenteredTiles(game, board) : undefined;
    const { scoring, trackedMoves } = restored ?? trackBoardEdit(editable, board);
    const next = {
      ...editable,
      ...(continuing || editable !== game
        ? {}
        : remember(editable, BOARD_EDIT_LABELS[kind])),
      board,
      scoring,
    };
    if (trackedMoves) {
      next.trackedMoves = trackedMoves;
      const last = next.past.at(-1)!;
      if (!last.trackedMoves) {
        next.past = [
          ...next.past.slice(0, -1),
          { ...last, trackedMoves: trackedMoveHistory(editable) },
        ];
      }
    }
    const recorded = recordOpponentRackOut(next);
    this.group = recorded === next ? { kind, game: next } : null;
    return recorded;
  }
}
