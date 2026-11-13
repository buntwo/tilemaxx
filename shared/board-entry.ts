import { remember, type Board, type Game } from "./model";
import { trackBoardEdit } from "./game-scoring";

type EditKind = "enter" | "erase" | "blank";
// Server acknowledgments change revision/updatedAt but must not split typing.
const positionKey = (game: Game) =>
  JSON.stringify([
    game.id,
    game.board,
    game.rack,
    game.past,
    game.future,
    game.scoring,
    game.trackScores,
    game.trackedMoves,
  ]);

export class BoardEditHistory {
  private group: { kind: EditKind; position: string } | null = null;

  reset() {
    this.group = null;
  }

  apply(game: Game, board: Board, kind: EditKind): Game {
    if (board.every((letter, i) => letter === game.board[i])) return game;
    const continuing =
      this.group?.kind === kind && this.group.position === positionKey(game);
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
    this.group = { kind, position: positionKey(next) };
    return next;
  }
}
