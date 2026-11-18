import type { GameSummary } from "../shared/game-index";
import type { Game } from "../shared/model";
import { dictionaryUrl, loadWordList } from "./word-list-cache";

export const OFFLINE_GAME_BUDGET = 25 * 1024 * 1024;

type Candidate = Pick<GameSummary, "id" | "revision">;
type Entry = Candidate & { bytes: number };
type LibraryStatus = { ready: number; total: number; message: string };

const storeName = "library";
const manifestKey = "manifest";
const gameKey = (id: string) => `game:${id}`;

export function offlineGamePlan(
  games: readonly GameSummary[],
  openId?: string,
) {
  return games
    .filter(({ archived, revision }) => !archived && revision >= 0)
    .sort((a, b) => {
      if (a.id === openId) return -1;
      if (b.id === openId) return 1;
      return (b.startedOn ?? "").localeCompare(a.startedOn ?? "", "en");
    })
    .map(({ id, revision }) => ({ id, revision }));
}

function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("tilemaxx-offline-games", 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Offline game storage is busy."));
    request.onsuccess = () => resolve(request.result);
  });
}

function read<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Update the byte count and the snapshots in the same transaction, including
// across tabs. The manifest contains no game histories.
function change(
  db: IDBDatabase,
  update: (store: IDBObjectStore, entries: Entry[]) => Entry[],
): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.get(manifestKey);
    let entries: Entry[];
    request.onsuccess = () => {
      const previous: Entry[] = request.result ?? [];
      entries = update(store, previous);
      if (entries !== previous) store.put(entries, manifestKey);
    };
    tx.oncomplete = () => resolve(entries);
    tx.onabort = () =>
      reject(tx.error ?? new Error("Offline game storage failed."));
  });
}

export async function readOfflineGame(id: string): Promise<Game | undefined> {
  const db = await openLibrary();
  try {
    const json = await read<string>(db, gameKey(id));
    return json === undefined ? undefined : JSON.parse(json);
  } finally {
    db.close();
  }
}

export async function removeOfflineGame(id: string) {
  const db = await openLibrary();
  try {
    await change(db, (store, entries) => {
      if (!entries.some((entry) => entry.id === id)) return entries;
      store.delete(gameKey(id));
      return entries.filter((entry) => entry.id !== id);
    });
  } finally {
    db.close();
  }
}

function cacheGame(
  db: IDBDatabase,
  game: Entry,
  json: string,
  priority: Map<string, number>,
  signal: AbortSignal,
) {
  return change(db, (store, entries) => {
    if (signal.aborted) return entries;
    const existing = entries.find(({ id }) => id === game.id);
    if (existing && existing.revision >= game.revision) return entries;
    const rest = entries.filter(({ id }) => id !== game.id);
    let used = rest.reduce((total, entry) => total + entry.bytes, game.bytes);
    const evicted = new Set<string>();
    if (used > OFFLINE_GAME_BUDGET) {
      const rank = (id: string) => priority.get(id) ?? Infinity;
      const evictable = rest
        .filter(({ id }) => rank(id) > rank(game.id))
        .sort((a, b) => rank(b.id) - rank(a.id));
      for (const entry of evictable) {
        used -= entry.bytes;
        evicted.add(entry.id);
        if (used <= OFFLINE_GAME_BUDGET) break;
      }
      if (used > OFFLINE_GAME_BUDGET) return entries;
    }
    for (const id of evicted) store.delete(gameKey(id));
    store.put(json, gameKey(game.id));
    return [...rest.filter(({ id }) => !evicted.has(id)), game];
  });
}

export async function prepareOfflineGames(
  candidates: readonly Candidate[],
  getGame: ((id: string, signal: AbortSignal) => Promise<Game>) | undefined,
  signal: AbortSignal,
): Promise<LibraryStatus> {
  const db = await openLibrary();
  const priority = new Map(candidates.map(({ id }, index) => [id, index]));
  let entries: Entry[] = [];
  let message = "";
  try {
    entries = (await read<Entry[]>(db, manifestKey)) ?? [];
    if (getGame) {
      signal.throwIfAborted();
      entries = await change(db, (store, previous) => {
        if (signal.aborted) return previous;
        const keep = previous.filter(({ id }) => priority.has(id));
        if (keep.length === previous.length) return previous;
        for (const { id } of previous)
          if (!priority.has(id)) store.delete(gameKey(id));
        return keep;
      });
      const wordLists = new Map<string, boolean>();
      let remaining = OFFLINE_GAME_BUDGET;
      for (const { id, revision } of candidates) {
        signal.throwIfAborted();
        const existing = entries.find((entry) => entry.id === id);
        if (existing && existing.revision >= revision) {
          remaining -= existing.bytes;
          continue;
        }
        if (remaining <= 0) break;
        let game: Game;
        try {
          game = await getGame(id, signal);
        } catch (error) {
          signal.throwIfAborted();
          if ((error as { status?: number }).status === 404) continue;
          message = "Some games could not be downloaded. Reconnect and retry.";
          break;
        }
        if (game.archived || game.revision < revision) continue;
        const json = JSON.stringify(game);
        const bytes = new TextEncoder().encode(json).byteLength;
        if (bytes > OFFLINE_GAME_BUDGET) continue;
        if (bytes > remaining) break;
        if (!wordLists.has(game.dictionaryId)) {
          const words = await loadWordList(
            dictionaryUrl(game.dictionaryId),
          ).catch(() => undefined);
          wordLists.set(game.dictionaryId, !!words?.persisted);
        }
        signal.throwIfAborted();
        if (!wordLists.get(game.dictionaryId)) {
          message = "Some games need a word list that could not be downloaded.";
          continue;
        }
        entries = await cacheGame(
          db,
          { id, revision: game.revision, bytes },
          json,
          priority,
          signal,
        );
        const saved = entries.find((entry) => entry.id === id);
        if (saved) remaining -= saved.bytes;
      }
    }
  } catch (error) {
    signal.throwIfAborted();
    message =
      error instanceof DOMException && error.name === "QuotaExceededError"
        ? "Browser storage is full. Free some space and retry."
        : "Offline game storage is unavailable. Retry offline setup.";
  } finally {
    db.close();
  }
  return {
    ready: entries.filter(({ id }) => priority.has(id)).length,
    total: candidates.length,
    message,
  };
}
