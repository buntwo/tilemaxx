import type { Game } from "../shared/model";

const legacyKey = "tilewise:drafts";
const prefix = "tilewise:draft:";

// getRandomValues is available on HTTP when Tilemaxx runs on a home network.
export function draftToken() {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) =>
    part.toString(16).padStart(8, "0"),
  ).join("");
}

export type StoredDraft = {
  key: string;
  raw: string;
  game: Game;
  writtenAt: number;
};

export function loadDrafts(): StoredDraft[] {
  const drafts: StoredDraft[] = [];
  try {
    const legacy = localStorage.getItem(legacyKey);
    if (legacy) {
      let migrated = true;
      for (const game of Object.values<Game>(JSON.parse(legacy) ?? {})) {
        const key = `${prefix}${game.id}:legacy`;
        const raw = JSON.stringify({ game, writtenAt: 0 });
        try {
          localStorage.setItem(key, raw);
        } catch {
          migrated = false;
          drafts.push({ key: legacyKey, raw: legacy, game, writtenAt: 0 });
        }
      }
      if (migrated) localStorage.removeItem(legacyKey);
    }
  } catch {
    // Malformed legacy data must not prevent recovery of newer drafts.
  }
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const { game, writtenAt } = JSON.parse(raw);
        if (game?.id && Number.isFinite(writtenAt))
          drafts.push({ key, raw, game, writtenAt });
      } catch {
        // A damaged draft must not hide the remaining entries.
      }
    }
  } catch {
    // Browser storage may be unavailable.
  }
  return drafts.sort((a, b) => b.writtenAt - a.writtenAt);
}

export function writeDraft(owner: string, game: Game): StoredDraft {
  const key = `${prefix}${game.id}:${owner}`;
  const writtenAt = Date.now();
  const raw = JSON.stringify({ game, writtenAt, version: draftToken() });
  localStorage.setItem(key, raw);
  return { key, raw, game, writtenAt };
}

export function clearDraft({ key, raw, game }: StoredDraft) {
  if (localStorage.getItem(key) !== raw) return;
  if (key === legacyKey) {
    const games: Record<string, Game> = JSON.parse(raw);
    delete games[game.id];
    if (Object.keys(games).length) {
      localStorage.setItem(key, JSON.stringify(games));
      return;
    }
  }
  localStorage.removeItem(key);
}
