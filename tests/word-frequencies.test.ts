import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { encode } from "@msgpack/msgpack";
import {
  decodeWordFrequencies,
  englishCasualVocabularyUrl,
  wordFrequencyLanguage,
  wordFrequencyUrl,
} from "../shared/word-familiarity";
import { loadProfileVocabulary, loadWordFrequencies } from "../src/word-frequencies";

test("English Casual loads the strict EWPN allowlist independently of wordfreq", async (context) => {
  const paths: string[] = [];
  context.mock.method(globalThis, "fetch", async (url: string) => {
    paths.push(url);
    return paths.length === 1
      ? new Response("<!DOCTYPE html><h1>Unavailable</h1>")
      : new Response(readFileSync(`public${url}`));
  });
  await assert.rejects(loadProfileVocabulary("scrabble", "casual"), /Casual word list/);
  const [frequencies, words] = await loadProfileVocabulary("scrabble", "casual");
  assert.equal(frequencies.size, 0);
  assert.ok(words?.has("SINKABLE"));
  assert.ok(words?.has("BEDSPRING"));
  assert.equal(words?.has("ABASE"), false); // Exactly 75%.
  assert.equal(words?.has("CHATOYANT"), false); // Below 75%.
  assert.equal(words?.has("QOPH"), false); // No EWPN entry.
  assert.equal((await loadProfileVocabulary("crossplay", "casual"))[1], words);
  assert.deepEqual(paths, [englishCasualVocabularyUrl, englishCasualVocabularyUrl]);
});

test("accent folding merges tile spellings at their highest frequency", () => {
  const data = encode([
    { format: "cB", version: 1 },
    ["côté", "cœur", "perché"],
    ["cote", "cote\u0301", "coeur", "perche", "c'est", "à"],
  ]);
  const french = decodeWordFrequencies(data, "fr");
  assert.deepEqual([...french], [["COTE", 9], ["COEUR", 9], ["PERCHE", 9]]);
  const english = decodeWordFrequencies(data, "en");
  assert.deepEqual([...english], [["COTE", 8.99], ["COEUR", 8.99], ["PERCHE", 8.99]]);
});

test("familiarity uses the saved ruleset and caches each language independently", async (context) => {
  const paths: string[] = [];
  const italian = wordFrequencyUrl("it");
  let failItalian = true;
  context.mock.method(globalThis, "fetch", async (url: string) => {
    paths.push(url);
    if (url === italian && failItalian) {
      failItalian = false;
      return new Response(null, { status: 503 });
    }
    return new Response(readFileSync(`public${url}`));
  });
  const english = loadWordFrequencies("scrabble");
  assert.equal(loadWordFrequencies("lexulous"), english);
  const french = loadWordFrequencies("lexulous-fr");
  assert.equal(loadWordFrequencies("wordfeud-fr"), french);
  assert.equal(loadWordFrequencies("scrabble-fr"), french);
  await assert.rejects(loadWordFrequencies("lexulous-it"), /word frequency data/);
  assert.equal(loadWordFrequencies("wordfeud-fr"), french);
  const retry = loadWordFrequencies("lexulous-it");
  assert.equal(loadWordFrequencies("lexulous-it"), retry);
  assert.equal((await english).get("SPATULA"), 2.86);
  const [lateFrequencies, casualWords] = await loadProfileVocabulary("scrabble", "casual", true);
  assert.equal(lateFrequencies, await english);
  assert.ok(casualWords?.has("SINKABLE"));
  assert.equal((await french).get("FENETRE"), 4.52);
  assert.equal((await retry).get("MANGIARE"), 5.01);
  assert.deepEqual(paths, [
    wordFrequencyUrl("en"),
    wordFrequencyUrl("fr"),
    italian,
    italian,
  ]);
});

test("the decoder rejects invalid frequency files", () => {
  assert.equal(wordFrequencyLanguage("crossplay"), "en");
  assert.throws(() => decodeWordFrequencies(encode([]), "it"), /could not be read/);
  assert.throws(
    () => decodeWordFrequencies(encode([{ format: "cB", version: 1 }, 42]), "fr"),
    /Invalid word frequency bucket/,
  );
});
