import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function setup() {
  const handlers = new Map<string, (event: any) => void>();
  const stores = new Map<string, Map<string, Response>>();
  let online = true;
  let calls = 0;
  let windows = 1;
  let activations = 0;
  const network = async (path: string | { url: string }) => {
    calls++;
    if (!online) throw new Error("Offline");
    return new Response(typeof path === "string" ? path : path.url);
  };
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name)!;
      return {
        match: async (path: string) => entries.get(path)?.clone(),
        put: async (path: string, response: Response) => {
          entries.set(path, response);
        },
        add: async (path: string) => {
          entries.set(path, await network(path));
        },
        addAll: async (paths: string[]) => {
          const values = await Promise.all(paths.map(network));
          paths.forEach((path, i) => entries.set(path, values[i]));
        },
      };
    },
  };
  runInNewContext(readFileSync("scripts/offline-worker.js", "utf8"), {
    ASSETS: ["/index.html", "/assets/app.js", "/assets/solver.js"],
    OCR_ASSETS: ["/ocr/worker.min.js", "/ocr/eng.traineddata.gz"],
    CACHE_NAME: "tilemaxx-app-current",
    OCR_CACHE_NAME: "tilemaxx-ocr-current",
    self: {
      addEventListener: (type: string, fn: (event: any) => void) =>
        handlers.set(type, fn),
      location: { origin: "https://tilemaxx.test" },
      clients: {
        claim: async () => {},
        matchAll: async () => Array(windows).fill({}),
      },
      skipWaiting: async () => {
        activations++;
      },
    },
    caches,
    URL,
    fetch: network,
  });
  const lifecycle = (type: string) =>
    new Promise<void>((resolve, reject) => {
      handlers.get(type)!({
        waitUntil: (work: Promise<void>) => work.then(resolve, reject),
      });
    });
  const request = (path: string, mode = "cors", method = "GET") => {
    let result: Promise<Response> | undefined;
    handlers.get("fetch")!({
      request: { url: `https://tilemaxx.test${path}`, mode, method },
      respondWith: (response: Promise<Response>) => {
        result = response;
      },
    });
    return result;
  };
  const prepare = async () => {
    let ready = false;
    let work!: Promise<void>;
    handlers.get("message")!({
      data: { kind: "prepare-offline" },
      ports: [
        {
          postMessage: (message: { ready: boolean }) => {
            ready = message.ready;
          },
        },
      ],
      waitUntil: (pending: Promise<void>) => {
        work = pending;
      },
    });
    await work;
    return ready;
  };
  const activate = async () => {
    let work!: Promise<void>;
    handlers.get("message")!({
      data: { kind: "activate-update" },
      ports: [],
      waitUntil: (pending: Promise<void>) => {
        work = pending;
      },
    });
    await work;
    return activations;
  };
  return {
    activate,
    setWindows: (count: number) => {
      windows = count;
    },
    lifecycle,
    request,
    prepare,
    stores,
    offline: () => {
      online = false;
    },
    online: () => {
      online = true;
    },
    calls: () => calls,
  };
}

test("cached navigation, worker scripts and OCR work offline without caching API reads or writes", async () => {
  const app = setup();
  await app.lifecycle("install");
  assert.equal(await app.prepare(), true);
  app.offline();
  const calls = app.calls();
  assert.equal(
    await (await app.request("/", "navigate"))?.text(),
    "/index.html",
  );
  assert.equal(
    await (await app.request("/assets/solver.js"))?.text(),
    "/assets/solver.js",
  );
  assert.equal(
    await (await app.request("/ocr/eng.traineddata.gz"))?.text(),
    "/ocr/eng.traineddata.gz",
  );
  assert.equal(await app.prepare(), true);
  assert.equal(app.calls(), calls);
  assert.equal(app.request("/api/state/index"), undefined);
  assert.equal(app.request("/api/dictionaries/private"), undefined);
  assert.equal(app.request("/api/games", "cors", "POST"), undefined);
});

test("failed OCR preparation is retryable and app cache cleanup preserves unrelated storage", async () => {
  const app = setup();
  await app.lifecycle("install");
  app.offline();
  assert.equal(await app.prepare(), false);
  app.online();
  assert.equal(await app.prepare(), true);
  app.stores.set("tilemaxx-app-old", new Map());
  app.stores.set("unrelated-cache", new Map());
  await app.lifecycle("activate");
  assert.equal(app.stores.has("tilemaxx-app-old"), false);
  assert.equal(app.stores.has("unrelated-cache"), true);
  assert.equal(app.stores.has("tilemaxx-app-current"), true);
  const downloads = app.calls();
  app.offline();
  assert.equal(await app.prepare(), true);
  assert.equal(app.calls(), downloads);
});

test("an unsuccessful installation cannot replace the previously cached app", async () => {
  const app = setup();
  app.stores.set(
    "tilemaxx-app-old",
    new Map([["/index.html", new Response("old")]]),
  );
  app.offline();
  await assert.rejects(app.lifecycle("install"), /Offline/);
  assert.equal(
    await app.stores.get("tilemaxx-app-old")?.get("/index.html")?.text(),
    "old",
  );
});

test("idle updates never force activation over another open game tab", async () => {
  const app = setup();
  app.setWindows(2);
  assert.equal(await app.activate(), 0);
  app.setWindows(1);
  assert.equal(await app.activate(), 1);
});
