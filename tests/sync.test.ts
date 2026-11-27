import { test } from "node:test";
import assert from "node:assert/strict";
import { GameStore } from "../src/store";
import {
  archiveGame,
  emptyBoard,
  newGameFromSettings,
  remember,
  type Game,
} from "../shared/model";
import {
  cacheGameIndex,
  cacheOpenGame,
  RECENT_GAME_LIMIT,
} from "../src/game-cache";
import { BoardEditHistory } from "../shared/board-entry";
import { summarizeGame } from "../shared/game-index";
import { PRESETS } from "../shared/presets";

function setup() {
  const values = new Map<string, string>();
  const originalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return values.size;
      },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  const originalFetch = globalThis.fetch;
  const game: Game = {
    id: "g",
    profileId: "p",
    name: "Test",
    template: PRESETS[0],
    dictionaryId: "test",
    board: emptyBoard(15),
    rack: "",
    past: [],
    future: [],
    archived: false,
    revision: 0,
    updatedAt: "",
  };
  const initial = {
    profiles: [{ id: "p", name: "Test" }],
    games: [game],
    templates: PRESETS,
    dictionaries: [],
  };
  localStorage.setItem("tilewise:cache", JSON.stringify(initial));
  const client = new GameStore();
  return {
    client,
    game,
    cleanup() {
      clearTimeout(client.timer);
      globalThis.fetch = originalFetch;
      if (originalStorage)
        Object.defineProperty(globalThis, "localStorage", originalStorage);
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    },
  };
}
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
test("editing during an in-flight save preserves newer input and advances its revision", async () => {
  const { client, game, cleanup } = setup();
  try {
    let finish!: (r: Response) => void;
    globalThis.fetch = async () => new Promise<Response>((r) => (finish = r));
    client.update({ ...game, rack: "CAT" });
    const saving = client.flush();
    client.update({ ...game, rack: "CATS" });
    const startedAt = "2026-11-20T15:05:00.000Z";
    finish(response({ ...game, rack: "CAT", revision: 1, startedAt }));
    await saving;
    assert.equal(client.drafts.get("g")!.rack, "CATS");
    assert.equal(client.drafts.get("g")!.revision, 1);
    globalThis.fetch = async (_url, options) =>
      response({ ...JSON.parse(options!.body as string), revision: 2 });
    await client.flush();
    assert.equal(client.drafts.size, 0);
    assert.equal(client.snapshot.games.g.rack, "CATS");
    assert.equal(client.snapshot.games.g.startedAt, startedAt);
    assert.equal(client.snapshot.data!.games[0].revision, 2);
  } finally {
    cleanup();
  }
});
test("server move versions survive normal saves and merge into a newer pending draft", async () => {
  const { client, game, cleanup } = setup();
  try {
    const draft = { ...game, ...remember(game, "PASS", 0, "you", false) };
    const stamped = {
      ...draft,
      revision: 1,
      past: draft.past.map((entry) => ({ ...entry, serverVersion: "0.3.149" })),
      trackedMoves: draft.trackedMoves?.map((move) => ({ ...move, serverVersion: "0.3.149" })),
    };
    let finish!: (r: Response) => void;
    globalThis.fetch = async () => new Promise<Response>((resolve) => (finish = resolve));
    client.update(draft);
    const saving = client.flush();
    client.update({ ...draft, rack: "CAT" });
    finish(response(stamped));
    await saving;
    const newer = client.drafts.get(game.id)!;
    assert.equal(newer.rack, "CAT");
    assert.equal(newer.board, game.board);
    assert.equal(newer.past[0].serverVersion, "0.3.149");
    assert.equal(newer.trackedMoves?.[0].serverVersion, "0.3.149");
    globalThis.fetch = async () => response({ ...stamped, rack: "CAT", revision: 2 });
    await client.flush();
    assert.equal(client.snapshot.games.g.board, game.board);
    assert.equal(client.snapshot.games.g.trackedMoves?.[0].serverVersion, "0.3.149");
  } finally {
    cleanup();
  }
});
test("archive and start waits for an in-flight save and a newer queued edit", async () => {
  const { client, game, cleanup } = setup();
  try {
    let finish!: (r: Response) => void;
    let latest = game;
    const requests: Array<[string, unknown]> = [];
    const startedOn = "2026-11-15";
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options!.body as string);
      requests.push([options!.method!, body]);
      if (options?.method === "PUT") {
        latest = { ...body, revision: body.revision + 1 };
        return requests.length === 1
          ? new Promise((resolve) => (finish = resolve))
          : response(latest);
      }
      return response(
        {
          archived: { ...archiveGame(latest), revision: latest.revision + 1 },
          created: {
            ...newGameFromSettings(latest, startedOn),
            id: "fresh",
            revision: 0,
            updatedAt: "",
          },
        },
        201,
      );
    };
    client.update({ ...game, rack: "CAT" });
    const saving = client.flush();
    client.update({ ...game, rack: "CATS" });
    const archiving = client.archiveAndStartNewGame(game.id, startedOn);
    assert.deepEqual(
      requests.map(([method]) => method),
      ["PUT"],
    );
    finish(response(latest));
    await saving;
    const created = await archiving;
    assert.deepEqual(
      requests.map(([method]) => method),
      ["PUT", "PUT", "POST"],
    );
    assert.deepEqual(requests[2][1], { revision: 2, startedOn });
    assert.equal(client.snapshot.games.g.archivedState?.rack, "CATS");
    assert.equal(client.snapshot.games[created.id].rack, "");
    assert.deepEqual(
      client.snapshot.data!.games.map(({ id, archived }) => [id, archived]),
      [
        ["g", true],
        ["fresh", false],
      ],
    );
    assert.deepEqual(client.snapshot.pending, []);
  } finally {
    cleanup();
  }
});
test("offline drafts survive reload and stale revisions become explicit conflicts", async () => {
  const { client, game, cleanup } = setup();
  let reloaded: GameStore | undefined;
  try {
    globalThis.fetch = async () => {
      throw new Error("Offline");
    };
    client.update({ ...game, rack: "CAT" });
    await client.flush();
    assert.equal(client.snapshot.online, false);
    reloaded = new GameStore();
    assert.equal(reloaded.drafts.get("g")!.rack, "CAT");
    const remote = { ...game, rack: "DOG", revision: 2 };
    globalThis.fetch = async () =>
      response({ error: "Changed elsewhere", game: remote }, 409);
    await reloaded.flush();
    assert.equal(reloaded.snapshot.conflicts.g.rack, "DOG");
    assert.equal(reloaded.snapshot.games.g.rack, "CAT");
    reloaded.acceptRemote("g");
    assert.equal(reloaded.snapshot.games.g.rack, "DOG");
    assert.equal(reloaded.drafts.size, 0);
  } finally {
    if (reloaded) clearTimeout(reloaded.timer);
    cleanup();
  }
});
test("a background poll cannot erase a game created while it was in flight", async () => {
  const { client, game, cleanup } = setup();
  try {
    let finish!: (r: Response) => void;
    client.snapshot.online = true;
    const oldState = structuredClone(client.snapshot.data!);
    globalThis.fetch = async (url, options) =>
      String(url).endsWith("/state/index")
        ? new Promise<Response>((r) => (finish = r))
        : response({ ...JSON.parse(options!.body as string), id: "server-game", revision: 0 });
    const refreshing = client.refresh();
    const created = await client.createGame({ ...game, name: "New game" });
    finish(response(oldState));
    await refreshing;
    assert.ok(client.snapshot.data!.games.some((g) => g.id === created.id));
  } finally {
    cleanup();
  }
});

