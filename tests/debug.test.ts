import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createApp } from "../server/app";
import { createStore } from "../server/store";
import { runDebug } from "../scripts/debug";
import { version } from "../version.json";

test("debug API and tools export reproducible snapshots without writes", async () => {
  const root = mkdtempSync(join(tmpdir(), "tilemaxx-debug-"));
  const store = createStore(join(root, "server"), process.cwd());
  const server = createApp(store).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const game = store.state().games[0];
  assert.deepEqual(store.debugIndex(), store.index());
  // Force the legacy-summary path: debugging must not backfill derived data.
  store.db.exec("DELETE FROM game_summaries");
  const before = store.state();
  const changes = store.db.prepare("SELECT total_changes() AS n").get()!.n;
  const logs: string[] = [];
  try {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      for (const path of [
        "/games",
        `/games/${game.id}`,
        "/profiles",
        "/unknown",
      ]) {
        const response = await fetch(`${base}/api/debug${path}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            Origin: "http://elsewhere",
          },
          body: "invalid JSON",
        });
        assert.equal(response.status, 405);
        assert.equal(response.headers.get("allow"), "GET, HEAD");
      }
    }
    assert.equal(
      (await fetch(`${base}/api/debug/games`, { method: "HEAD" })).status,
      200,
    );
    assert.equal((await fetch(`${base}/api/debug/unknown`)).status, 404);
    assert.equal(
      (
        await fetch(
          `${base}/api/debug/games/00000000-0000-4000-8000-000000000000`,
        )
      ).status,
      404,
    );
    await runDebug(["games", "--server", base], {
      root,
      log: (s) => logs.push(s),
    });
    assert.ok(logs[0].includes(game.id));
    assert.ok(logs[0].includes("My profile"));
    logs.length = 0;
    await runDebug(
      ["games", "--name", "no such game", "--profile", "My profile"],
      {
        root,
        server: base,
        log: (s) => logs.push(s),
      },
    );
    assert.equal(logs[0].split("\n").length, 1);
    for (let i = 0; i < 2; i++)
      await runDebug(["game", game.id, "--server", base], {
        root,
        log: () => {},
      });
    const folders = readdirSync(join(root, "data/debug"));
    assert.equal(
      folders.length,
      2,
      "downloads never overwrite previous snapshots",
    );
    const folder = join(root, "data/debug", folders[0]);
    const snapshot = JSON.parse(
      readFileSync(join(folder, "snapshot.json"), "utf8"),
    );
    assert.deepEqual(snapshot.game, game);
    assert.equal(snapshot.source, base);
    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.serverVersion, version);
    assert.equal(
      readFileSync(join(folder, "dictionary.txt"), "utf8"),
      store.dictionaryText(game.dictionaryId),
    );
    assert.deepEqual(store.state(), before);
    assert.equal(
      store.db.prepare("SELECT total_changes() AS n").get()!.n,
      changes,
    );
    await assert.rejects(
      runDebug(["game", "../oops", "--server", base]),
      /Usage/,
    );
    await assert.rejects(
      runDebug(["games", "--server", `${base}/api`]),
      /origin/,
    );
    await assert.rejects(
      runDebug(["games", "--server", "http://user:password@localhost"]),
      /origin/,
    );
    await assert.rejects(
      runDebug([
        "game",
        "00000000-0000-4000-8000-000000000000",
        "--server",
        base,
      ]),
      /HTTP 404/,
    );
    // A missing dictionary must fail clearly and leave no partial download.
    store.db
      .prepare("UPDATE games SET data=? WHERE id=?")
      .run(JSON.stringify({ ...game, dictionaryId: "missing" }), game.id);
    await assert.rejects(
      runDebug(["game", game.id, "--server", base], { root }),
      /HTTP 409/,
    );
    assert.equal(readdirSync(join(root, "data/debug")).length, 2);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    store.db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("debug tools refuse redirects, invalid exports and HTML without creating snapshots", async () => {
  const root = mkdtempSync(join(tmpdir(), "tilemaxx-debug-errors-"));
  const store = createStore(join(root, "server"), process.cwd());
  const game = store.state().games[0];
  let mode = "redirect";
  const methods: string[] = [];
  const server = createServer((req, res) => {
    methods.push(req.method!);
    if (req.url === "/redirect-target") {
      assert.fail("The client followed a redirect");
    }
    if (mode === "redirect") {
      res.writeHead(302, { Location: "/redirect-target" }).end();
    } else if (mode === "html") {
      res
        .writeHead(200, { "Content-Type": "text/html" })
        .end("<html>Old deployment</html>");
    } else {
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          schemaVersion: 1,
          serverVersion: "0.0.1",
          exportedAt: new Date().toISOString(),
          game,
          dictionary: {
            id: game.dictionaryId,
            name: "Test",
            text: "AA\n",
            sha256: "wrong",
          },
        }),
      );
    }
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    await assert.rejects(
      runDebug(["game", game.id, "--server", base], { root }),
      /fetch failed/,
    );
    mode = "html";
    await assert.rejects(
      runDebug(["game", game.id, "--server", base], { root }),
      /Expected JSON/,
    );
    mode = "checksum";
    await assert.rejects(
      runDebug(["game", game.id, "--server", base], { root }),
      /does not match/,
    );
    assert.deepEqual(methods, ["GET", "GET", "GET"]);
    assert.deepEqual(readdirSync(root), ["server"]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
