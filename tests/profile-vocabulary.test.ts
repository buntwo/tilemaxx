import assert from "node:assert/strict";
import { test } from "node:test";
import {
  casualWordProbability,
  decodeProfileVocabulary,
  learnerWordProbability,
  packFamiliarity,
  packProfileVocabulary,
  profileDictionaryRevision,
  profileVocabularyUrl,
} from "../shared/profile-vocabulary";
import { fetchProfileVocabulary } from "../src/profile-vocabulary-cache";
import type { CachedVocabulary } from "../src/word-list-cache";

test("English Learner halves every five points and keeps its short-word study rules", () => {
  const chance = (word: string, score?: number, studied?: boolean) =>
    learnerWordProbability(word, packFamiliarity(score, studied));
  assert.equal(chance("BOOK", 8_000), 1);
  assert.equal(chance("BOOK", 7_500), 0.5);
  assert.equal(chance("BOOK", 7_000), 0.25);
  assert.equal(chance("BOOK"), 0);
  assert.equal(chance("QI", undefined, true), 1);
  assert.equal(chance("TUI", 6_000, true), 0.53125);
  assert.equal(chance("TUI", undefined, true), 0.5);
  assert.equal(chance("QOPH"), 1);
  assert.equal(chance("EWW", 9_522), 1);
});

test("English Casual uses a 90 cutoff and a 2.5-point familiarity half-life", () => {
  assert.equal(casualWordProbability("BOOK", packFamiliarity(9_000)), 1);
  assert.equal(casualWordProbability("BOOK", packFamiliarity(8_750)), 0.5);
  assert.equal(casualWordProbability("RE", packFamiliarity(8_500, true)), 0.25);
  assert.equal(casualWordProbability("TUI", packFamiliarity(undefined, true)), 0);
});

test("English Casual and Learner share the hand-picked twos and threes", () => {
  for (const word of ["ZA", "QI", "QAT", "ZEK"]) {
    assert.equal(casualWordProbability(word, undefined), 1);
    assert.equal(learnerWordProbability(word, undefined), 1);
  }
  assert.equal(casualWordProbability("QOPH", undefined), 0);
  assert.equal(learnerWordProbability("QOPH", undefined), 1);
});

test("packed vocabulary requires the same spellings in the same order", () => {
  const words = ["CAT", "DOG"];
  const bytes = packProfileVocabulary(words, () => packFamiliarity(8_000));
  assert.deepEqual(
    [...decodeProfileVocabulary(bytes, words)],
    [
      ["CAT", 8_000],
      ["DOG", 8_000],
    ],
  );
  assert.throws(
    () => decodeProfileVocabulary(bytes, ["BAT", "DOG"]),
    /does not match/,
  );
  assert.throws(
    () => decodeProfileVocabulary(bytes, ["DOG", "CAT"]),
    /does not match/,
  );
  assert.throws(
    () => decodeProfileVocabulary(bytes.subarray(1), words),
    /does not match/,
  );
  assert.throws(
    () =>
      decodeProfileVocabulary(
        packProfileVocabulary(words, () => 30_000),
        words,
      ),
    /does not match/,
  );
});

test("the shared cache revalidates unchanged scores and works offline", async (t) => {
  const dictionary = { id: "local", words: ["CAT", "DOG"] };
  const url = profileVocabularyUrl(
    dictionary.id,
    profileDictionaryRevision(dictionary.words),
  );
  let cached: CachedVocabulary | undefined;
  const storage = {
    get: async () => cached,
    put: async (_key: string, next: CachedVocabulary) => {
      cached = next;
    },
  };
  let requests = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, options: RequestInit) => {
      requests++;
      if (requests === 1) {
        const bytes = packProfileVocabulary(dictionary.words, () =>
          packFamiliarity(9_100),
        );
        return new Response(bytes.slice().buffer, {
          headers: { ETag: '"one"' },
        });
      }
      assert.equal(new Headers(options.headers).get("If-None-Match"), '"one"');
      if (requests === 2) return new Response(null, { status: 304 });
      throw new TypeError("Offline");
    },
  );
  for (let i = 0; i < 3; i++)
    assert.equal(
      (await fetchProfileVocabulary(dictionary, url, storage)).get("CAT"),
      9_100,
    );
  assert.equal(cached?.key, url);
  assert.equal(requests, 3);
  const updated = { id: dictionary.id, words: ["CAT", "RAT"] };
  const updatedUrl = profileVocabularyUrl(
    updated.id,
    profileDictionaryRevision(updated.words),
  );
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Offline");
  });
  await assert.rejects(
    fetchProfileVocabulary(updated, updatedUrl, storage),
    /Connect to Tilemaxx/,
  );
});