test("background polls preserve profile renames and template edits made during the request", async () => {
  const { client, game, cleanup } = setup();
  try {
    const template = {
      ...PRESETS[0],
      id: "custom",
      name: "Custom",
      builtin: false,
    };
    client.snapshot.data!.templates = [...PRESETS, template];
    const oldState = structuredClone(client.snapshot.data!);
    let finish!: (r: Response) => void;
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith("/state/index"))
        return new Promise<Response>((r) => (finish = r));
      if (String(url).includes("/profiles/"))
        return response({ id: "p", name: "Renamed" });
      return response(JSON.parse(options!.body as string));
    };
    const refreshing = client.refresh();
    await client.renameProfile("p", "Renamed");
    await client.updateTemplate({ ...template, name: "Edited", bingo: 25 });
    finish(response(oldState));
    await refreshing;
    assert.equal(client.snapshot.data!.profiles[0].name, "Renamed");
    assert.equal(
      client.snapshot.data!.templates.find((t) => t.id === "custom")!.bingo,
      25,
    );
    assert.deepEqual(client.snapshot.games.g, game);
    // A subsequent poll must still accept changes made on another device.
    const remote = structuredClone(client.snapshot.data!);
    remote.profiles[0].name = "Another device";
    globalThis.fetch = async () => response(remote);
    await client.refresh();
    assert.equal(client.snapshot.data!.profiles[0].name, "Another device");
  } finally {
    cleanup();
  }
});

