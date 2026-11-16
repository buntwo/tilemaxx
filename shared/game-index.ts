import { trackedMoveHistory, type AppState, type Game } from "./model";
import {
  displayedGameScoring,
  summarizeGameScore,
  type GameScoreSummary,
} from "./game-scoring";
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
> & {
  endedOn?: string;
  thumbnail: GameThumbnail;
  fullMoveHistory: boolean;
  score: GameScoreSummary | null;
};

export type GameIndex = Omit<AppState, "games"> & { games: GameSummary[] };

export function opponentNameMatches(name: string, query: string): boolean {
  return name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

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
  const scoring = displayedGameScoring(game);
  const endedOn = scoring?.end?.endedOn;
  return {
    id,
    profileId,
    name,
    ...(platform !== undefined && { platform }),
    ...(startedOn !== undefined && { startedOn }),
    ...(endedOn !== undefined && { endedOn }),
    archived,
    revision,
    fullMoveHistory: hasFullMoveHistory(game),
    score: archived && scoring ? summarizeGameScore(game, scoring) : null,
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
