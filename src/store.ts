import { useSyncExternalStore } from "react";
import {
  clearDraft,
  draftToken,
  loadDrafts,
  writeDraft,
  type StoredDraft,
} from "./draft-storage";
import {
  cacheGameIndex,
  cacheOpenGame,
  dropCachedGame,
  loadGameCache,
  RECENT_GAME_LIMIT,
} from "./game-cache";
import {
  summarizeGame,
  type GameIndex,
  type GameSummary,
} from "../shared/game-index";
import type { Game, Profile, BoardTemplate, Dictionary } from "../shared/model";

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
  const result = await response.json().catch((error) => {
    if (response.ok) throw error;
    return {};
  });
  if (!response.ok)
    throw Object.assign(new Error(result.error || "Request failed."), {
      status: response.status,
      game: result.game,
    });
  return result;
}
interface Snapshot {
  data: GameIndex | null;
  games: Record<string, Game>;
  loadErrors: Record<string, string>;
  online: boolean;
  error: string;
  pending: string[];
  conflicts: Record<string, Game>;
  saveErrors: Record<string, string>;
  storageError: boolean;
}
export class GameStore {
  snapshot: Snapshot = {
    data: null,
    games: {},
    loadErrors: {},
    online: false,
    error: "",
    pending: [],
    conflicts: {},
    saveErrors: {},
    storageError: false,
  };
  drafts = new Map<string, Game>();
  private draftOwner = draftToken();
  private storedDrafts = new Map<string, StoredDraft>();
  private recoveredDrafts = new Map<string, StoredDraft[]>();
  private undurableDrafts = new Set<string>();
  private confirmedGames = new Map<string, Game>();
  private confirmedSummaries = new Map<string, GameSummary>();
  private gameRequests = new Set<string>();
  private openGameId?: string;
  private editGameId?: string;
  private lastCachedGame?: Game;
  private recentGames = new Set<string>();
  private lastCachedIndex?: string;
  private cacheError = false;
  listeners = new Set<() => void>();
  deletedGames = new Set<string>();
  deletedProfiles = new Set<string>();
  deletedTemplates = new Set<string>();
  busy = false;
  refreshing = false;
  timer: ReturnType<typeof setTimeout> | undefined;
  constructor() {
    const { index, games } = loadGameCache();
    this.snapshot.data = index;
    for (const summary of index?.games ?? [])
      this.confirmedSummaries.set(summary.id, summary);
    for (const game of games) {
      if (!this.confirmedSummaries.has(game.id)) continue;
      this.confirmGame(game);
      this.snapshot.games[game.id] = game;
    }
    if (this.snapshot.data)
      this.snapshot.data.games = this.snapshot.data.games.map(
        (summary) => this.confirmedSummaries.get(summary.id) ?? summary,
      );
    for (const draft of loadDrafts()) {
      const id = draft.game.id;
      if (this.drafts.has(id)) {
        const other = this.recoveredDrafts.get(id) ?? [];
        other.push(draft);
        this.recoveredDrafts.set(id, other);
      } else {
        this.drafts.set(id, draft.game);
        this.storedDrafts.set(id, draft);
        this.replace(draft.game);
      }
    }
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
    this.snapshot = {
      ...this.snapshot,
      pending: [...this.drafts.keys()],
      storageError: this.cacheError || !!this.undurableDrafts.size,
    };
    for (const fn of this.listeners) fn();
  }
  persist() {
    try {
      if (this.snapshot.data) {
        const index = {
          ...this.snapshot.data,
          games: this.snapshot.data.games.map(
            (game) => this.confirmedSummaries.get(game.id) ?? game,
          ),
        };
        const serialized = JSON.stringify(index);
        if (serialized !== this.lastCachedIndex) {
          cacheGameIndex(serialized);
          this.lastCachedIndex = serialized;
        }
      }
      const open = this.openGameId && this.confirmedGames.get(this.openGameId);
      if (open && open !== this.lastCachedGame) {
        cacheOpenGame(open);
        this.lastCachedGame = open;
      }
      this.cacheError = false;
    } catch {
      this.cacheError = true;
    }
  }
  private confirmGame(game: Game) {
    const known = this.confirmedSummaries.get(game.id);
    if (
      (known && known.revision > game.revision) ||
      this.deletedGames.has(game.id)
    )
      return false;
    this.confirmedGames.set(game.id, game);
    this.confirmedSummaries.set(game.id, summarizeGame(game));
    return true;
  }
  watchGames(openGameId?: string, editGameId?: string) {
    this.openGameId = openGameId;
    this.editGameId = editGameId;
    const games = this.snapshot.games;
    if (openGameId && this.confirmedGames.has(openGameId))
      this.rememberOpenedGame(openGameId);
    this.persist();
    if (
      games !== this.snapshot.games ||
      this.snapshot.storageError !==
        (this.cacheError || !!this.undurableDrafts.size)
    )
      this.emit();
    this.loadWatchedGames();
  }
  private rememberOpenedGame(id: string) {
    this.recentGames.delete(id);
    this.recentGames.add(id);
    if (this.recentGames.size <= RECENT_GAME_LIMIT) return;
    const oldest = this.recentGames.values().next().value!;
    this.recentGames.delete(oldest);
    if (
      oldest === this.openGameId ||
      oldest === this.editGameId ||
      this.drafts.has(oldest)
    )
      return;
    this.confirmedGames.delete(oldest);
    const { [oldest]: _game, ...games } = this.snapshot.games;
    this.snapshot.games = games;
  }
  private loadWatchedGames() {
    for (const id of new Set([this.openGameId, this.editGameId]))
      if (id) void this.loadGame(id);
  }
  async loadGame(id: string, retryIfStale = true) {
    const summary = this.confirmedSummaries.get(id);
    const current = this.confirmedGames.get(id);
    if (
      !summary ||
      this.deletedGames.has(id) ||
      this.gameRequests.has(id) ||
      this.drafts.has(id) ||
      (current && current.revision >= summary.revision)
    )
      return;

    this.gameRequests.add(id);
    let stale = false;
    try {
      const game = await api<Game>(`/games/${encodeURIComponent(id)}`);
      if (this.deletedGames.has(id)) return;
      if (!this.confirmGame(game)) {
        stale = true;
        return;
      }
      if (!this.drafts.has(id))
        this.replace(game, this.confirmedSummaries.get(id));
      this.rememberOpenedGame(id);
      if (id in this.snapshot.loadErrors) {
        const { [id]: _error, ...loadErrors } = this.snapshot.loadErrors;
        this.snapshot.loadErrors = loadErrors;
      }
      this.persist();
      this.emit();
    } catch (error) {
      if (this.deletedGames.has(id)) return;
      if ((error as { status?: number }).status === 404) {
        this.forgetGame(id);
        this.persist();
      } else {
        this.snapshot.loadErrors = {
          ...this.snapshot.loadErrors,
          [id]:
            error instanceof Error ? error.message : "Could not load the game.",
        };
      }
      this.emit();
    } finally {
      this.gameRequests.delete(id);
      if (
        stale &&
        retryIfStale &&
        (id === this.openGameId || id === this.editGameId)
      )
        await this.loadGame(id, false);
    }
  }
  private persistDraft(game: Game) {
    try {
      const previous = this.storedDrafts.get(game.id);
      const saved = writeDraft(this.draftOwner, game);
      this.storedDrafts.set(game.id, saved);
      if (previous && previous.key !== saved.key) clearDraft(previous);
      this.undurableDrafts.delete(game.id);
    } catch {
      this.undurableDrafts.add(game.id);
    }
  }
  private removeDraft(id: string) {
    const stored = this.storedDrafts.get(id);
    this.drafts.delete(id);
    this.storedDrafts.delete(id);
    this.undurableDrafts.delete(id);
    if (stored) {
      try {
        clearDraft(stored);
      } catch {
        this.cacheError = true;
      }
    }
  }
  private clearSaveError(id: string) {
    if (!(id in this.snapshot.saveErrors)) return;
    const { [id]: _error, ...saveErrors } = this.snapshot.saveErrors;
    this.snapshot.saveErrors = saveErrors;
  }
  private finishDraft(saved: Game) {
    const id = saved.id;
    this.confirmGame(saved);
    this.removeDraft(id);
    this.replace(
      this.confirmedGames.get(id) ?? saved,
      this.confirmedSummaries.get(id),
    );
    const remaining = this.recoveredDrafts.get(id);
    if (remaining?.length) {
      // Another tab may have resolved a recovered draft since startup.
      const active = new Map(
        loadDrafts().map((draft) => [draft.key, draft.raw]),
      );
      while (remaining.length) {
        const next = remaining.shift()!;
        if (active.get(next.key) !== next.raw) continue;
        this.drafts.set(id, next.game);
        this.storedDrafts.set(id, next);
        this.replace(next.game);
        this.snapshot.conflicts = { ...this.snapshot.conflicts, [id]: saved };
        break;
      }
      if (!remaining.length) this.recoveredDrafts.delete(id);
    }
    if (
      !this.drafts.has(id) &&
      (id === this.openGameId || id === this.editGameId)
    )
      void this.loadGame(id);
  }
  retrySave(id: string) {
    this.clearSaveError(id);
    this.emit();
    void this.flush();
  }
  replace(game: Game, summary = summarizeGame(game)) {
    this.snapshot.games = { ...this.snapshot.games, [game.id]: game };
    if (!this.snapshot.data) return;
    this.snapshot.data = {
      ...this.snapshot.data,
      games: this.snapshot.data.games.map((g) =>
        g.id === game.id ? summary : g,
      ),
    };
  }
  update(game: Game) {
    if (this.deletedGames.has(game.id)) return;
    this.replace(game);
    this.drafts.set(game.id, game);
    this.clearSaveError(game.id);
    this.persistDraft(game);
    this.emit();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 300);
  }
  async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    const before = this.snapshot.data;
    try {
      const remote = await api<GameIndex>("/state/index");
      remote.games = remote.games.map((game) => {
        const known = this.confirmedSummaries.get(game.id);
        const current = known && known.revision >= game.revision ? known : game;
        if (!this.deletedGames.has(game.id))
          this.confirmedSummaries.set(game.id, current);
        const draft = this.drafts.get(game.id);
        if (!draft) return current;
        return (
          this.snapshot.data?.games.find(({ id }) => id === game.id) ??
          summarizeGame(draft)
        );
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
      // Preserve successful metadata edits made while this poll was in flight.
      // The following poll will pick up any later edits from another device.
      for (const key of ["profiles", "templates"] as const) {
        for (let index = 0; index < remote[key].length; index++) {
          const item = remote[key][index];
          const original = before?.[key].find(
            (previous) => previous.id === item.id,
          );
          const local = this.snapshot.data?.[key].find(
            (current) => current.id === item.id,
          );
          if (original && local && original !== local) {
            (remote[key] as { id: string }[])[index] = local;
          }
        }
      }
      remote.templates = remote.templates.filter(
        (t) => !this.deletedTemplates.has(t.id),
      );
      remote.profiles = remote.profiles.filter(
        (p) => !this.deletedProfiles.has(p.id),
      );
      const profileIds = new Set(remote.profiles.map((p) => p.id));
      remote.games = remote.games.filter((g) => profileIds.has(g.profileId));
      const remoteIds = new Set(remote.games.map((g) => g.id));
      for (const game of before?.games || [])
        if (!remoteIds.has(game.id) && !this.deletedGames.has(game.id))
          this.forgetGame(game.id);
      remote.games = remote.games.filter((g) => !this.deletedGames.has(g.id));
      const unchanged =
        this.snapshot.online &&
        this.snapshot.data &&
        JSON.stringify(remote) === JSON.stringify(this.snapshot.data);
      if (!unchanged) {
        this.snapshot = {
          ...this.snapshot,
          data: remote,
          online: true,
          error: "",
        };
        this.persist();
        this.emit();
      }
      this.loadWatchedGames();
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
    if (this.busy || !this.drafts.size) return;
    this.busy = true;
    try {
      for (const [id] of this.drafts) {
        if (this.snapshot.conflicts[id] || this.snapshot.saveErrors[id])
          continue;
        const draft = this.drafts.get(id)!;
        try {
          const saved = await api<Game>(
            `/games/${encodeURIComponent(id)}`,
            "PUT",
            draft,
          );
          if (this.deletedGames.has(id)) continue;
          this.snapshot.online = true;
          if (this.drafts.get(id) === draft) {
            // The server may normalize metadata, but position and history are
            // accepted as submitted. Keep their identity through acknowledgement.
            this.finishDraft({
              ...saved,
              board: draft.board,
              scoring: draft.scoring,
              past: draft.past,
              future: draft.future,
              trackedMoves: draft.trackedMoves,
              excludedRackSlots: draft.excludedRackSlots,
            });
          } else {
            const newer = {
              ...this.drafts.get(id)!,
              revision: saved.revision,
              updatedAt: saved.updatedAt,
            };
            this.confirmGame(saved);
            this.drafts.set(id, newer);
            this.replace(newer);
            this.persistDraft(newer);
          }
        } catch (error) {
          const err = error as Error & { status?: number; game?: Game };
          if (this.deletedGames.has(id)) continue;
          if (err.status === 404) {
            this.forgetGame(id);
          } else if (err.status === 409 && err.game) {
            this.snapshot.conflicts = {
              ...this.snapshot.conflicts,
              [id]: err.game,
            };
          } else if (
            err.status &&
            err.status >= 400 &&
            err.status < 500 &&
            ![408, 425, 429].includes(err.status)
          ) {
            this.snapshot.online = true;
            if (this.drafts.get(id) === draft)
              this.snapshot.saveErrors = {
                ...this.snapshot.saveErrors,
                [id]: err.message,
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
      this.emit();
      if (
        this.snapshot.online &&
        [...this.drafts.keys()].some(
          (id) => !this.snapshot.conflicts[id] && !this.snapshot.saveErrors[id],
        )
      )
        this.timer = setTimeout(() => void this.flush(), 300);
    }
  }
  async createGame(game: Omit<Game, "id" | "revision" | "updatedAt">) {
    const saved = await api<Game>("/games", "POST", game);
    if (this.deletedProfiles.has(saved.profileId))
      throw new Error("This profile was deleted.");
    this.confirmGame(saved);
    this.rememberOpenedGame(saved.id);
    this.snapshot.games = { ...this.snapshot.games, [saved.id]: saved };
    this.snapshot.data = {
      ...this.snapshot.data!,
      games: [...this.snapshot.data!.games, summarizeGame(saved)],
    };
    this.persist();
    this.emit();
    return saved;
  }
  private forgetGame(id: string) {
    this.deletedGames.add(id);
    this.confirmedGames.delete(id);
    this.confirmedSummaries.delete(id);
    this.recentGames.delete(id);
    try {
      dropCachedGame(id);
    } catch {
      this.cacheError = true;
    }
    const { [id]: _game, ...games } = this.snapshot.games;
    const { [id]: _error, ...loadErrors } = this.snapshot.loadErrors;
    this.snapshot.games = games;
    this.snapshot.loadErrors = loadErrors;
    this.removeDraft(id);
    for (const draft of this.recoveredDrafts.get(id) ?? []) {
      try {
        clearDraft(draft);
      } catch {
        this.cacheError = true;
      }
    }
    this.recoveredDrafts.delete(id);
    this.clearSaveError(id);
    const conflicts = { ...this.snapshot.conflicts };
    delete conflicts[id];
    this.snapshot.conflicts = conflicts;
    if (this.snapshot.data)
      this.snapshot.data = {
        ...this.snapshot.data,
        games: this.snapshot.data.games.filter((g) => g.id !== id),
      };
  }
  async deleteGame(id: string) {
    await api(`/games/${encodeURIComponent(id)}`, "DELETE", {});
    this.forgetGame(id);
    this.persist();
    this.emit();
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
  async renameProfile(id: string, name: string) {
    const profile = await api<Profile>(
      `/profiles/${encodeURIComponent(id)}`,
      "PUT",
      { name },
    );
    this.snapshot.data = {
      ...this.snapshot.data!,
      profiles: this.snapshot.data!.profiles.map((item) =>
        item.id === id ? { ...item, name: profile.name } : item,
      ),
    };
    this.persist();
    this.emit();
    return profile;
  }
  async reorderGames(profileId: string, gameIds: string[]) {
    const { gameOrder } = await api<{ gameOrder: string[] }>(
      `/profiles/${encodeURIComponent(profileId)}/game-order`,
      "PUT",
      { gameIds },
    );
    if (!this.snapshot.data) return;
    this.snapshot.data = {
      ...this.snapshot.data,
      profiles: this.snapshot.data.profiles.map((profile) =>
        profile.id === profileId ? { ...profile, gameOrder } : profile,
      ),
    };
    this.persist();
    this.emit();
  }
  async deleteProfile(id: string, name: string) {
    const { gameIds } = await api<{ gameIds: string[] }>(
      `/profiles/${encodeURIComponent(id)}`,
      "DELETE",
      { name },
    );
    this.deletedProfiles.add(id);
    for (const gameId of gameIds) this.forgetGame(gameId);
    this.snapshot.data = {
      ...this.snapshot.data!,
      profiles: this.snapshot.data!.profiles.filter((p) => p.id !== id),
    };
    this.persist();
    this.emit();
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
  async deleteTemplate(id: string) {
    await api(`/templates/${encodeURIComponent(id)}`, "DELETE", {});
    this.deletedTemplates.add(id);
    this.snapshot.data = {
      ...this.snapshot.data!,
      templates: this.snapshot.data!.templates.filter((t) => t.id !== id),
    };
    this.persist();
    this.emit();
  }
  async updateTemplate(template: BoardTemplate) {
    const saved = await api<BoardTemplate>(
      `/templates/${encodeURIComponent(template.id)}`,
      "PUT",
      template,
    );
    this.snapshot.data = {
      ...this.snapshot.data!,
      templates: this.snapshot.data!.templates.map((item) =>
        item.id === saved.id ? saved : item,
      ),
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
    const conflicts = { ...this.snapshot.conflicts };
    delete conflicts[id];
    this.snapshot.conflicts = conflicts;
    this.finishDraft(remote);
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