test("a stale poll and in-flight save cannot resurrect a locally deleted game", async () => {
  const { client, game, cleanup } = setup();
  try {
    const old = structuredClone(client.snapshot.data!);
    let poll!: (r: Response) => void, save!: (r: Response) => void;
    globalThis.fetch = async (url, options) =>
      options?.method === "DELETE"
        ? response({ deleted: true })
        : String(url).endsWith("/state/index")
          ? new Promise((r) => (poll = r))
          : new Promise((r) => (save = r));
    const refreshing = client.refresh();
    client.update({ ...game, rack: "CAT" });
    const saving = client.flush();
    await client.deleteGame(game.id);
    poll(response(old));
    save(response({ ...game, rack: "CAT", revision: 1 }));
    await Promise.all([refreshing, saving]);
    assert.equal(client.snapshot.data!.games.length, 0);
    assert.equal(client.drafts.size, 0);
    client.update(game);
    assert.equal(client.drafts.size, 0);
  } finally {
    cleanup();
  }
});
test("remote deletion removes obsolete drafts; failed deletion keeps the game", async () => {
  const { client, game, cleanup } = setup();
  try {
    globalThis.fetch = async () => response({ error: "Unavailable" }, 503);
    await assert.rejects(() => client.deleteGame(game.id));
    assert.equal(client.snapshot.data!.games.length, 1);
    client.update({ ...game, rack: "CAT" });
    globalThis.fetch = async () => response({ error: "Game not found." }, 404);
    await client.flush();
    assert.equal(client.drafts.size, 0);
    assert.equal(client.snapshot.data!.games.length, 0);
  } finally {
    cleanup();
  }
});

test("custom board deletion survives stale polling and leaves templates intact on failure", async () => {
  const { client, cleanup } = setup();
  try {
    const custom = { ...PRESETS[0], id: "custom", builtin: false };
    client.snapshot.data!.templates = [...PRESETS, custom];
    globalThis.fetch = async () => response({ error: "Unavailable" }, 503);
    await assert.rejects(() => client.deleteTemplate(custom.id));
    assert.equal(client.snapshot.data!.templates.length, PRESETS.length + 1);
    const old = structuredClone(client.snapshot.data!);
    let poll!: (r: Response) => void;
    globalThis.fetch = async (_url, options) =>
      options?.method === "DELETE"
        ? response({ deleted: true })
        : new Promise((r) => (poll = r));
    const refreshing = client.refresh();
    await client.deleteTemplate(custom.id);
    poll(response(old));
    await refreshing;
    assert.deepEqual(client.snapshot.data!.templates, PRESETS);
    assert.deepEqual(
      JSON.parse(localStorage.getItem("tilewise:game-index")!).templates,
      PRESETS,
    );
  } finally {
    cleanup();
  }
});

