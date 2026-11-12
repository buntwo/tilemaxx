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
