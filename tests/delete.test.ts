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

test("custom template deletion preserves existing game snapshots and protects all presets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tilewise-board-delete-"));
  let store = createStore(dir, process.cwd());
  const server = createApp(store).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/templates/`;
  const initial = store.state(),
    template = store.saveTemplate({
      ...initial.templates[0],
      name: "Custom test",
    });
  const game = store.createGame({ ...initial.games[0], template });
  const request = (id: string, method = "DELETE", body: unknown = {}) =>
    fetch(base + id, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    for (const preset of initial.templates) {
      assert.equal((await request(preset.id)).status, 403);
      assert.equal(store.deleteTemplate(preset.id), false);
    }
    assert.equal((await request(template.id)).status, 200);
    assert.equal((await request(template.id, "PUT", template)).status, 404);
    assert.deepEqual(store.getGame(game.id)!.template, template);
    await new Promise<void>((r) => server.close(() => r()));
    store.db.close();
    store = createStore(dir, process.cwd());
    assert.deepEqual(store.state().templates, initial.templates);
    assert.deepEqual(store.getGame(game.id)!.template, template);
  } finally {
    server.close();
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