test("word list removal survives a stale poll and a later reinstall appears", async () => {
  const { client, cleanup } = setup();
  try {
    const dictionary = {
      id: "house",
      name: "House words",
      count: 3,
      description: "Imported word list",
      builtin: false,
    };
    client.snapshot.data!.dictionaries = [dictionary];
    globalThis.fetch = async () => response({ error: "In use" }, 409);
    await assert.rejects(() => client.deleteDictionary(dictionary.id), /In use/);
    assert.deepEqual(client.snapshot.data!.dictionaries, [dictionary]);

    const old = structuredClone(client.snapshot.data!);
    let poll!: (r: Response) => void;
    globalThis.fetch = async (_url, options) =>
      options?.method === "DELETE"
        ? response({ deleted: true })
        : new Promise((r) => (poll = r));
    const refreshing = client.refresh();
    await client.deleteDictionary(dictionary.id);
    poll(response(old));
    await refreshing;
    assert.deepEqual(client.snapshot.data!.dictionaries, []);
    assert.deepEqual(
      JSON.parse(localStorage.getItem("tilewise:game-index")!).dictionaries,
      [],
    );

    globalThis.fetch = async () => response(old);
    await client.refresh();
    assert.deepEqual(client.snapshot.data!.dictionaries, [dictionary]);
  } finally {
    cleanup();
  }
});

test("another tab polling cannot erase drafts for the same or a different game", async () => {
  const { client, game, cleanup } = setup();
  const otherGame = { ...game, id: "other" };
  localStorage.setItem(
    "tilewise:cache",
    JSON.stringify({
      ...client.snapshot.data!,
      games: [game, otherGame],
    }),
  );
  const secondTab = new GameStore();
  const remote = structuredClone(secondTab.snapshot.data!);
  client.snapshot.data = remote;
  try {
    client.update({ ...game, rack: "CAT" });
    clearTimeout(client.timer);
    globalThis.fetch = async () => response(remote);
    await secondTab.refresh();
    assert.equal(new GameStore().drafts.get(game.id)?.rack, "CAT");

    secondTab.update({ ...game, rack: "DOG" });
    secondTab.update({ ...otherGame, rack: "BIRD" });
    clearTimeout(secondTab.timer);
    globalThis.fetch = async () =>
      response({ ...game, rack: "CAT", revision: 1 });
    await client.flush();
    const reloaded = new GameStore();
    assert.equal(reloaded.drafts.get(game.id)?.rack, "DOG");
    assert.equal(reloaded.drafts.get(otherGame.id)?.rack, "BIRD");
  } finally {
    clearTimeout(secondTab.timer);
    cleanup();
  }
});

test("reload lets the user resolve multiple drafts for the same game", async () => {
  const { client, game, cleanup } = setup();
  const secondTab = new GameStore();
  let reloaded: GameStore | undefined;
  try {
    client.update({ ...game, rack: "CAT" });
    secondTab.update({ ...game, rack: "DOG" });
    reloaded = new GameStore();
    const saved = { ...reloaded.drafts.get(game.id)!, revision: 1 };
    globalThis.fetch = async () => response(saved);
    await reloaded.flush();
    assert.equal(reloaded.snapshot.conflicts[game.id].rack, saved.rack);
    assert.deepEqual(
      new Set([saved.rack, reloaded.drafts.get(game.id)?.rack]),
      new Set(["CAT", "DOG"]),
    );
    reloaded.acceptRemote(game.id);
    assert.equal(new GameStore().drafts.size, 0);
  } finally {
    clearTimeout(secondTab.timer);
    if (reloaded) clearTimeout(reloaded.timer);
    cleanup();
  }
});

test("legacy drafts are recovered and removed only after acknowledgment", async () => {
  const { game, client, cleanup } = setup();
  try {
    localStorage.setItem(
      "tilewise:drafts",
      JSON.stringify({ [game.id]: { ...game, rack: "CAT" } }),
    );
    const reloaded = new GameStore();
    assert.equal(reloaded.drafts.get(game.id)?.rack, "CAT");
    assert.equal(new GameStore().drafts.get(game.id)?.rack, "CAT");
    globalThis.fetch = async () =>
      response({ ...game, rack: "CAT", revision: 1 });
    await reloaded.flush();
    assert.equal(new GameStore().drafts.size, 0);
  } finally {
    cleanup();
  }
});

