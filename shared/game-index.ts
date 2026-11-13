import type { AppState, Game } from "./model";

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
> & { thumbnail: GameThumbnail };

export type GameIndex = Omit<AppState, "games"> & { games: GameSummary[] };

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
