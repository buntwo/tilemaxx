import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWordList, type WordListStorage } from "../src/word-list-cache";

function memory(): WordListStorage {
  const words = new Map<string, string>();
  return {
    get: async (url) => words.get(url),
    put: async (url, text) => {
      words.set(url, text);
    },
  };
}

test("word lists persist across worker loads and refresh only when requested", async () => {
  const storage = memory();
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return new Response("CAT\nDOG\n");
    };
    assert.equal((await loadWordList("/words", { storage })).persisted, true);
    globalThis.fetch = async () => {
      calls++;
      throw new Error("Offline");
    };
    assert.equal(
      (await loadWordList("/words", { storage })).text,
      "CAT\nDOG\n",
    );
    assert.equal(calls, 1);
    assert.equal(
      (await loadWordList("/words", { storage, refresh: true })).text,
      "CAT\nDOG\n",
    );
    globalThis.fetch = async () => new Response("CAT\nDOG\nBIRD\n");
    await loadWordList("/words", { storage, refresh: true });
    assert.equal(await storage.get("/words"), "CAT\nDOG\nBIRD\n");
  } finally {
    globalThis.fetch = original;
  }
});

test("storage failures allow online use without claiming offline readiness", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("CAT\n");
    const storage: WordListStorage = {
      get: async () => {
        throw new Error("Denied");
      },
      put: async () => {
        throw new Error("Quota exceeded");
      },
    };
    assert.deepEqual(await loadWordList("/words", { storage }), {
      text: "CAT\n",
      persisted: false,
    });
  } finally {
    globalThis.fetch = original;
  }
});

test("failed and HTML responses never poison the cache; missing offline lists are actionable", async () => {
  const storage = memory();
  const original = globalThis.fetch;
  try {
    for (const response of [
      new Response("Missing", { status: 404 }),
      new Response("<!doctype html><html>App</html>"),
    ]) {
      globalThis.fetch = async () => response;
      await assert.rejects(
        loadWordList("/words", { storage }),
        /Connect to Tilemaxx/,
      );
      assert.equal(await storage.get("/words"), undefined);
    }
  } finally {
    globalThis.fetch = original;
  }
});