test("a permanently rejected draft leaves other games online and retries only after an edit", async () => {
  const { client, game, cleanup } = setup();
  try {
    const otherGame = { ...game, id: "other" };
    client.snapshot.data!.games.push(summarizeGame(otherGame));
    const remote = structuredClone(client.snapshot.data!);
    const writes: string[] = [];
    globalThis.fetch = async (url, options) => {
      if (!options?.method || options.method === "GET") return response(remote);
      const draft: Game = JSON.parse(options.body as string);
      writes.push(String(url));
      return draft.id === game.id && draft.rack === "CAT"
        ? new Response("Payload too large", { status: 413 })
        : response({ ...draft, revision: 1 });
    };
    client.update({ ...game, rack: "CAT" });
    client.update({ ...otherGame, rack: "DOG" });
    await client.flush();
    assert.deepEqual(writes, ["/api/games/g", "/api/games/other"]);
    assert.equal(client.snapshot.online, true);
    assert.ok(client.snapshot.saveErrors[game.id]);
    assert.equal(client.snapshot.data!.games[1].revision, 1);
    await client.refresh();
    assert.equal(writes.length, 2);
    client.update({ ...game, rack: "CATS" });
    await client.flush();
    assert.equal(writes.length, 3);
    assert.equal(client.snapshot.saveErrors[game.id], undefined);
    assert.equal(client.drafts.size, 0);
  } finally {
    cleanup();
  }
});

test("polling refreshes an older cached summary at the same game revision", async () => {
  const { client, game, cleanup } = setup();
  try {
    const score = { you: 300, opponent: 280, outcome: "win" };
    const { score: _score, dictionaryId, ...cached } = summarizeGame({ ...game, archived: true });
    const index = { ...client.snapshot.data!, games: [cached] };
    cacheGameIndex(JSON.stringify(index));
    localStorage.removeItem("tilewise:cache");
    const reloaded = new GameStore();
    globalThis.fetch = async (url) => {
      assert.equal(url, "/api/state/index");
      return response({ ...index, games: [{ ...cached, score, dictionaryId }] });
    };
    await reloaded.refresh();
    assert.deepEqual(reloaded.snapshot.data?.games[0].score, score);
    assert.equal(reloaded.snapshot.data?.games[0].dictionaryId, game.dictionaryId);
    assert.deepEqual(reloaded.snapshot.games, {});
  } finally {
    cleanup();
  }
});

test("polling notices version changes without changing the cached game index", async () => {
  const { client, game, cleanup } = setup();
  try {
    const index = { ...client.snapshot.data!, games: [summarizeGame(game)] };
    let version = "0.1.22";
    globalThis.fetch = async (url) => {
      assert.equal(url, "/api/state/index");
      return response({ ...index, version });
    };

    await client.refresh();
    assert.equal(client.snapshot.serverVersion, "0.1.22");
    const notify = client.getSnapshot();
    version = "0.1.23";
    await client.refresh();
    assert.notEqual(client.getSnapshot(), notify);
    assert.equal(client.snapshot.serverVersion, "0.1.23");
    assert.deepEqual(client.snapshot.data, index);
    assert.equal(new GameStore().snapshot.serverVersion, undefined);
  } finally {
    cleanup();
  }
});

test("polling only loads full histories for watched games with a new revision", async () => {
  const { client, game, cleanup } = setup();
  try {
    const other = {
      ...game,
      id: "other",
      rack: "DOG",
      revision: 2,
      archived: true,
    };
    const remote = { ...game, rack: "CAT", revision: 1 };
    const index = {
      ...client.snapshot.data!,
      games: [remote, other].map(summarizeGame),
    };
    const calls: string[] = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/state/index")) return response(index);
      return response(String(url).endsWith("/other") ? other : remote);
    };

    await client.refresh();
    assert.deepEqual(calls, ["/api/state/index"]);
    assert.equal(client.snapshot.games.other, undefined);
    client.watchGames(game.id);
    await client.loadGame(game.id);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(client.snapshot.games.g.rack, "CAT");
    await client.refresh();
    assert.equal(calls.filter((url) => url === "/api/games/g").length, 1);

    client.watchGames(undefined, other.id);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(client.getSnapshot().games.other?.rack, "DOG");
    assert.equal(calls.filter((url) => url === "/api/games/other").length, 1);
  } finally {
    cleanup();
  }
});

