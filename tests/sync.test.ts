import { test } from "node:test";
import assert from "node:assert/strict";
import { GameStore } from "../src/store";
import { type Game, emptyBoard, type AppState } from "../shared/model";
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
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
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
  const client = new GameStore();
  client.snapshot.data = {
    profiles: [{ id: "p", name: "Test" }],
    games: [game],
    templates: PRESETS,
    dictionaries: [],
  };
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
    finish(response({ ...game, rack: "CAT", revision: 1 }));
    await saving;
    assert.equal(client.drafts.get("g")!.rack, "CATS");
    assert.equal(client.drafts.get("g")!.revision, 1);
    globalThis.fetch = async (_url, options) =>
      response({ ...JSON.parse(options!.body as string), revision: 2 });
    await client.flush();
    assert.equal(client.drafts.size, 0);
    assert.equal(client.snapshot.data!.games[0].rack, "CATS");
    assert.equal(client.snapshot.data!.games[0].revision, 2);
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
    assert.equal(reloaded.snapshot.data!.games[0].rack, "CAT");
    reloaded.acceptRemote("g");
    assert.equal(reloaded.snapshot.data!.games[0].rack, "DOG");
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
    const oldState = structuredClone(client.snapshot.data!);
    globalThis.fetch = async (url) =>
      String(url).endsWith("/state")
        ? new Promise<Response>((r) => (finish = r))
        : response({ ...game, id: "new", name: "New game" });
    const refreshing = client.refresh();
    await client.createGame({ ...game, name: "New game" });
    finish(response(oldState));
    await refreshing;
    assert.ok(client.snapshot.data!.games.some((g) => g.id === "new"));
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
      if (String(url).endsWith("/state"))
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
    assert.deepEqual(client.snapshot.data!.games[0], game);
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
        : String(url).endsWith("/state")
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
