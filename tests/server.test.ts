import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../server/store";
import { createApp } from "../server/app";
import type { AppState, Game } from "../shared/model";

test("durable games, profiles, templates, dictionary import and stale-update rejection", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tilewise-test-"));
  let store = createStore(dir, process.cwd());
  const server = createApp(store).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address() as { port: number },
    base = `http://127.0.0.1:${address.port}`;
  const req = (
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + "/api" + path, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    const state: AppState = await (await req("/state")).json(),
      game = state.games[0];
    assert.equal(state.templates.length, 3);
    assert.equal(state.dictionaries.length, 2);
    const profile = await (
      await req("/profiles", "POST", { name: "Phone player" })
    ).json();
    assert.equal(profile.name, "Phone player");
    const created: Game = await (
      await req("/games", "POST", {
        ...game,
        profileId: profile.id,
        name: "Phone game",
      })
    ).json();
    const first = await req(`/games/${game.id}`, "PUT", {
      ...game,
      rack: "CAT",
    });
    assert.equal(first.status, 200);
    const updated = await first.json();
    assert.equal(updated.revision, 1);
    const stale = await req(`/games/${game.id}`, "PUT", {
      ...game,
      rack: "DOG",
    });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).game.rack, "CAT");
    assert.equal(
      (
        await req(`/games/${game.id}`, "PUT", {
          ...updated,
          rack: "ABCDEFGHIJK",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await req(
          "/profiles",
          "POST",
          { name: "bad" },
          { Origin: "https://unrelated.example" },
        )
      ).status,
      403,
    );
    const template = await (
      await req("/templates", "POST", {
        ...game.template,
        name: "Small custom",
        size: 5,
        start: 12,
        premiums: Array(25).fill("QW"),
      })
    ).json();
    assert.equal(template.size, 5);
    assert.equal(template.builtin, false);
    const dictionary = await (
      await req("/dictionaries", "POST", {
        name: "House words",
        text: "CAT\nDOG\nCAT\n",
      })
    ).json();
    assert.equal(dictionary.count, 2);
    assert.equal(
      await (await req(`/dictionaries/${dictionary.id}`)).text(),
      "CAT\nDOG\n",
    );
    assert.equal(
      (await req("/games", "POST", { ...created, board: [] })).status,
      400,
    );
    await new Promise<void>((r) => server.close(() => r()));
    store.db.close();
    store = createStore(dir, process.cwd());
    assert.equal(store.getGame(game.id)!.rack, "CAT");
    assert.equal(store.state().profiles.length, 2);
    assert.ok(store.getGame(created.id));
    assert.equal(store.state().templates.length, 4);
    assert.equal(store.dictionaries().length, 3);
  } finally {
    server.close();
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
