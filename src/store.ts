import { useSyncExternalStore } from "react";
import type {
  AppState,
  Game,
  Profile,
  BoardTemplate,
  Dictionary,
} from "../shared/model";

export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.error || "Request failed."), {
      status: response.status,
      game: result.game,
    });
  return result;
}
const read = <T>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
};
interface Snapshot {
  data: AppState | null;
  online: boolean;
  error: string;
  pending: string[];
  conflicts: Record<string, Game>;
  storageError: boolean;
}
export class GameStore {
  snapshot: Snapshot = {
    data: read<AppState | null>("tilewise:cache", null),
    online: false,
    error: "",
    pending: [],
    conflicts: {},
    storageError: false,
  };
  drafts = new Map<string, Game>(
    Object.entries(read<Record<string, Game>>("tilewise:drafts", {})),
  );
  listeners = new Set<() => void>();
  busy = false;
  refreshing = false;
  timer: ReturnType<typeof setTimeout> | undefined;
  constructor() {
    if (this.snapshot.data)
      this.snapshot.data.games = this.snapshot.data.games.map(
        (g) => this.drafts.get(g.id) || g,
      );
    this.snapshot.pending = [...this.drafts.keys()];
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.snapshot;
  emit() {
    this.snapshot = { ...this.snapshot, pending: [...this.drafts.keys()] };
    for (const fn of this.listeners) fn();
  }
  persist() {
    try {
      localStorage.setItem(
        "tilewise:drafts",
        JSON.stringify(Object.fromEntries(this.drafts)),
      );
      if (this.snapshot.data)
        localStorage.setItem(
          "tilewise:cache",
          JSON.stringify(this.snapshot.data),
        );
      this.snapshot.storageError = false;
    } catch {
      this.snapshot.storageError = true;
    }
  }
  replace(game: Game) {
    if (!this.snapshot.data) return;
    this.snapshot.data = {
      ...this.snapshot.data,
      games: this.snapshot.data.games.map((g) => (g.id === game.id ? game : g)),
    };
  }
  update(game: Game) {
    this.replace(game);
    this.drafts.set(game.id, game);
    this.persist();
    this.emit();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 300);
  }
  async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    const before = this.snapshot.data;
    try {
      const remote = await api<AppState>("/state");
      remote.games = remote.games.map((game) => {
        const draft = this.drafts.get(game.id);
        if (draft) return draft;
        const local = this.snapshot.data?.games.find((g) => g.id === game.id);
        return local && local.revision > game.revision ? local : game;
      });
      // A list request can finish after a creation request. Keep items created
      // during that request so selecting a new game cannot jump back to an old one.
      for (const key of [
        "games",
        "profiles",
        "templates",
        "dictionaries",
      ] as const) {
        const originalIds = new Set(before?.[key].map((item) => item.id));
        const remoteIds = new Set(remote[key].map((item) => item.id));
        const created =
          this.snapshot.data?.[key].filter(
            (item) => !originalIds.has(item.id) && !remoteIds.has(item.id),
          ) || [];
        (remote[key] as { id: string }[]).push(...created);
      }
      this.snapshot = {
        ...this.snapshot,
        data: remote,
        online: true,
        error: "",
      };
      this.persist();
      this.emit();
      void this.flush();
    } catch (error) {
      this.snapshot = {
        ...this.snapshot,
        online: false,
        error:
          error instanceof Error ? error.message : "Cannot reach the server.",
      };
      this.emit();
    } finally {
      this.refreshing = false;
    }
  }
  async flush() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const [id] of this.drafts) {
        if (this.snapshot.conflicts[id]) continue;
        const draft = this.drafts.get(id)!;
        try {
          const saved = await api<Game>(`/games/${id}`, "PUT", draft);
          this.snapshot.online = true;
          if (this.drafts.get(id) === draft) {
            this.drafts.delete(id);
            this.replace(saved);
          } else {
            const newer = {
              ...this.drafts.get(id)!,
              revision: saved.revision,
              updatedAt: saved.updatedAt,
            };
            this.drafts.set(id, newer);
            this.replace(newer);
          }
        } catch (error) {
          const err = error as Error & { status?: number; game?: Game };
          if (err.status === 409 && err.game) {
            this.snapshot.conflicts = {
              ...this.snapshot.conflicts,
              [id]: err.game,
            };
          } else {
            this.snapshot.online = false;
            this.snapshot.error = err.message;
            break;
          }
        }
        this.persist();
        this.emit();
      }
    } finally {
      this.busy = false;
      this.persist();
      this.emit();
      if (
        this.snapshot.online &&
        [...this.drafts.keys()].some((id) => !this.snapshot.conflicts[id])
      )
        this.timer = setTimeout(() => void this.flush(), 300);
    }
  }
  async createGame(game: Omit<Game, "id" | "revision" | "updatedAt">) {
    const saved = await api<Game>("/games", "POST", game);
    this.snapshot.data = {
      ...this.snapshot.data!,
      games: [...this.snapshot.data!.games, saved],
    };
    this.persist();
    this.emit();
    return saved;
  }
  async createProfile(name: string) {
    const profile = await api<Profile>("/profiles", "POST", { name });
    this.snapshot.data = {
      ...this.snapshot.data!,
      profiles: [...this.snapshot.data!.profiles, profile],
    };
    this.persist();
    this.emit();
    return profile;
  }
  async saveTemplate(template: BoardTemplate) {
    const saved = await api<BoardTemplate>("/templates", "POST", template);
    this.snapshot.data = {
      ...this.snapshot.data!,
      templates: [...this.snapshot.data!.templates, saved],
    };
    this.persist();
    this.emit();
    return saved;
  }
  async importDictionary(name: string, text: string) {
    const dictionary = await api<Dictionary>("/dictionaries", "POST", {
      name,
      text,
    });
    this.snapshot.data = {
      ...this.snapshot.data!,
      dictionaries: [...this.snapshot.data!.dictionaries, dictionary],
    };
    this.persist();
    this.emit();
    return dictionary;
  }
  acceptRemote(id: string) {
    const remote = this.snapshot.conflicts[id];
    if (!remote) return;
    this.drafts.delete(id);
    this.replace(remote);
    const conflicts = { ...this.snapshot.conflicts };
    delete conflicts[id];
    this.snapshot.conflicts = conflicts;
    this.persist();
    this.emit();
  }
  async preserveCopy(id: string) {
    const local = this.drafts.get(id);
    if (!local) return;
    const copy = await this.createGame({
      ...local,
      name: `${local.name.slice(0, 65)} (local copy)`,
    });
    this.acceptRemote(id);
    return copy;
  }
}
export const store = new GameStore();
export function useStore() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
