import { trackedMoveHistory, type AppState, type Game } from "./model";
import { reviewTurns } from "./turn-review";

export const thumbnailKinds = [
  "",
  "DL",
  "TL",
  "QL",
  "DW",
  "TW",
  "QW",
  "played",
] as const;

export type GameThumbnail = { size: number; squares: string };

export type GameSummary = Pick<
  Game,
  | "id"
  | "profileId"
  | "name"
  | "platform"
  | "startedOn"
  | "archived"
  | "revision"
> & { thumbnail: GameThumbnail; fullMoveHistory: boolean };

export type GameIndex = Omit<AppState, "games"> & { games: GameSummary[] };

function hasFullMoveHistory(game: Game): boolean {
  const position =
    game.archived && game.archivedBoard
      ? { ...game, ...game.archivedState, board: game.archivedBoard }
      : game;
  const { board, scoring } = position;
  if (scoring?.imported) return false;
  const history = trackedMoveHistory(position);
  const count = scoring
    ? scoring.you.moves + scoring.opponent.moves
    : history.length;
  if (!count || count > history.length) return false;
  const played = Array<string>(board.length).fill("");
  let legacyTurns: ReturnType<typeof reviewTurns> | undefined;
  for (let i = history.length - count; i < history.length; i++) {
    const review =
      history[i].review ?? (legacyTurns ??= reviewTurns(position))[i].position;
    if (
      !review?.tiles.length ||
      !review.board.every((tile, index) => tile.toUpperCase() === played[index])
    )
      return false;
    for (const { index, letter } of review.tiles)
      played[index] = letter.toUpperCase();
  }
  return board.every((tile, index) => tile.toUpperCase() === played[index]);
}

export function summarizeGame(game: Game): GameSummary {
  const {
    id,
    profileId,
    name,
    platform,
    startedOn,
    archived,
    revision,
    template,
    board,
  } = game;
  return {
    id,
    profileId,
    name,
    ...(platform !== undefined && { platform }),
    ...(startedOn !== undefined && { startedOn }),
    archived,
    revision,
    fullMoveHistory: hasFullMoveHistory(game),
    thumbnail: {
      size: template.size,
      squares: template.premiums
        .map((premium, index) =>
          board[index] ? 7 : thumbnailKinds.indexOf(premium),
        )
        .join(""),
    },
  };
}
