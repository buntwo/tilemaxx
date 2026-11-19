import { test } from "node:test";
import assert from "node:assert/strict";
import { Lexicon, popcount } from "../shared/lexicon";

test("compressed suffixes preserve accepting edges, continuations and maximum word lengths", () => {
  const words = [
    "AT",
    "ATE",
    "BAT",
    "BATE",
    "CATE",
    "CAR",
    "CARS",
    "EAR",
    "EARS",
    "EAT",
    "EATS",
  ];
  const dictionary = new Lexicon(words);
  const allPrefixes = new Set([
    "",
    ...words.flatMap((w) =>
      Array.from({ length: w.length }, (_, i) => w.slice(0, i + 1)),
    ),
  ]);
  assert.ok(
    dictionary.first.length < allPrefixes.size,
    "suffix blocks are shared",
  );
  const descend = (prefix: string) =>
    [...prefix].reduce(
      (node, letter) => dictionary.child(node, letter.charCodeAt(0) - 65),
      0,
    );
  for (const prefix of allPrefixes) {
    const node = descend(prefix);
    const tails = words
      .filter((w) => w.startsWith(prefix))
      .map((w) => w.slice(prefix.length));
    assert.equal(dictionary.has(prefix), words.includes(prefix), prefix);
    assert.equal(
      dictionary.maxTail[node],
      Math.max(...tails.map((t) => t.length)),
      prefix,
    );
    assert.equal(
      popcount(dictionary.mask[node]),
      new Set(tails.filter(Boolean).map((t) => t[0])).size,
    );
    for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ")
      assert.equal(
        dictionary.has(prefix + letter),
        words.includes(prefix + letter),
      );
  }
  // CA and BA share outgoing transitions even though CAT is not a word and BAT is.
  assert.equal(
    dictionary.first[descend("CAT")],
    dictionary.first[descend("BAT")],
  );
  assert.equal(dictionary.has("CAT"), false);
  assert.equal(dictionary.has("BAT"), true);
});

test("cross masks agree with direct dictionary membership for every tested insertion", () => {
  const words = [
    "AT",
    "ATE",
    "BAT",
    "BATE",
    "CATE",
    "CAR",
    "CARS",
    "EAR",
    "EARS",
    "EAT",
    "EATS",
  ];
  const dictionary = new Lexicon(words);
  for (const word of words)
    for (let i = 0; i < word.length; i++) {
      const prefix = word.slice(0, i),
        suffix = word.slice(i + 1);
      let expected = 0;
      for (let letter = 0; letter < 26; letter++)
        if (words.includes(prefix + String.fromCharCode(65 + letter) + suffix))
          expected |= 1 << letter;
      assert.equal(dictionary.crossMask(prefix, suffix), expected);
    }
  const empty = new Lexicon([]);
  assert.equal(empty.has("AT"), false);
  assert.equal(empty.child(0, 0), 0);
  assert.equal(empty.crossMask("", ""), 0);
});

test("worker reconstruction and word enumeration preserve compressed suffix paths", () => {
  const words = [
    "AT",
    "ATE",
    "BAT",
    "BATE",
    "CATE",
    "CAR",
    "CARS",
    "EAR",
    "EARS",
  ];
  const dictionary = new Lexicon(words);
  const restored = Lexicon.fromIndex(
    structuredClone({
      first: dictionary.first,
      mask: dictionary.mask,
      terminal: dictionary.terminal,
      maxTail: dictionary.maxTail,
      count: dictionary.count,
    }),
  );
  assert.deepEqual([...restored.words()].sort(), [...words].sort());
  for (const word of words) assert.equal(restored.has(word), true);
  assert.equal(restored.has("CAT"), false);
});