test("a watched game retries a stale response and does not resurrect after deletion", async () => {
  const { client, game, cleanup } = setup();
  try {
    const remote = { ...game, rack: "CAT", revision: 1 };
    const latest = { ...game, rack: "DOG", revision: 2 };
    let index = { ...client.snapshot.data!, games: [summarizeGame(remote)] };
    let finish!: (value: Response) => void;
    let delayed = true;
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith("/state/index")) return response(index);
      if (options?.method === "DELETE") return response({ deleted: true });
      return delayed
        ? new Promise((resolve) => (finish = resolve))
        : response(latest);
    };
    await client.refresh();
    client.watchGames(game.id);
    index = { ...index, games: [summarizeGame(latest)] };
    await client.refresh();
    delayed = false;
    finish(response(remote));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(client.snapshot.games.g.rack, "DOG");
    assert.equal(client.snapshot.data!.games[0].revision, 2);

    const deleted = { ...latest, revision: 3 };
    delayed = true;
    index = { ...index, games: [summarizeGame(deleted)] };
    await client.refresh();
    await client.deleteGame(game.id);
    finish(response(deleted));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(client.snapshot.games.g, undefined);
    assert.equal(client.snapshot.data!.games.length, 0);
  } finally {
    cleanup();
  }
});

test("a detail response cannot overwrite a draft created while loading", async () => {
  const { client, game, cleanup } = setup();
  try {
    const remote = { ...game, rack: "DOG", revision: 1 };
    const index = { ...client.snapshot.data!, games: [summarizeGame(remote)] };
    let finish!: (value: Response) => void;
    globalThis.fetch = async (url) =>
      String(url).endsWith("/state/index")
        ? response(index)
        : new Promise((resolve) => (finish = resolve));
    await client.refresh();
    const loading = client.loadGame(game.id);
    const draft = { ...game, rack: "CAT" };
    client.update(draft);
    finish(response(remote));
    await loading;
    assert.equal(client.snapshot.games.g, draft);
    assert.equal(client.drafts.get(game.id), draft);
  } finally {
    cleanup();
  }
});

test("the recent cache preserves a bounded set of games and newer copies across tabs", () => {
  const { client, game, cleanup } = setup();
  try {
    const games = Array.from({ length: RECENT_GAME_LIMIT + 1 }, (_, index) => ({
      ...game,
      id: `g${index}`,
      revision: 1,
      rack: "CAT",
    }));
    cacheGameIndex(
      JSON.stringify({
        ...client.snapshot.data!,
        games: games.map(summarizeGame),
      }),
    );
    for (const entry of games) cacheOpenGame(entry);
    assert.equal(new GameStore().snapshot.games.g0, undefined);
    assert.equal(
      Object.keys(new GameStore().snapshot.games).length,
      RECENT_GAME_LIMIT,
    );
    cacheOpenGame({ ...games[1], revision: 2, rack: "DOG" });
    cacheOpenGame(games[1]);
    assert.equal(new GameStore().snapshot.games.g1.rack, "DOG");
    assert.equal(localStorage.getItem("tilewise:cache"), null);
  } finally {
    cleanup();
  }
});

test("board typing stays grouped across a server JSON acknowledgement", async () => {
  const { client, game, cleanup } = setup();
  try {
    const history = new BoardEditHistory();
    const board = [...game.board];
    board[112] = "A";
    client.update(history.apply(game, board, "enter"));
    globalThis.fetch = async (_url, options) =>
      response({
        ...JSON.parse(options!.body as string),
        revision: 1,
      });
    await client.flush();
    const saved = client.snapshot.games.g;
    const next = [...saved.board];
    next[113] = "T";
    assert.equal(saved.revision, 1);
    assert.equal(history.apply(saved, next, "enter").past.length, 1);
  } finally {
    cleanup();
  }
});

