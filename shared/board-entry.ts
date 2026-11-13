import { remember, type Board, type Game } from "./model";
import { trackBoardEdit } from "./game-scoring";

type EditKind = "enter" | "erase" | "blank";

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
    const next = {
      ...game,
      ...(continuing
        ? {}
        : remember(
            game,
            kind === "erase"
              ? "Erased board letters"
              : kind === "blank"
                ? "Changed blank tile"
                : "Entered board letters",
          )),
      board,
      scoring: trackBoardEdit(game, board),
    };
    this.group = { kind, game: next };
    return next;
  }
}
