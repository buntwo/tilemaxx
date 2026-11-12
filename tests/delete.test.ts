import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../server/store";
import { createApp } from "../server/app";
test("delete persists across restart, rejects stale saves and preserves profile and templates", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tilewise-delete-"));
  let store = createStore(dir, process.cwd());
  const server = createApp(store).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const initial = store.state(),
    game = initial.games[0];
  try {
    const url = `${base}/games/${game.id}`;
    assert.equal(
      (
        await fetch(url, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://evil.example",
          },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.ok(store.getGame(game.id));
    assert.equal(
      (
        await fetch(url, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(game),
        })
      ).status,
      404,
    );
    await new Promise<void>((r) => server.close(() => r()));
    store.db.close();
    store = createStore(dir, process.cwd());
    assert.equal(store.state().games.length, 0);
    assert.deepEqual(store.state().profiles, initial.profiles);
    assert.deepEqual(store.state().templates, initial.templates);
  } finally {
    server.close();
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
