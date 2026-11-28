import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { encode } from "@msgpack/msgpack";
import { Lexicon } from "../shared/lexicon";
import { indexedProfileLookups, packPlayerProfileIndex } from "../shared/player-profile-index";
import {
  decodeProfileVocabulary, packFamiliarity, packProfileVocabulary,
  profileDictionaryRevision, profileVocabularyUrl, readPackedProfileVocabulary,
} from "../shared/profile-vocabulary";
import {
  createFrequencyAnchors, createWordDifficulty, decodeWordFrequencies,
  wordFrequencyLanguage,
  wordFrequencyUrl,
} from "../shared/word-familiarity";
import { loadProfileVocabulary, loadWordFrequencies } from "../src/word-frequencies";

const dictionary = { id: "test-english", words: ["BAT", "CAT"] };
const vocabularyUrl = profileVocabularyUrl(dictionary.id, profileDictionaryRevision(dictionary.words));

test("shared profile lookups preserve scores, study flags, and missing-word difficulty", () => {
  const words = ["BAT", "CAT", "CATS", "QIS", "ZAX"];
  const lexicon = new Lexicon(words);
  const frequencies = new Map([["CAT", 4.23], ["BAT", 2.79], ["MISS", 5.1], ["QIS", 1.23]]);
  const entries = [packFamiliarity(8412), packFamiliarity(9000),
    packFamiliarity(undefined), packFamiliarity(undefined, true), packFamiliarity(6291)];
  const vocabulary = packProfileVocabulary(words, (word) => entries[words.indexOf(word)]);
  const normal = decodeProfileVocabulary(vocabulary, words);
  const packed = structuredClone(packPlayerProfileIndex(words, frequencies,
    createFrequencyAnchors(lexicon, frequencies), readPackedProfileVocabulary(vocabulary, words)));
  assert(packed.spellings.buffer instanceof SharedArrayBuffer);
  assert(packed.familiarity?.buffer instanceof SharedArrayBuffer);
  const views = indexedProfileLookups(packed);
  const normalDifficulty = createWordDifficulty(lexicon, frequencies);
  const indexedDifficulty = createWordDifficulty(lexicon, views.frequencies);
  for (const word of [...words, "MISSING"]) {
    assert.equal(views.frequencies.get(word), frequencies.get(word));
    assert.equal(views.vocabulary?.get(word), normal.get(word));
    assert.deepEqual(indexedDifficulty(word), normalDifficulty(word));
  }
});

test("Casual and Learner share cached English frequency and vocabulary assets", async (context) => {
  const paths: string[] = [];
  const english = wordFrequencyUrl("en");
  let failed = false;
  context.mock.method(globalThis, "fetch", async (url: string) => {
    paths.push(url);
    if (url === english) return new Response(readFileSync(`public${url}`));
    if (!failed) {
      failed = true;
      return new Response("<!DOCTYPE html><h1>Unavailable</h1>");
    }
    return new Response(packProfileVocabulary(dictionary.words, word =>
      packFamiliarity(word === "CAT" ? 9_000 : 8_999),
    ).slice().buffer);
  });
  await assert.rejects(loadProfileVocabulary("scrabble", dictionary, "casual"), /does not match/);
  const [frequencies, words] = await loadProfileVocabulary("scrabble", dictionary, "casual");
  assert.equal(frequencies.get("SPATULA"), 2.86);
  assert.equal(words?.get("CAT"), 9_000);
  assert.equal(words?.get("BAT"), 8_999);
  const learner = await loadProfileVocabulary("crossplay", dictionary, "learner");
  assert.equal(learner[0], frequencies);
  assert.equal(learner[1], words);
  assert.deepEqual(paths, [english, vocabularyUrl, vocabularyUrl]);
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
  const [lateFrequencies, casualWords] = await loadProfileVocabulary("scrabble", dictionary, "casual");
  assert.equal(lateFrequencies, await english);
  assert.equal((await loadProfileVocabulary("scrabble", dictionary, "learner"))[1], casualWords);
  assert.equal((await loadProfileVocabulary("scrabble", dictionary, "strong"))[1], undefined);
  assert.equal((await loadProfileVocabulary("scrabble-fr", dictionary, "learner"))[1], undefined);
  assert.equal((await french).get("FENETRE"), 4.52);
  assert.equal((await retry).get("MANGIARE"), 5.01);
  assert.deepEqual(paths, [
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