test("legacy offline games survive reload, remain in the index, and sync their latest edits", async () => {
  const { client, game, cleanup } = setup();
  let reloaded: GameStore | undefined;
  try {
    globalThis.fetch = async () => {
      throw new Error("Offline");
    };
    const created = { ...game, id: "0123456789abcdef0123456789abcdef", name: "Offline game", revision: -1 };
    client.update(created);
    await client.flush();
    client.update({ ...created, rack: "CAT" });
    clearTimeout(client.timer);
    reloaded = new GameStore();
    assert.equal(reloaded.snapshot.games[created.id].rack, "CAT");
    assert.ok(reloaded.snapshot.data!.games.some((g) => g.id === created.id));
    const writes: Game[] = [];
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith("/state/index"))
        return response({
          ...client.snapshot.data!,
          games: [summarizeGame(game)],
        });
      assert.equal(options?.method, "POST");
      const body = JSON.parse(options!.body as string);
      assert.equal(body.creationId, created.id);
      writes.push(body);
      return response({ ...body, revision: 0 });
    };
    await reloaded.refresh();
    // refresh initiates the save without blocking index updates.
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(writes.length, 1);
    assert.equal(writes[0].rack, "CAT");
    assert.equal(reloaded.drafts.size, 0);
    assert.equal(reloaded.snapshot.games[created.id].revision, 0);
  } finally {
    if (reloaded) clearTimeout(reloaded.timer);
    cleanup();
  }
});

test("new game creation requires a connection and waits for a server ID", async () => {
  const { client, game, cleanup } = setup();
  try {
    let acknowledge!: (response: Response) => void;
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      return new Promise((resolve) => { acknowledge = resolve; });
    };
    await assert.rejects(client.createGame(game), /Connect to the server/);
    assert.equal(requests, 0);
    client.snapshot.online = true;
    const creating = client.createGame(game);
    assert.equal(client.drafts.size, 0);
    assert.equal(client.snapshot.data!.games.length, 1);
    acknowledge(response({ ...game, id: "server-id" }));
    const created = await creating;
    assert.equal(created.id, "server-id");
    assert.equal(client.snapshot.games[created.id], created);
    assert.equal(requests, 1);
  } finally {
    cleanup();
  }
});

test("retrying a lost creation response reuses the request token", async () => {
  const { client, game, cleanup } = setup();
  try {
    client.snapshot.online = true;
    const tokens: string[] = [];
    const input = { ...game, name: "New game" };
    const saved = { ...input, id: "server-id" };
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith("/state/index")) return response(client.snapshot.data);
      const body = JSON.parse(options!.body as string);
      assert.equal(body.creationId, undefined);
      tokens.push(body.creationToken);
      if (tokens.length === 1) throw new Error("Response lost");
      return response(saved);
    };
    await assert.rejects(client.createGame(input), /Response lost/);
    assert.equal(client.drafts.size, 0);
    assert.equal((await client.createGame(input)).id, saved.id);
    assert.match(tokens[0], /^[a-f0-9]{32}$/);
    assert.equal(tokens[0], tokens[1]);
  } finally {
    cleanup();
  }
});

test("a legacy offline draft never overwrites an existing game with the same ID", async () => {
  const { client, game, cleanup } = setup();
  try {
    globalThis.fetch = async () => {
      throw new Error("Offline");
    };
    const created = { ...game, id: "0123456789abcdef0123456789abcdef", revision: -1 };
    client.update(created);
    const remote = { ...created, rack: "DOG", revision: 0 };
    globalThis.fetch = async () => response({ game: remote }, 409);
    await client.flush();
    assert.equal(client.snapshot.conflicts[created.id].revision, 0);
    assert.equal(client.drafts.get(created.id)?.revision, -1);
  } finally {
    cleanup();
  }
});

test("a poll started during game creation cannot erase the server acknowledgement", async () => {
  const { client, game, cleanup } = setup();
  try {
    let finishSave!: (value: Response) => void;
    let finishPoll!: (value: Response) => void;
    const oldIndex = structuredClone(client.snapshot.data!);
    globalThis.fetch = async (url) =>
      new Promise((resolve) => {
        if (String(url).endsWith("/state/index")) finishPoll = resolve;
        else finishSave = resolve;
      });
    client.snapshot.online = true;
    const creating = client.createGame(game);
    const refreshing = client.refresh();
    finishSave(response({ ...game, id: "server-id", revision: 0 }));
    const created = await creating;
    assert.equal(client.drafts.size, 0);
    finishPoll(response(oldIndex));
    await refreshing;
    assert.ok(client.snapshot.data!.games.some((g) => g.id === created.id));
    assert.equal(client.snapshot.games[created.id].revision, 0);
  } finally {
    cleanup();
  }
});
