import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { version } from "../version.json";
import { createStore } from "../server/store";
import { createApp } from "../server/app";
import { archiveForReview } from "../shared/archive-history";
import { gameReplayTimeline } from "../shared/game-replay";
import { BoardEditHistory } from "../shared/board-entry";
import { archiveGame, emptyBoard, redo, remember, undo, type AppState, type Game } from "../shared/model";
import { correctTrackedMove, emptyScoring, gameScoreTotals, playTrackedMove, setScoreTracking } from "../shared/game-scoring";
import { Lexicon } from "../shared/lexicon";
import { solve } from "../shared/solver";
import { TILE_SYMBOLS } from "../shared/tile-pool";
import { type GameIndex, summarizeGame } from "../shared/game-index";
import { templateForLanguage, PRESETS } from "../shared/presets";
import { defaultDictionary } from "../shared/dictionaries";

test("a manual Grammalecte import is recognized and keeps its identity after restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "tilemaxx-grammalecte-"));
  let store = createStore(dir, process.cwd());
  try {
    const french = store.importDictionary("fr.d61940ba", "ete\nkiwi\n");
    assert.equal(french.name, "Grammalecte 7.7");
    assert.equal(french.builtin, false);
    assert.equal(french.count, 2);
    store.db.close();
    store = createStore(dir, process.cwd());
    assert.deepEqual(defaultDictionary(store.dictionaries(), undefined, "scrabble-fr"), french);
    assert.equal(defaultDictionary(store.dictionaries(), french.id)?.id, "wordnik");
    assert.equal(store.dictionaryText(french.id), "ETE\nKIWI\n");
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

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
    const indexResponse = await req("/state/index");
    assert.equal(indexResponse.headers.get("cache-control"), "no-store");
    assert.equal((await indexResponse.json()).version, version);
    const state: AppState = await (await req("/state")).json(),
      game = state.games[0];
    assert.deepEqual(state.templates, PRESETS);
    assert.equal(state.dictionaries.length, 2);
    assert.match(game.startedOn!, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(game.trackScores, true);
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
    const correctedPremiums = [...game.template.premiums];
    correctedPremiums[0] = "TL";
    const savedExample = await req("/screenshot-examples", "POST", {
      ...example,
      recognized: {
        ...example.recognized,
        premiums: {
          style: "scrabble-go",
          squares: game.template.premiums,
          fixed: game.template.premiums,
        },
      },
      correctedPremiums,
    });
    assert.equal(savedExample.status, 201);
    const { id: exampleId } = await savedExample.json();
    const exampleDir = join(dir, "screenshot-examples", exampleId);
    assert.deepEqual(readFileSync(join(exampleDir, "board.png")), croppedPng);
    assert.equal(
      JSON.parse(readFileSync(join(exampleDir, "labels.json"), "utf8"))
        .corrected[112],
      "c",
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(exampleDir, "labels.json"), "utf8"))
        .correctedPremiums,
      correctedPremiums,
    );
    assert.deepEqual(store.getGame(game.id), game);
    const profile = await (
      await req("/profiles", "POST", { name: "Phone player" })
    ).json();
    assert.equal(profile.name, "Phone player");
    const classic = PRESETS.find(({ id }) => id === "lexulous")!;
    const wordfeud = PRESETS.find(({ id }) => id === "wordfeud")!;
    for (const template of [
      ...PRESETS.slice(3),
      templateForLanguage(classic, "fr"),
      templateForLanguage(classic, "it"),
      templateForLanguage(wordfeud, "fr"),
    ]) {
      const created = await req("/games", "POST", {
        ...game,
        name: `${template.name} game`,
        profileId: state.profiles[0].id,
        trackScores: false,
        template,
        board: Array<string>(template.size ** 2).fill(""),
        rack: "ABCDEFGH".slice(0, template.rackSize),
      });
      assert.equal(created.status, 201);
      const saved: Game = await created.json();
      const reloaded: Game = await (await req(`/games/${saved.id}`)).json();
      assert.deepEqual(reloaded.template, template);
      assert.equal(reloaded.trackScores, false);
      assert.equal((await req(`/games/${saved.id}`, "DELETE", {})).status, 200);
    }
    const created: Game = await (
      await req("/games", "POST", {
        ...game,
        profileId: profile.id,
        name: "Phone game",
        trackScores: undefined,
      })
    ).json();
    assert.equal(created.trackScores, true);
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
      additionalBonuses: { 2: 10, 5: 30 },
      tileCounts: { ...template.tileCounts, Q: 3, "?": 0 },
    };
    const editedTemplate = await (
      await req(`/templates/${template.id}`, "PUT", templateChanges)
    ).json();
    assert.equal(editedTemplate.id, template.id);
    assert.equal(editedTemplate.name, "Edited custom");
    assert.equal(editedTemplate.size, 7);
    assert.deepEqual(editedTemplate.tileCounts, templateChanges.tileCounts);
    assert.deepEqual(
      editedTemplate.additionalBonuses,
      templateChanges.additionalBonuses,
    );
    for (const additionalBonuses of [
      { 0: 10 },
      { 7: 10 },
      { 3: -5 },
      { 5: 201 },
    ]) {
      const response = await req(`/templates/${template.id}`, "PUT", {
        ...templateChanges,
        additionalBonuses,
      });
      assert.equal(response.status, 400);
    }
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
    assert.equal(store.state().templates.length, PRESETS.length + 1);
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
    const customPremiums = [...created.template.premiums];
    customPremiums[0] = "DL";
    const withSlots = await req(`/games/${created.id}`, "PUT", {
      ...created,
      originalPremiums: created.template.premiums,
      template: { ...created.template, premiums: customPremiums },
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
    assert.deepEqual(store.getGame(created.id)!.originalPremiums, created.template.premiums);
    assert.deepEqual(store.getGame(created.id)!.template.premiums, customPremiums);
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
    assert.equal(store.state().templates.length, PRESETS.length + 1);
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

test("the store persists recovered refill evidence on both archival paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "tilewise-archive-recovery-test-"));
  const store = createStore(dir, process.cwd());
  try {
    const [initial] = store.state().games;
    const ready = { ...initial, rack: "CATEINS" };
    const move = solve(new Lexicon(["CAT"]), ready.board, ready.rack, ready.template)[0];
    const played = { ...playTrackedMove(ready, move), rack: "EINSAOU" };
    const first = store.saveGame(played)!;
    const archived = store.saveGame(archiveGame(first))!;
    const another = store.createGame(first);
    const result = store.archiveAndStartNewGame(another.id, another.revision, "2026-01-01");
    assert.equal(result.status, "created");
    if (result.status !== "created") return;
    for (const id of [archived.id, result.archived.id]) {
      const saved = store.getGame(id)!;
      assert.deepEqual(saved.archivedState?.past, []);
      assert.deepEqual(saved.archivedState?.trackedMoves, first.trackedMoves);
      assert.deepEqual(saved.archivedState?.replayRecovery?.[0]?.draw, { tiles: "AOU", count: 3 });
      assert.equal(gameReplayTimeline(saved).frames[1].afterRack, "AEINOSU");
    }
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("move server versions are authoritative and stay in live and archived API snapshots", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tilemaxx-move-versions-"));
  const store = createStore(dir, process.cwd());
  const server = createApp(store).listen(0, "127.0.0.1");
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  const [seed] = store.state().games;
  const initial = store.createGame({
    ...seed,
    rack: "CATEINS",
    trackedMoves: [
      { player: "you", word: "AS", score: 2, at: "2025-01-01T00:00:00.000Z" },
      { player: "opponent", word: "AT", score: 2, at: "2025-01-01T00:00:01.000Z", serverVersion: "0.3.51" },
    ],
  });
  const base = `http://127.0.0.1:${port}/api`;
  const put = (game: Game) => fetch(`${base}/games/${game.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(game),
  });
  const move = solve(new Lexicon(["CAT"]), initial.board, initial.rack, initial.template)[0];
  const draft = playTrackedMove(initial, move, 86);
  draft.trackedMoves!.at(-1)!.serverVersion = "9.9.9";
  draft.past.at(-1)!.serverVersion = "9.9.9";
  const savedResponse = await put(draft);
  assert.equal(savedResponse.status, 200);
  const saved: Game = await savedResponse.json();
  assert.deepEqual(saved.trackedMoves!.map((move) => move.serverVersion), [undefined, "0.3.51", version]);
  assert.equal(saved.past.at(-1)!.serverVersion, version);
  assert.equal((await put(draft)).status, 409);

  const undoSaved = store.saveGame(undo(saved))!;
  assert.equal(undoSaved.future.at(-1)?.serverVersion, version);
  const redone = store.saveGame(redo(undoSaved))!;
  assert.deepEqual(redone.trackedMoves, saved.trackedMoves);
  const corrected = store.saveGame(correctTrackedMove(redone, 1, { player: "you", word: "IT", score: 3 }, false))!;
  assert.equal(corrected.trackedMoves![1].serverVersion, "0.3.51");
  const archived = store.saveGame(archiveForReview(corrected))!;
  assert.equal(archived.archivedState!.trackedMoves!.at(-1)!.serverVersion, version);

  const live: Game = await (await fetch(`${base}/games/${archived.id}`)).json();
  const snapshot = await (await fetch(`${base}/debug/games/${archived.id}`)).json();
  assert.equal(snapshot.serverVersion, version);
  assert.deepEqual(snapshot.game, live);
  assert.deepEqual(live.trackedMoves!.map((move) => move.serverVersion), [undefined, "0.3.51", version]);
  assert.deepEqual(live.archivedState!.trackedMoves, live.trackedMoves);
});

test("version provenance follows a reconstructed score log and leaves old history unknown", () => {
  const dir = mkdtempSync(join(tmpdir(), "tilemaxx-recovered-move-versions-"));
  const store = createStore(dir, process.cwd());
  try {
    const [seed] = store.state().games;
    const ready = { ...seed, rack: "CATEINS", trackScores: false };
    const move = solve(new Lexicon(["CAT"]), ready.board, ready.rack, ready.template)[0];
    const untracked = playTrackedMove(ready, move, 86);
    const active = store.saveGame(untracked)!;
    const recovered = store.saveGame(setScoreTracking(active, true))!;
    assert.equal(recovered.trackedMoves?.[0]?.serverVersion, version);
    const old = store.createGame(untracked);
    const recoveredOld = store.saveGame(setScoreTracking(old, true))!;
    assert.equal(recoveredOld.trackedMoves?.[0]?.word, "CAT");
    assert.equal(recoveredOld.trackedMoves?.[0]?.serverVersion, undefined);
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("archive and start saves the original and creates one fresh game in one transaction", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tilewise-archive-test-"));
  const store = createStore(dir, process.cwd());
  const server = createApp(store).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  const [initial] = store.state().games;
  const layout = PRESETS.find(({ id }) => id === "wordfeud")!;
  const template = { ...layout, premiums: [...layout.premiums] };
  template.premiums[0] = "DW";
  const board = emptyBoard(template.size);
  board[template.start] = "A";
  const original = store.saveGame({
    ...initial,
    board,
    dictionaryId: "enable",
    name: "Sam",
    platform: "Wordfeud",
    startedOn: "2026-11-01",
    notes: "Notes for the first match",
    rack: "CTS",
    past: [
      {
        board: emptyBoard(template.size),
        rack: "",
        label: "Previous board",
        at: "2026-11-01T00:00:00.000Z",
      },
    ],
    excludedRackSlots: [0],
    requiredRackSlots: [1],
    template,
    originalPremiums: layout.premiums,
    trackScores: false,
    scoring: emptyScoring(),
    trackedMoves: [{ player: "you", word: "AT", score: 4, at: "2026-11-01" }],
  })!;
  const startedOn = "2026-11-15";
  const archiveAndStart = (revision: number, date = startedOn) =>
    fetch(
      `http://127.0.0.1:${port}/api/games/${original.id}/archive-and-start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision, startedOn: date }),
      },
    );
  try {
    assert.equal(
      (await archiveAndStart(original.revision, "not a date")).status,
      400,
    );
    const invalidMarks = await fetch(`http://127.0.0.1:${port}/api/games/${original.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...original, requiredRackSlots: [0] }),
    });
    assert.equal(invalidMarks.status, 400);
    const stale = await archiveAndStart(initial.revision);
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).game.revision, original.revision);

    store.db.exec(`CREATE TRIGGER fail_new_game BEFORE INSERT ON games
      BEGIN SELECT RAISE(ABORT, 'Failed to insert'); END`);
    assert.throws(
      () =>
        store.archiveAndStartNewGame(original.id, original.revision, startedOn),
      /Failed to insert/,
    );
    assert.deepEqual(store.getGame(original.id), original);
    assert.deepEqual(store.index().games, [summarizeGame(original)]);
    store.db.exec("DROP TRIGGER fail_new_game");

    const results = await Promise.all([
      archiveAndStart(original.revision),
      archiveAndStart(original.revision),
    ]);
    assert.deepEqual(results.map(({ status }) => status).sort(), [201, 409]);
    const { archived, created }: { archived: Game; created: Game } =
      await results.find(({ status }) => status === 201)!.json();
    assert.equal(archived.id, original.id);
    assert.equal(archived.startedOn, original.startedOn);
    assert.equal(archived.startedAt, original.startedAt);
    assert.equal(archived.notes, original.notes);
    assert.deepEqual(archived.board, original.board);
    assert.deepEqual(archived.archivedBoard, original.board);
    assert.deepEqual(archived.past, []);
    assert.deepEqual(archived.future, []);
    assert.deepEqual(archived.archivedState?.past, []);
    assert.deepEqual(archived.archivedState?.future, []);
    assert.deepEqual(
      archived.archivedState?.trackedMoves,
      original.trackedMoves,
    );
    assert.equal(archived.archivedState?.rack, original.rack);
    assert.deepEqual(archived.archivedState?.requiredRackSlots, [1]);
    assert.notEqual(created.id, original.id);
    assert.equal(created.profileId, original.profileId);
    assert.equal(created.name, original.name);
    assert.equal(created.platform, original.platform);
    assert.equal(created.startedOn, startedOn);
    assert.equal(created.startedAt, created.updatedAt);
    assert.equal(created.dictionaryId, original.dictionaryId);
    assert.equal(created.trackScores, false);
    assert.deepEqual(created.template, template);
    assert.deepEqual(created.originalPremiums, layout.premiums);
    assert.deepEqual(created.board, emptyBoard(template.size));
    assert.equal(created.rack, "");
    assert.equal(created.archived, false);
    assert.deepEqual(created.past, []);
    assert.deepEqual(created.future, []);
    for (const field of [
      "notes",
      "scoring",
      "trackedMoves",
      "excludedRackSlots",
      "requiredRackSlots",
      "archivedBoard",
      "archivedState",
    ] as const)
      assert.equal(created[field], undefined);
    assert.deepEqual(store.index().games, [
      summarizeGame(archived),
      summarizeGame(created),
    ]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("game order is saved per profile and survives restarting the server", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tilemaxx-game-order-"));
  let store = createStore(dir, process.cwd());
  const server = createApp(store).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const {
    profiles: [profile],
    games: [first],
  } = store.state();
  const second = store.createGame({ ...first, name: "Second" });
  const archived = store.createGame({ ...first, archived: true });
  const other = store.createProfile("Other");
  const foreign = store.createGame({ ...first, profileId: other.id });
  const save = (gameIds: string[]) =>
    fetch(`${base}/profiles/${profile.id}/game-order`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameIds }),
    });
  try {
    const order = [second.id, first.id];
    assert.equal((await save(order)).status, 200);
    assert.equal((await save([first.id, archived.id])).status, 409);
    assert.equal((await save([first.id, foreign.id])).status, 409);
    assert.equal((await save([first.id, first.id])).status, 409);
    assert.equal(store.getGame(first.id)?.revision, first.revision);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.db.close();
    store = createStore(dir, process.cwd());
    assert.deepEqual(
      store.state().profiles.find((p) => p.id === profile.id)?.gameOrder,
      order,
    );
    assert.equal(
      store.state().profiles.find((p) => p.id === other.id)?.gameOrder,
      undefined,
    );
  } finally {
    server.close();
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("upgrading SQLite recovers saved rack-outs once for active and archived games", () => {
  const dir = mkdtempSync(join(tmpdir(), "tilemaxx-game-end-"));
  let store = createStore(dir, process.cwd());
  try {
    const [seed] = store.state().games;
    const board = [...seed.board];
    board.splice(112, 3, "C", "A", "T");
    const template = {
      ...seed.template,
      tileCounts: Object.fromEntries(TILE_SYMBOLS.map((tile) => [tile, Number("ACQST".includes(tile))])),
    };
    const scoring = emptyScoring();
    scoring.you.points = 20;
    scoring.opponent.points = 10;
    const opening = { ...seed, board, rack: "S", template, scoring };
    const move = solve(new Lexicon(["CATS"]), board, opening.rack, template)
      .find((move) => move.tiles[0].index === 115)!;
    const finished = playTrackedMove(opening, move);
    const legacy = { ...finished, scoring: { ...finished.scoring!, end: undefined } };
    const active = store.saveGame(legacy)!;
    const archive = store.createGame(archiveGame({ ...legacy, name: "Archived finish" }));
    const pending = store.createGame({
      ...opening,
      board: finished.board,
      rack: "Q",
      scoring: { ...scoring, pendingBase: board },
      name: "Pending final opponent move",
    });
    const incomplete = store.createGame(archiveGame({ ...opening, name: "Unfinished archive" }));
    store.db.exec("PRAGMA user_version=1");
    store.db.close();

    store = createStore(dir, process.cwd());
    for (const game of [active, archive, pending]) {
      const updated = store.getGame(game.id)!;
      assert.equal(updated.revision, game.revision + 1);
      assert.equal(updated.updatedAt, game.updatedAt);
      assert.deepEqual(updated.scoring?.end, { out: game.id === pending.id ? "opponent" : "you", rackPoints: 10 });
      assert.equal(store.index().games.find(({ id }) => id === game.id)?.revision, updated.revision);
    }
    const archived = store.getGame(archive.id)!;
    assert.deepEqual(archived.archivedState?.scoring?.end, { out: "you", rackPoints: 10 });
    assert.deepEqual(gameScoreTotals(archived.scoring), { you: 36, opponent: 0 });
    store.db
      .prepare("UPDATE game_summaries SET data=json_remove(data, '$.score') WHERE id=?")
      .run(archive.id);
    const summary = store.index().games.find(({ id }) => id === archive.id);
    assert.equal(summary?.revision, archived.revision);
    assert.deepEqual(summary?.score, { you: 36, opponent: 0, outcome: "win" });
    assert.deepEqual(gameScoreTotals(store.getGame(pending.id)?.scoring), { you: 10, opponent: 26 });
    assert.deepEqual(
      store.getGame(incomplete.id),
      JSON.parse(JSON.stringify(incomplete)),
    );
    store.db.close();
    store = createStore(dir, process.cwd());
    assert.deepEqual(store.getGame(archive.id), archived);
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("upgrading the game index restores active scores from saved games", () => {
  const dir = mkdtempSync(join(tmpdir(), "tilemaxx-active-scores-"));
  let store = createStore(dir, process.cwd());
  try {
    const [game] = store.state().games;
    const scoring = emptyScoring();
    scoring.you.points = 218;
    scoring.opponent.points = 192;
    const saved = store.saveGame({ ...game, scoring })!;
    // A version 3 server cached a null score for every active game.
    store.db.prepare(
      "UPDATE game_summaries SET data=json_set(data, '$.score', NULL) WHERE id=?",
    ).run(saved.id);
    store.db.exec("PRAGMA user_version=3");
    store.db.close();

    store = createStore(dir, process.cwd());
    const [summary] = store.index().games;
    assert.deepEqual(summary.score, { you: 218, opponent: 192, outcome: "playing" });
    assert.equal(summary.revision, saved.revision);
    assert.deepEqual(store.getGame(saved.id), saved);
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("upgrading the game index refreshes the move history badge for saved empty games", () => {
  const dir = mkdtempSync(join(tmpdir(), "tilemaxx-empty-history-"));
  let store = createStore(dir, process.cwd());
  try {
    const [game] = store.state().games;
    store.db.prepare(
      `UPDATE game_summaries SET data=json_set(data, '$.fullMoveHistory', json('false')) WHERE id=?`,
    ).run(game.id);
    store.db.exec("PRAGMA user_version=4");
    store.db.close();

    store = createStore(dir, process.cwd());
    const [summary] = store.index().games;
    assert.equal(summary.fullMoveHistory, true);
    assert.equal(summary.revision, game.revision);
    assert.deepEqual(store.getGame(game.id), game);
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("upgrading the game index refreshes the badge for a saved opponent entry", () => {
  const dir = mkdtempSync(join(tmpdir(), "tilemaxx-pending-history-"));
  let store = createStore(dir, process.cwd());
  try {
    const [game] = store.state().games;
    const board = [...game.board];
    board[game.template.start] = "C";
    const saved = store.saveGame(new BoardEditHistory().apply(game, board, "enter"))!;
    const persisted = store.getGame(saved.id);
    store.db.prepare(
      `UPDATE game_summaries SET data=json_set(data, '$.fullMoveHistory', json('false')) WHERE id=?`,
    ).run(saved.id);
    store.db.exec("PRAGMA user_version=5");
    store.db.close();

    store = createStore(dir, process.cwd());
    const [summary] = store.index().games;
    assert.equal(summary.fullMoveHistory, true);
    assert.equal(summary.revision, saved.revision);
    assert.deepEqual(store.getGame(saved.id), persisted);
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("archived undo migration rolls back on error, preserves replay, and runs once", () => {
  const dir = mkdtempSync(join(tmpdir(), "tilemaxx-archive-history-"));
  let store: ReturnType<typeof createStore> | undefined = createStore(dir, process.cwd());
  try {
    const [initial] = store.state().games;
    const ready = { ...initial, rack: "CAT" };
    const play = solve(new Lexicon(["CAT"]), ready.board, ready.rack, ready.template)[0];
    const active = store.saveGame(playTrackedMove(ready, play))!;
    const [first, second, empty] = ["legacy-a", "legacy-b", "already-compact"].map(id =>
      store!.createGame({ ...active, archived: false }, id),
    );
    const withCorrection = (game: Game) => {
      const history = remember(game, "Confirmed board correction");
      history.past[history.past.length - 1].at = "9999-12-31T00:00:00.000Z";
      return { ...game, ...history };
    };
    const legacy = archiveGame(withCorrection(first));
    const legacyWithoutSnapshot = { ...withCorrection(second), archived: true };
    const alreadyCompact = archiveForReview(empty);
    const write = store.db.prepare("UPDATE games SET data=? WHERE id=?");
    for (const game of [legacy, legacyWithoutSnapshot, alreadyCompact]) {
      write.run(JSON.stringify(game), game.id);
    }
    const gameRows = "SELECT data FROM games ORDER BY rowid";
    const summaryRows = "SELECT data FROM game_summaries ORDER BY rowid";
    const before = store.db.prepare(gameRows).all();
    const beforeSummaries = store.db.prepare(summaryRows).all();
    store.db.exec(`PRAGMA user_version=6;
      CREATE TRIGGER interrupt_archive_migration BEFORE UPDATE ON games
      WHEN OLD.id = 'legacy-b'
      BEGIN SELECT RAISE(ABORT, 'Interrupted archive migration'); END;`);
    store.db.close();
    store = undefined;

    assert.throws(() => createStore(dir, process.cwd()), /Interrupted archive migration/);
    const audit = new DatabaseSync(join(dir, "tilewise.sqlite"));
    try {
      assert.equal(audit.prepare("PRAGMA user_version").get()?.user_version, 6);
      assert.deepEqual(audit.prepare(gameRows).all(), before);
      assert.deepEqual(audit.prepare(summaryRows).all(), beforeSummaries);
      audit.exec("DROP TRIGGER interrupt_archive_migration");
    } finally {
      audit.close();
    }

    store = createStore(dir, process.cwd());
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, 8);
    const persisted = (game: Game) => JSON.parse(JSON.stringify(game));
    assert.deepEqual(store.getGame(active.id), persisted(active));
    assert.deepEqual(store.getGame(alreadyCompact.id), persisted(alreadyCompact));
    for (const original of [legacy, legacyWithoutSnapshot]) {
      const archived: Game = store.getGame(original.id)!;
      assert.equal(archived.revision, original.revision + 1);
      assert.equal(archived.updatedAt, original.updatedAt);
      assert.deepEqual(archived.past, []);
      assert.deepEqual(archived.future, []);
      assert.deepEqual(archived.archivedState?.past, original.archivedState && []);
      assert.deepEqual(gameReplayTimeline(archived), gameReplayTimeline(persisted(original)));
      assert.deepEqual(store.index().games.find(({ id }) => id === archived.id),
        JSON.parse(JSON.stringify(summarizeGame(archived))));
    }
    assert.equal(store.getGame(legacy.id)?.archivedState?.replayRecovery?.[0]?.correctionAfter, true);
    assert.equal(store.getGame(legacyWithoutSnapshot.id)?.replayRecovery?.[0]?.correctionAfter, true);
    const saved = store.db.prepare(gameRows).all();
    store.db.close();
    store = undefined;
    store = createStore(dir, process.cwd());
    assert.deepEqual(store.db.prepare(gameRows).all(), saved);
  } finally {
    store?.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("archive saves trim old history and keep undo for edits made after archiving", () => {
  const dir = mkdtempSync(join(tmpdir(), "tilemaxx-archive-edit-"));
  const store = createStore(dir, process.cwd());
  try {
    const [initial] = store.state().games;
    const active = store.saveGame({ ...initial, ...remember(initial, "Edited rack"), rack: "CAT" })!;
    const localArchive = archiveForReview(active);
    const offline = { ...localArchive, ...remember(localArchive, "Edited rack"), rack: "DOG" };
    const saved = store.saveGame(offline)!;
    assert.equal(saved.past.length, 1);
    assert.equal(saved.past[0].rack, "CAT");
    assert.deepEqual(saved.archivedState?.past, []);
    const later = store.saveGame({ ...saved, ...remember(saved, "Edited rack"), rack: "TAR" })!;
    assert.equal(later.past.length, 2);
    assert.equal(later.archivedState?.rack, "CAT");
    const stale = store.saveGame(archiveGame(active));
    assert.equal(stale, undefined);
    const reopened = store.saveGame({ ...later, archived: false, archivedBoard: undefined, archivedState: undefined })!;
    assert.equal(reopened.past.length, 2);
    const archivedAgain = store.saveGame(archiveGame(reopened))!;
    assert.deepEqual(archivedAgain.past, []);
    assert.deepEqual(archivedAgain.archivedState?.past, []);
    const cloned = store.createGame(archiveGame(active));
    assert.deepEqual(cloned.past, []);
    assert.deepEqual(cloned.archivedState?.past, []);
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the game index backfills old SQLite saves and leaves full history on the detail API", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tilemaxx-index-test-"));
  const database = new DatabaseSync(join(dir, "tilewise.sqlite"));
  database.exec(`
    CREATE TABLE profiles (id TEXT PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE games (id TEXT PRIMARY KEY,revision INTEGER NOT NULL,data TEXT NOT NULL);
    INSERT INTO profiles VALUES ('p','Player');
    PRAGMA user_version=1;
  `);
  const template = PRESETS[0];
  const game: Game = {
    id: "old",
    profileId: "p",
    name: "Old game",
    template,
    dictionaryId: "wordnik",
    board: Array.from({ length: 225 }, (_, i) => (i === 112 ? "A" : "")),
    rack: "DOG",
    revision: 2,
    updatedAt: "",
    archived: false,
    past: [{ board: Array(225).fill(""), rack: "", at: "", label: "Old edit" }],
    future: [],
  };
  database
    .prepare("INSERT INTO games VALUES (?,?,?)")
    .run(game.id, game.revision, JSON.stringify(game));
  database.close();

  const store = createStore(dir, process.cwd());
  const server = createApp(store).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const getIndex = async () =>
    (await (await fetch(base + "/state/index")).json()) as GameIndex;
  try {
    const index = await getIndex();
    assert.deepEqual(index.games, [summarizeGame(game)]);
    assert.equal(index.games[0].thumbnail.squares[112], "7");
    store.db
      .prepare(
        "UPDATE game_summaries SET data=json_remove(data, '$.fullMoveHistory') WHERE id=?",
      )
      .run(game.id);
    assert.equal((await getIndex()).games[0].fullMoveHistory, false);
    store.db.prepare(
      "UPDATE game_summaries SET data=json_remove(data, '$.dictionaryId') WHERE id=?",
    ).run(game.id);
    const restored = (await getIndex()).games[0];
    assert.equal(restored.dictionaryId, game.dictionaryId);
    assert.equal(restored.revision, game.revision);
    assert.equal(
      (await (await fetch(base + "/games/old")).json()).past.length,
      1,
    );
    assert.equal(
      (await (await fetch(base + "/state")).json()).games[0].rack,
      "DOG",
    );

    const next = { ...game, name: "Edited", revision: 3 };
    store.db
      .prepare("UPDATE games SET revision=?,data=? WHERE id=?")
      .run(next.revision, JSON.stringify(next), next.id);
    assert.deepEqual((await getIndex()).games, [summarizeGame(next)]);
    const saved = store.saveGame({ ...next, name: "Saved" })!;
    assert.equal(saved.revision, 4);
    assert.equal((await getIndex()).games[0].name, "Saved");
    assert.equal((await getIndex()).games[0].endedOn, undefined);
    const lastMoveAt = "2026-11-16T14:00:00.000Z";
    const archiveWithDate = (endedOn: string, endedAt?: string) =>
      archiveGame({
        ...saved,
        scoring: {
          ...emptyScoring(),
          end: { manual: true, endedOn, endedAt, scores: { you: 420, opponent: 360 } },
        },
        trackedMoves: [{ player: "you", word: "AT", score: 4, at: lastMoveAt }],
      });
    const saveArchive = (endedOn: string, endedAt?: string) =>
      fetch(base + "/games/old", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(archiveWithDate(endedOn, endedAt)),
      });
    assert.equal((await saveArchive("2026-11-31")).status, 400);
    const endedOn = "2026-11-16";
    assert.equal((await saveArchive(endedOn, endedOn)).status, 400);
    assert.equal((await saveArchive(endedOn)).status, 200);
    const archived: Game = await (await fetch(base + "/games/old")).json();
    assert.equal(archived.archivedState?.scoring?.end?.endedOn, endedOn);
    store.db.prepare(
      "UPDATE game_summaries SET data=json_remove(data, '$.archiveSortTime') WHERE id=?",
    ).run(game.id);
    const archiveSummary = (await getIndex()).games[0];
    assert.equal(archiveSummary.endedOn, endedOn);
    assert.equal(archiveSummary.endedAt, null);
    assert.equal(archiveSummary.archiveSortTime, Date.parse(lastMoveAt));
    assert.equal((await getIndex()).games[0].revision, archived.revision);
    assert.equal(archiveSummary.language, "en");
    assert.deepEqual(archiveSummary.archiveStats, {
      finalScore: 420, margin: 60, outcome: "win",
    });
    store.db.prepare(
      "UPDATE game_summaries SET data=json_remove(data, '$.language', '$.archiveStats') WHERE id=?",
    ).run(game.id);
    assert.deepEqual((await getIndex()).games[0], archiveSummary);
    const endedAt = "2026-11-16T15:10:00.000Z";
    const finished = store.saveGame({ ...archiveWithDate(endedOn, endedAt), revision: archived.revision })!;
    store.db.prepare(
      "UPDATE game_summaries SET data=json_remove(data, '$.endedAt') WHERE id=?",
    ).run(game.id);
    const rebuilt = (await getIndex()).games[0];
    assert.equal(rebuilt.endedAt, endedAt);
    assert.equal(rebuilt.archiveSortTime, Date.parse(endedAt));
    assert.equal(rebuilt.revision, finished.revision);
    store.deleteGame(next.id);
    assert.deepEqual((await getIndex()).games, []);
    assert.equal((await fetch(base + "/games/old")).status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("game creation assigns a server ID, recognizes retries, and preserves legacy IDs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tilemaxx-create-"));
  const store = createStore(dir, process.cwd());
  const server = createApp(store).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const post = (body: unknown) =>
    fetch(`${base}/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const source = store.state().games[0];
    const id = "abcdef0123456789abcdef0123456789";
    const created = await post({
      ...source,
      creationId: id,
      name: "Offline",
      revision: -1,
    });
    assert.equal(created.status, 201);
    const game = (await created.json()) as Game;
    assert.equal(game.id, id);
    assert.equal(game.revision, 0);
    assert.equal(game.startedAt, source.startedAt);
    const creationToken = "123456789abcdef0123456789abcdef0";
    const onlineInput = { ...source, startedAt: undefined, name: "Online", creationToken };
    const online = await post(onlineInput);
    assert.equal(online.status, 201);
    const assigned: Game = await online.json();
    assert.match(assigned.id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.notEqual(assigned.id, source.id);
    assert.equal(assigned.startedAt, assigned.updatedAt);
    assert(Number.isFinite(Date.parse(assigned.startedAt!)));
    const updated = await fetch(`${base}/games/${assigned.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...assigned, rack: "DOG" }),
    });
    assert.equal(updated.status, 200);
    const edited: Game = await updated.json();
    assert.equal(edited.startedAt, assigned.startedAt);
    assert.deepEqual(await (await post(onlineInput)).json(), edited);
    assert.equal(store.state().games.filter((g) => g.name === "Online").length, 1);
    const order = [id, assigned.id, source.id];
    const reordered = await fetch(`${base}/profiles/${source.profileId}/game-order`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameIds: order }),
    });
    assert.equal(reordered.status, 200);
    assert.deepEqual((await reordered.json()).gameOrder, order);
    store.deleteGame(assigned.id);
    assert.equal((await post({ ...source, creationToken })).status, 410);
    const duplicate = await post({ ...source, creationId: id, rack: "DOG" });
    assert.equal(duplicate.status, 409);
    assert.deepEqual((await duplicate.json()).game, game);
    assert.equal(store.state().games.filter((g) => g.id === id).length, 1);
    const changed = store.saveGame({ ...game, rack: "CAT" })!;
    const retry = await post({ ...source, creationId: id });
    assert.equal((await retry.json()).game.revision, changed.revision);
    assert.equal(store.getGame(id)?.rack, "CAT");
    store.deleteGame(id);
    assert.equal((await post({ ...source, creationId: id })).status, 410);
    assert.equal(store.getGame(id), undefined);
    const cancelledId = "0123456789abcdef0123456789abcdef";
    store.deleteGame(cancelledId);
    assert.equal(
      (await post({ ...source, creationId: cancelledId })).status,
      410,
    );

    assert.equal(
      (await post({ ...source, creationId: "invalid" })).status,
      400,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
