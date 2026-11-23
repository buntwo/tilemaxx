import {
  gameWordLanguage,
  localDate,
  restoreArchivedGame,
  trackedMoveHistory,
  type AppState,
  type Game,
  type GameOutcome,
  type PlayerScore,
} from "./model";
import {
  displayedGameScoring,
  summarizeGameScore,
  tracksScores,
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

export type ArchivedGameStats = {
  outcome?: GameOutcome;
  finalScore?: number;
  margin?: number;
  plays?: PlayerScore;
};

export type GameSummary = Pick<
  Game,
  | "id"
  | "profileId"
  | "name"
  | "solo"
  | "platform"
  | "startedOn"
  | "archived"
  | "revision"
> & {
  dictionaryId?: Game["dictionaryId"];
  endedOn?: string;
  language?: ReturnType<typeof gameWordLanguage>;
  archiveStats?: ArchivedGameStats | null;
  thumbnail: GameThumbnail;
  fullMoveHistory: boolean;
  score: GameScoreSummary | null;
};

export type GameIndex = Omit<AppState, "games"> & { games: GameSummary[] };

export function opponentNameMatches(name: string, query: string): boolean {
  return name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

export function recentOpponentNames(
  games: readonly GameSummary[],
  profileId: string,
): string[] {
  const now = new Date();
  const today = localDate(now);
  now.setDate(now.getDate() - 14);
  const cutoff = localDate(now);
  const opponents = new Map<string, { name: string; date: string }>();
  for (const game of games) {
    if (game.profileId !== profileId || game.solo) continue;
    const date = game.endedOn ?? game.startedOn;
    if (!date || date < cutoff || date > today) continue;
    const name = game.name.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    const previous = opponents.get(key);
    if (!previous || date > previous.date) opponents.set(key, { name, date });
  }
  return [...opponents.values()]
    .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name))
    .map(({ name }) => name);
}

function hasFullMoveHistory(position: Game): boolean {
  const { board, scoring } = position;
  if (scoring?.imported) return false;
  const history = trackedMoveHistory(position);
  const count = scoring
    ? scoring.you.moves + scoring.opponent.moves
    : history.length;
  if (!count)
    return (
      !history.length &&
      !scoring?.incomplete &&
      tracksScores(position) &&
      !board.some(Boolean)
    );
  if (count > history.length) return false;
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

function summarizeArchivedStats(
  position: Game,
  fullMoveHistory: boolean,
): ArchivedGameStats | null {
  const { scoring } = position;
  if (!scoring?.end) return null;
  const { end } = scoring;
  const score = summarizeGameScore(position, scoring);
  const result = score?.outcome ?? ("manual" in end ? end.outcome : undefined);
  const outcome = result === "win" || result === "loss" || result === "tie"
    ? result
    : undefined;
  const plays = fullMoveHistory && tracksScores(position) && !scoring.incomplete &&
    scoring.you.moves ? scoring.you : undefined;
  return {
    outcome: position.solo ? undefined : outcome,
    finalScore: score?.you,
    margin: score && !position.solo ? score.you - score.opponent : undefined,
    plays,
  };
}

export function summarizeGame(game: Game): GameSummary {
  const {
    id,
    profileId,
    name,
    dictionaryId,
    platform,
    startedOn,
    archived,
    revision,
    template,
    board,
  } = game;
  const scoring = displayedGameScoring(game);
  const endedOn = scoring?.end?.endedOn;
  const archivePosition = archived ? restoreArchivedGame(game) : game;
  const fullMoveHistory = hasFullMoveHistory(archivePosition);
  return {
    id,
    profileId,
    name,
    dictionaryId,
    ...(game.solo && { solo: game.solo }),
    ...(platform !== undefined && { platform }),
    ...(startedOn !== undefined && { startedOn }),
    ...(endedOn !== undefined && { endedOn }),
    archived,
    revision,
    language: gameWordLanguage(template.rules),
    ...(archived && { archiveStats: summarizeArchivedStats(archivePosition, fullMoveHistory) }),
    fullMoveHistory,
    score: !archived || scoring ? summarizeGameScore(game, scoring) : null,
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
