import { summarizeGame, type GameIndex } from "../shared/game-index";
import type { AppState, Game } from "../shared/model";

const indexKey = "tilewise:game-index";
const openGamePrefix = "tilewise:open-game:";
const recentKey = "tilewise:recent-games";
const legacyKey = "tilewise:cache";
export const RECENT_GAME_LIMIT = 4;

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function recentIds() {
  const ids = read<string[]>(recentKey);
  return Array.isArray(ids) ? ids : [];
}

export function loadGameCache() {
  const index = read<GameIndex>(indexKey);
  const recent = recentIds().flatMap((id) => {
    const game = read<Game>(openGamePrefix + id);
    return game ? [game] : [];
  });
  const legacy = read<AppState>(legacyKey);
  if (!legacy) return { index, games: recent };
  const games = new Map(legacy.games.map((game) => [game.id, game]));
  for (const game of recent) games.set(game.id, game);
  return {
    index: index ?? { ...legacy, games: legacy.games.map(summarizeGame) },
    games: [...games.values()],
  };
}

export function cacheGameIndex(serialized: string) {
  localStorage.setItem(indexKey, serialized);
}

export function cacheOpenGame(game: Game) {
  // Keep existing cached games if writing the new one exceeds browser storage.
  const key = openGamePrefix + game.id;
  const existing = read<Game>(key);
  if (!existing || game.revision > existing.revision)
    localStorage.setItem(key, JSON.stringify(game));
  const ids = [game.id, ...recentIds().filter((id) => id !== game.id)];
  localStorage.setItem(
    recentKey,
    JSON.stringify(ids.slice(0, RECENT_GAME_LIMIT)),
  );
  for (const id of ids.slice(RECENT_GAME_LIMIT))
    localStorage.removeItem(openGamePrefix + id);
  localStorage.removeItem(legacyKey);
}

export function dropCachedGame(id: string) {
  localStorage.removeItem(openGamePrefix + id);
  const ids = recentIds();
  if (ids.includes(id))
    localStorage.setItem(
      recentKey,
      JSON.stringify(ids.filter((item) => item !== id)),
    );
}
