import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { version } from "../version.json";
import { createApp } from "../server/app";
import { createStore } from "../server/store";
import { emptyBoard, type BoardTemplate, type Game } from "../shared/model";
import { emptyScoring } from "../shared/game-scoring";
import { parseWords } from "../shared/lexicon";
import { PRESETS } from "../shared/presets";
import { TILE_SYMBOLS } from "../shared/tile-pool";
import {
  decodeProfileVocabulary, learnerWordProbability,
  profileDictionaryRevision, profileVocabularyUrl,
} from "../shared/profile-vocabulary";

const credentials = {
  token: "a".repeat(64),
  browserPassword: "b".repeat(64),
};

async function fixture(
  t: TestContext,
  secured = true,
  browserPassword = credentials.browserPassword,
) {
  const dir = mkdtempSync(join(tmpdir(), "tilemaxx-api-"));
  const store = createStore(dir, process.cwd());
  const app = createApp(store, {
    credentials: secured ? { ...credentials, browserPassword } : undefined,
  });
  app.get("/", (_req, res) =>
    res.send("<!doctype html><title>Tilemaxx</title>"),
  );
  const server = app.listen(0, "127.0.0.1");
  t.after(async () => {
    try {
      if (server.listening)
        await new Promise<void>((done) => server.close(() => done()));
    } finally {
      store.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const bearer = `Bearer ${credentials.token}`;
  const basic = `Basic ${Buffer.from(`tilemaxx:${browserPassword}`).toString("base64")}`;
  const auth = { bearer, basic };
  const endpoint = (
    path: string,
    body?: unknown,
    options?: { method?: string; authorization?: string; origin?: string },
  ) =>
    fetch(url + "/api/v1" + path, {
      method: options?.method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        "Content-Type": "application/json",
        Authorization: options?.authorization ?? bearer,
        ...(options?.origin && { Origin: options.origin }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { url, endpoint, auth, store };
}

test("programmatic access is disabled until configured", async (t) => {
  const { url, endpoint } = await fixture(t, false);
  assert.equal((await endpoint("/state/index")).status, 404);
  assert.equal((await fetch(url + "/api/state/index")).status, 200);
});

test("the API records passes and exchanges and undoes them with the original rack", async (t) => {
  const { endpoint, store } = await fixture(t);
  const profile = store.createProfile("Turn recording test");
  const created = await endpoint("/games/new", {
    profileId: profile.id,
    templateId: "scrabble",
    name: "Turn recording test",
  });
  assert.equal(created.status, 201);
  const game: Game = await created.json();
  const path = `/games/${game.id}/actions`;
  const request = (position: Game, command: object) =>
    endpoint(path, { revision: position.revision, command });
  async function apply(position: Game, command: object): Promise<Game> {
    const response = await request(position, command);
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  }

  const rack = await apply(game, {
    action: "rack",
    rack: "J.I?ARC",
    excludedRackSlots: [5],
    requiredRackSlots: [3],
  });
  const pass = { action: "record-pass", player: "opponent" };
  const passed = await apply(rack, pass);
  assert.equal(passed.trackedMoves?.at(-1)?.serverVersion, version);
  assert.deepEqual(passed.trackedMoves?.map(({ player, action, score }) =>
    ({ player, action, score })), [{ player: "opponent", action: { kind: "pass" }, score: 0 }]);
  assert.equal(passed.rack, rack.rack);
  const retry = await request(rack, pass);
  assert.equal(retry.status, 409);
  assert.equal((await retry.json()).game.revision, passed.revision);
  assert.equal((await request(passed, pass)).status, 422);

  const ownExchange = { action: "record-exchange", player: "you" };
  assert.equal((await request(passed, ownExchange)).status, 400);
  assert.equal((await request(passed, { ...ownExchange, slots: [1] })).status, 422);
  assert.equal((await request(passed, { ...ownExchange, slots: [0, 0] })).status, 422);
  const exchanged = await apply(passed, { ...ownExchange, slots: [0, 3] });
  assert.equal(exchanged.trackedMoves?.at(-1)?.serverVersion, version);
  assert.deepEqual(exchanged.trackedMoves?.at(-1)?.action, { kind: "exchange", slots: [0, 3] });
  assert.equal(exchanged.rack, "IARC");
  assert.deepEqual(exchanged.excludedRackSlots, [2]);
  assert.equal(exchanged.requiredRackSlots, undefined);

  const filled = await apply(exchanged, { action: "rack", rack: "IARCTO", excludedRackSlots: [2] });
  const opponentExchange = { action: "record-exchange", player: "opponent" };
  assert.equal((await request(filled, { ...opponentExchange, slots: [0] })).status, 400);
  assert.equal((await request(filled, { ...opponentExchange, count: 8 })).status, 422);
  const opponent = await apply(filled, { ...opponentExchange, count: 2 });
  assert.deepEqual(opponent.trackedMoves?.at(-1)?.action, { kind: "exchange", count: 2 });
  assert.equal(opponent.rack, filled.rack);
  const undoOpponent = await apply(opponent, { action: "undo" });
  assert.deepEqual(undoOpponent.trackedMoves, filled.trackedMoves);
  assert.equal(undoOpponent.rack, filled.rack);
  const unknown = await apply(undoOpponent, opponentExchange);
  assert.deepEqual(unknown.trackedMoves?.at(-1)?.action, { kind: "exchange" });
  const undoUnknown = await apply(unknown, { action: "undo" });
  const undoOwn = await apply(undoUnknown, { action: "undo" });
  assert.deepEqual(undoOwn.trackedMoves, passed.trackedMoves);
  assert.equal(undoOwn.rack, rack.rack);
  assert.deepEqual(undoOwn.excludedRackSlots, rack.excludedRackSlots);
  assert.deepEqual(undoOwn.requiredRackSlots, rack.requiredRackSlots);
  const undoPass = await apply(undoOwn, { action: "undo" });
  assert.equal(undoPass.trackedMoves?.length, 0);
  assert.deepEqual(undoPass.board, game.board);

  const schemas = await (await endpoint("/schema")).json();
  const actionSchema = JSON.stringify(schemas["POST /games/:id/actions"]);
  assert.match(actionSchema, /"record-pass"/);
  assert.match(actionSchema, /"record-exchange"/);
});

test("packed vocabulary is compressed, checks dictionary content, and revalidates study rules", async (t) => {
  const { url, auth, store } = await fixture(t);
  const listing = "TUI\nEWW\nABASE\nQIS\n";
  const list = store.importDictionary("CSW24", listing);
  const words = parseWords(listing);
  const revision = profileDictionaryRevision(words);
  const path = profileVocabularyUrl(list.id, revision);
  const load = (etag?: string) => fetch(url + path, {
    headers: { Authorization: auth.basic, ...(etag && { "If-None-Match": etag }) },
  });
  const original = await load();
  assert.equal(original.status, 200);
  assert.equal(original.headers.get("content-encoding"), "gzip");
  const firstTag = original.headers.get("etag")!;
  assert.ok(firstTag);
  const originalScores = decodeProfileVocabulary(new Uint8Array(await original.arrayBuffer()), words);
  assert.equal(learnerWordProbability("EWW", originalScores.get("EWW")), 1);
  assert.equal(learnerWordProbability("QIS", originalScores.get("QIS")), 1);
  assert.ok(learnerWordProbability("TUI", originalScores.get("TUI")) < 0.01);
  assert.equal((await load(firstTag)).status, 304);

  store.importDictionary("WOW24", "TUI\n");
  const refreshed = await load(firstTag);
  assert.equal(refreshed.status, 200);
  const secondTag = refreshed.headers.get("etag")!;
  assert.notEqual(secondTag, firstTag);
  const updated = decodeProfileVocabulary(new Uint8Array(await refreshed.arrayBuffer()), words);
  assert.ok(learnerWordProbability("TUI", updated.get("TUI")) > 0.5);
  assert.equal((await load(secondTag)).status, 304);
  const mismatch = await fetch(url + profileVocabularyUrl(list.id, profileDictionaryRevision(["CAT", "DOG"])), {
    headers: { Authorization: auth.basic },
  });
  assert.equal(mismatch.status, 409);
});

test("server-side Casual shares short favorites without inheriting Learner's study vocabulary", async (t) => {
  const { store, endpoint } = await fixture(t);
  const profile = store.createProfile("Vocabulary test");
  const list = store.importDictionary("WOW24", "AT\nQAT\nTUI\nZA\n");
  const created = await endpoint("/games/new", {
    profileId: profile.id,
    templateId: "scrabble",
    dictionaryId: list.id,
    name: "Vocabulary test",
    solo: true,
  });
  const game: Game = await created.json();
  assert.equal(created.status, 201, JSON.stringify(game));
  const updated = await endpoint(`/games/${game.id}/actions`, {
    revision: game.revision,
    command: { action: "rack", rack: "QATUIZ" },
  });
  assert.equal(updated.status, 200);
  const edited: Game = await updated.json();
  async function words(style: "casual" | "learner") {
    const result = await endpoint("/analysis", {
      position: { gameId: edited.id, revision: edited.revision },
      operation: { kind: "moves", style, seed: 1 },
    });
    const payload = await result.json();
    assert.equal(result.status, 200, JSON.stringify(payload));
    return new Set<string>(payload.rows.map((row: { word: string }) => row.word));
  }
  assert.deepEqual(await words("casual"), new Set(["AT", "QAT", "ZA"]));
  assert.deepEqual(await words("learner"), new Set(["AT", "QAT", "TUI", "ZA"]));
});

test("empty-bag Learner rankings use the saved score or an explicit score spread", async (t) => {
  const { store, endpoint } = await fixture(t);
  const list = store.importDictionary("WOW24", "AN\nAX\nOX\nTAN\nTO\nVA\n");
  const [game] = store.state().games;
  const template: BoardTemplate = {
    ...PRESETS[0], size: 5, start: 12, rackSize: 3, premiums: Array(25).fill(""),
    tileCounts: Object.fromEntries(TILE_SYMBOLS.map((letter) => [letter, Number("ANOQTVX".includes(letter))])),
  };
  template.premiums[7] = "TW";
  template.premiums[11] = "TL";
  const board = emptyBoard(5);
  board[8] = "O";
  board[12] = "A";
  board[17] = "N";
  const scoring = emptyScoring();
  scoring.you.points = 22;
  const rack = "VTQ";
  const saved = store.saveGame({ ...game, template, board, rack, scoring, dictionaryId: list.id });
  assert(saved);
  async function best(position: object, scoreSpread?: number) {
    const response = await endpoint("/analysis", {
      position,
      operation: { kind: "moves", style: "learner", sort: "playing-style", bagSize: 0, scoreSpread },
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result.rows[0]?.word;
  }
  assert.equal(await best({ gameId: saved.id }), "VA");
  assert.equal(await best({ gameId: saved.id }, 60), "TO");
  assert.equal(await best({ template, board, rack, dictionaryId: list.id }, 22), "VA");
});

test("move rankings and exchange advice use each style's known options", async (t) => {
  const { store, endpoint } = await fixture(t);
  const list = store.importDictionary(
    "WOW24",
    "OU FA GO HE IF NO OR OX PA RE TO UH US WE AX ON IS YE HA HI LO AL AG MA PI PE NU SI QI"
      .replaceAll(" ", "\n"),
  );
  const position = {
    dictionaryId: list.id,
    template: PRESETS[0],
    board: emptyBoard(PRESETS[0].size),
    rack: "EIOOOUU",
  };
  async function analyze(style: "casual" | "learner", kind: string, move?: string) {
    const result = await endpoint("/analysis", {
      position,
      operation: { kind, style, seed: 0, ...(move && { move }) },
    });
    const payload = await result.json();
    assert.equal(result.status, 200, JSON.stringify(payload));
    return payload;
  }
  const learner = await analyze("learner", "moves");
  assert.equal(learner.styleChoice.word, "OU");
  assert.ok(learner.exchangeAdvice.edge > 2);
  assert.deepEqual((await analyze("learner", "exchange-advice")).advice, learner.exchangeAdvice);
  assert.deepEqual(
    (await analyze("learner", "exchange-advice", learner.styleChoice.id)).advice,
    learner.exchangeAdvice,
  );

  const casual = await analyze("casual", "moves");
  assert.equal(casual.styleChoice, undefined);
  assert.equal(casual.exchangeAdvice.profile, "casual");
  assert.equal(casual.exchangeAdvice.comparedWith, undefined);
  assert.deepEqual((await analyze("casual", "exchange-advice")).advice, casual.exchangeAdvice);
});

test("bearer and browser credentials protect both API surfaces", async (t) => {
  const { url, endpoint, auth, store } = await fixture(t);
  assert.throws(
    () =>
      createApp(store, {
        credentials: { ...credentials, browserPassword: "" },
      }),
    /distinct/,
  );
  for (const path of [
    "/",
    "/api/state",
    "/api/debug/games",
    "/api/dictionaries/wordnik",
  ]) {
    const response = await fetch(url + path);
    assert.equal(response.status, 401, path);
    assert.match(response.headers.get("www-authenticate") ?? "", /^Basic /);
    assert.equal(
      (await fetch(url + path, { headers: { Authorization: auth.basic } }))
        .status,
      200,
    );
  }
  assert.equal((await fetch(url + "/api/health")).status, 200);
  assert.equal(
    (
      await fetch(url + "/api/state", {
        headers: { Authorization: auth.bearer },
      })
    ).status,
    401,
  );
  for (const authorization of ["", "Bearer wrong", auth.basic]) {
    const response = await endpoint("/state/index", undefined, {
      authorization,
    });
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate") ?? "", /^Bearer /);
  }
  const valid = await endpoint("/state/index");
  assert.equal(valid.status, 200);
  assert.equal(valid.headers.get("cache-control"), "no-store");
  const schema = await endpoint("/schema");
  assert.equal(schema.status, 200);
  assert((await schema.json())["POST /games/:id/actions"]);
  assert.equal(
    (
      await endpoint(
        "/profiles",
        { name: "Cross origin" },
        { origin: "https://elsewhere.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(url + "/api/v1/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      })
    ).status,
    401,
  );
});

test("a browser session persists without Basic credentials and has a fixed lifetime", async (t) => {
  const { url, auth } = await fixture(t);
  const restarted = await fixture(t);
  const rotated = await fixture(t, true, "c".repeat(64));
  const now = Date.now();
  const lifetime = 30 * 24 * 60 * 60 * 1000;
  t.mock.timers.enable({ apis: ["Date"], now });

  const login = await fetch(url, { headers: { Authorization: auth.basic } });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get("set-cookie");
  assert(setCookie);
  assert.match(setCookie, /^__Host-tilemaxx-session=/);
  assert.match(setCookie, /; Max-Age=2592000\b/);
  assert.match(setCookie, /; Path=\/;/);
  assert.match(setCookie, /; HttpOnly\b/);
  assert.match(setCookie, /; Secure\b/);
  assert.match(setCookie, /; SameSite=Lax\b/);
  assert.doesNotMatch(setCookie, /; Domain=/i);
  const cookie = setCookie.split(";", 1)[0];
  const headers = { Cookie: `other=1; ${cookie}` };

  for (const path of ["/", "/api/state/index", "/api/debug/games"]) {
    const response = await fetch(restarted.url + path, { headers });
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("set-cookie"), null, path);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  const crossOrigin = await fetch(url + "/api/profiles", {
    method: "POST",
    headers: {
      ...headers,
      Origin: "https://elsewhere.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "Cross origin" }),
  });
  assert.equal(crossOrigin.status, 403);

  const bearerOnly = await fetch(url + "/api/v1/state/index", { headers });
  assert.equal(bearerOnly.status, 401);
  assert.match(bearerOnly.headers.get("www-authenticate") ?? "", /^Bearer /);

  const tampered = cookie.slice(0, -1) + (cookie.endsWith("0") ? "1" : "0");
  const rejected = await fetch(url, { headers: { Cookie: tampered } });
  assert.equal(rejected.status, 401);
  assert.equal(rejected.headers.get("set-cookie"), null);
  assert.equal((await fetch(rotated.url, { headers })).status, 401);

  t.mock.timers.setTime(now + lifetime - 1);
  assert.equal((await fetch(url, { headers })).status, 200);
  t.mock.timers.setTime(now + lifetime);
  const expired = await fetch(url, { headers });
  assert.equal(expired.status, 401);
  assert.match(expired.headers.get("www-authenticate") ?? "", /^Basic /);
  const signedInAgain = await fetch(url, {
    headers: { ...headers, Authorization: auth.basic },
  });
  assert.equal(signedInAgain.status, 200);
  assert(signedInAgain.headers.get("set-cookie"));
});

test("the API and browser share games, revisions and tracked play", async (t) => {
  const { url, endpoint, auth } = await fixture(t);
  const profile = await (
    await endpoint("/profiles", { name: "API test" })
  ).json();
  const list = await (
    await endpoint("/dictionaries", {
      name: "Small dictionary",
      text: "AT\nCAT\nACT\n",
    })
  ).json();
  const input = {
    profileId: profile.id,
    templateId: "scrabble",
    dictionaryId: list.id,
    name: "Test game",
    solo: true,
    creationToken: "c".repeat(32),
  };
  const creation = await endpoint("/games/new", input);
  assert.equal(creation.status, 201);
  let game: Game = await creation.json();
  assert.equal(game.startedAt, game.updatedAt);
  const startedAt = game.startedAt;
  assert.equal(
    (await (await endpoint("/games/new", input)).json()).id,
    game.id,
  );

  const command = (command: unknown, revision = game.revision) =>
    endpoint(`/games/${game.id}/actions`, { revision, command });
  const analysis = (operation: unknown) =>
    endpoint("/analysis", {
      position: { gameId: game.id, revision: game.revision },
      operation,
    });
  const rackEdit = await command({ action: "rack", rack: "CAT" });
  assert.equal(rackEdit.status, 200);
  game = await rackEdit.json();
  const revision = game.revision;

  const search = await analysis({ kind: "moves", word: "CAT" });
  const page = await search.json();
  assert.equal(search.status, 200, JSON.stringify(page));
  assert.equal(search.headers.get("x-tilemaxx-revision"), String(revision));
  const move = page.rows.find((row: { word: string }) => row.word === "CAT");
  assert(move);
  assert.equal(move.breakdown.score, move.score);
  const style = await analysis({
    kind: "moves",
    style: "greedy-bingo",
    budgetMs: 1_000,
  });
  const ranked = await style.json();
  assert.equal(style.status, 200, JSON.stringify(ranked));
  assert(ranked.rows.length > 0);
  assert(ranked.rows[0].utility);

  const played = await command({
    action: "play",
    tiles: move.tiles,
    direction: move.direction,
  });
  assert.equal(played.status, 200);
  game = await played.json();
  assert.equal(game.scoring?.you.points, move.score);
  const stale = await command({ action: "clear-board" }, revision);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).game.revision, game.revision);
  const browserGame = await fetch(url + `/api/games/${game.id}`, {
    headers: { Authorization: auth.basic },
  });
  assert.deepEqual(await browserGame.json(), game);

  const review = await analysis({ kind: "review-turn", index: 0 });
  assert.equal(review.status, 200);
  assert.equal((await review.json()).move.word, "CAT");

  game = await (await command({ action: "undo" })).json();
  assert.equal(game.rack, "CAT");
  assert(game.board.every((cell) => !cell));
  game = await (await command({ action: "redo" })).json();
  assert.equal(game.scoring?.you.points, move.score);
  game = await (
    await command({
      action: "end",
      scores: { you: 30, opponent: 0 },
      archive: true,
    })
  ).json();
  assert.equal(game.archived, true);
  assert.equal(game.startedAt, startedAt);
  assert.deepEqual(game.archivedBoard, game.board);
  const endedAt = game.scoring?.end?.endedAt;
  assert(endedAt && Number.isFinite(Date.parse(endedAt)));
  assert.equal(game.archivedState?.scoring?.end?.endedAt, endedAt);
  const stats = await endpoint(`/archive/statistics?profileId=${profile.id}`);
  assert.equal(stats.status, 200);
  const words = await endpoint("/word-check", {
    dictionary: { id: list.id },
    words: ["cat", "dog"],
  });
  assert.deepEqual(await words.json(), [
    { word: "CAT", found: true },
    { word: "DOG", found: false },
  ]);
});

test("OCR runs in a server worker and leaves the game unchanged", async (t) => {
  const { endpoint } = await fixture(t);
  const response = await endpoint("/screenshots/read", {
    format: "png",
    image: readFileSync("tests/fixtures/board.png").toString("base64"),
    size: 15,
    crop: { left: 0, top: 0, width: 750, height: 750 },
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.board.length, 225);
  assert.equal(result.sourceWidth, 750);
  assert(result.board.some(Boolean));
});
