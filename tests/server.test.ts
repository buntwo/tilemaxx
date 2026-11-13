import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
    assert.match(game.startedOn!, /^\d{4}-\d{2}-\d{2}$/);
    const croppedPng = readFileSync("tests/fixtures/board.png");
    const corrected = [...game.board];
    corrected[112] = "c";
    const example = {
      size: 15,
      crop: { left: 0, top: 0, width: 750, height: 750 },
      sourceWidth: 750,
      sourceHeight: 750,
      recognized: { board: game.board, uncertain: [112], candidates: 1 },
      corrected,
      croppedPng: croppedPng.toString("base64"),
    };
    assert.equal(
      (await req("/screenshot-examples", "POST", { ...example, corrected: [] }))
        .status,
      400,
    );
    const savedExample = await req("/screenshot-examples", "POST", example);
    assert.equal(savedExample.status, 201);
    const { id: exampleId } = await savedExample.json();
    const exampleDir = join(dir, "screenshot-examples", exampleId);
    assert.deepEqual(readFileSync(join(exampleDir, "board.png")), croppedPng);
    assert.equal(
      JSON.parse(readFileSync(join(exampleDir, "labels.json"), "utf8"))
        .corrected[112],
      "c",
    );
    assert.deepEqual(store.getGame(game.id), game);
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
    const renamed = await (
      await req(`/profiles/${profile.id}`, "PUT", { name: "Renamed player" })
    ).json();
    assert.deepEqual(renamed, { id: profile.id, name: "Renamed player" });
    assert.equal(store.getGame(created.id)!.profileId, profile.id);
    assert.equal(
      (await req(`/profiles/${profile.id}`, "PUT", { name: "   " })).status,
      400,
    );
    assert.equal(
      (await req("/profiles/missing", "PUT", { name: "Missing" })).status,
      404,
    );
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
    const customGame = await (
      await req("/games", "POST", {
        ...game,
        template,
        board: Array(25).fill(""),
        name: "Keep original layout",
      })
    ).json();
    const templateChanges = {
      ...template,
      name: "Edited custom",
      size: 7,
      start: 24,
      premiums: Array(49).fill("DL"),
      bingo: 40,
      tileCounts: { ...template.tileCounts, Q: 3, "?": 0 },
    };
    const editedTemplate = await (
      await req(`/templates/${template.id}`, "PUT", templateChanges)
    ).json();
    assert.equal(editedTemplate.id, template.id);
    assert.equal(editedTemplate.name, "Edited custom");
    assert.equal(editedTemplate.size, 7);
    assert.deepEqual(editedTemplate.tileCounts, templateChanges.tileCounts);
    for (const tileCounts of [
      { A: 1 },
      { ...templateChanges.tileCounts, A: -1 },
    ]) {
      assert.equal(
        (
          await req(`/templates/${template.id}`, "PUT", {
            ...templateChanges,
            tileCounts,
          })
        ).status,
        400,
      );
    }
    assert.deepEqual(store.getGame(customGame.id)!.template, template);
    assert.equal(store.state().templates.length, 4);
    assert.equal(
      (
        await req(`/templates/${template.id}`, "PUT", {
          ...templateChanges,
          id: "wrong-id",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await req("/templates/missing", "PUT", {
          ...templateChanges,
          id: "missing",
        })
      ).status,
      404,
    );
    for (const preset of state.templates) {
      assert.equal(
        (
          await req(`/templates/${preset.id}`, "PUT", {
            ...preset,
            builtin: false,
            name: "Changed preset",
          })
        ).status,
        403,
      );
      assert.deepEqual(
        store.state().templates.find((t) => t.id === preset.id),
        preset,
      );
    }
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
    const withSlots = await req(`/games/${created.id}`, "PUT", {
      ...created,
      startedOn: "2026-03-15",
      platform: "Words With Friends",
      notes: "Close game.\nReview the endgame.",
      archived: true,
      archivedBoard: created.board,
      archivedState: { rack: "DOG", past: [], future: [] },
      trackScores: true,
      trackedMoves: [
        { player: "you", word: "CAT", score: 10, at: new Date().toISOString() },
      ],
      scoring: {
        you: { points: 10, moves: 1, best: 10, bingos: 0 },
        opponent: { points: 0, moves: 0, best: 0, bingos: 0 },
      },
      rack: ".A.T.?",
      past: [
        {
          board: created.board,
          rack: "C..T",
          label: "Before deletion",
          at: new Date().toISOString(),
          player: "you",
        },
      ],
    });
    assert.equal(withSlots.status, 200);
    assert.equal((await withSlots.json()).rack, ".A.T.?");
    const anotherDevice: AppState = await (await req("/state")).json();
    assert.equal(
      anotherDevice.games.find((g) => g.id === created.id)!.rack,
      ".A.T.?",
    );
    await new Promise<void>((r) => server.close(() => r()));
    store.db.close();
    store = createStore(dir, process.cwd());
    assert.equal(store.getGame(game.id)!.rack, "CAT");
    assert.equal(store.state().profiles.length, 2);
    assert.equal(
      store.state().profiles.find((p) => p.id === profile.id)!.name,
      "Renamed player",
    );
    assert.equal(store.getGame(created.id)!.profileId, profile.id);
    assert.equal(store.getGame(created.id)!.rack, ".A.T.?");
    assert.equal(store.getGame(created.id)!.past[0].rack, "C..T");
    assert.equal(store.getGame(created.id)!.past[0].player, "you");
    assert.equal(store.getGame(created.id)!.startedOn, "2026-03-15");
    assert.equal(store.getGame(created.id)!.platform, "Words With Friends");
    assert.equal(
      store.getGame(created.id)!.notes,
      "Close game.\nReview the endgame.",
    );
    assert.deepEqual(store.getGame(created.id)!.archivedBoard, created.board);
    assert.equal(store.getGame(created.id)!.archivedState?.rack, "DOG");
    assert.equal(store.getGame(created.id)!.scoring?.you.points, 10);
    assert.equal(store.getGame(created.id)!.trackedMoves?.[0].word, "CAT");
    assert.equal(store.state().templates.length, 4);
    assert.deepEqual(
      store.state().templates.find((t) => t.id === template.id),
      editedTemplate,
    );
    assert.deepEqual(store.getGame(customGame.id)!.template, template);
    assert.equal(store.dictionaries().length, 3);
  } finally {
    server.close();
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
