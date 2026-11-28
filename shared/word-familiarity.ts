import { decode } from "@msgpack/msgpack";
import { Lexicon } from "./lexicon";
import { gameWordLanguage } from "./model";

export type WordFrequencyLanguage = "en" | "fr" | "it";

export const wordFrequencyLanguage = gameWordLanguage;

export function wordFrequencyUrl(language: WordFrequencyLanguage) {
  return `/dictionaries/wordfreq-${language}-3.1.1.msgpack.gz`;
}

export function decodeWordFrequencies(
  data: ArrayLike<number>,
  language: WordFrequencyLanguage,
) {
  const pack = decode(data, { maxArrayLength: 50_000, maxStrLength: 256 });
  if (
    !Array.isArray(pack) ||
    pack[0]?.format !== "cB" ||
    pack[0]?.version !== 1
  )
    throw new Error("The word frequency data could not be read.");
  const frequencies = new Map<string, number>();
  // Bucket zero follows the format header and has a Zipf score of nine.
  for (let index = 1; index < pack.length; index++) {
    const bucket = pack[index];
    if (!Array.isArray(bucket))
      throw new Error("Invalid word frequency bucket.");
    for (const word of bucket) {
      if (typeof word !== "string") continue;
      if (language === "en") {
        if (/^[a-z]{2,25}$/.test(word))
          frequencies.set(word.toUpperCase(), (901 - index) / 100);
        continue;
      }
      const spelling = word.toUpperCase().normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replaceAll("Œ", "OE")
        .replaceAll("Æ", "AE");
      // Folded spellings can share a tile sequence. Zipf buckets are highest first.
      if (/^[A-Z]{2,25}$/.test(spelling) && !frequencies.has(spelling))
        frequencies.set(spelling, (901 - index) / 100);
    }
  }
  return frequencies;
}

/** Levenshtein distance to the anchor trie, capped at four. */
function cappedDistance(word: string, anchors: Lexicon, pattern: Int32Array) {
  pattern.fill(0);
  for (let index = 0; index < word.length; index++)
    pattern[word.charCodeAt(index) - 65] |= 1 << index;
  const end = 1 << word.length;
  const positions = (end << 1) - 1;
  let best = 4;
  function visit(
    node: number,
    exact: number,
    one: number,
    two: number,
    three: number,
  ) {
    if (anchors.terminal[node]) {
      if (exact & end) best = 0;
      else if (one & end) best = Math.min(best, 1);
      else if (two & end) best = Math.min(best, 2);
      else if (three & end) best = Math.min(best, 3);
    }
    let child = anchors.first[node];
    for (let bits = anchors.mask[node]; bits && best > 0; child++) {
      const letter = 31 - Math.clz32(bits);
      bits ^= 1 << letter;
      const match = pattern[letter];
      const nextExact = ((exact & match) << 1) & positions;
      // Each higher layer allows one more insertion, substitution, or deletion.
      const nextOne =
        (((one & match) << 1) | exact | (exact << 1) | (nextExact << 1)) &
        positions;
      const nextTwo =
        (((two & match) << 1) | one | (one << 1) | (nextOne << 1)) & positions;
      const nextThree =
        (((three & match) << 1) | two | (two << 1) | (nextTwo << 1)) &
        positions;
      const relevant =
        best === 1
          ? nextExact
          : best === 2
            ? nextOne
            : best === 3
              ? nextTwo
              : nextThree;
      if (relevant) visit(child, nextExact, nextOne, nextTwo, nextThree);
    }
  }
  visit(0, 1, 3, 7, 15);
  return best;
}

export type WordDifficulty = (word: string) => {
  difficulty: number;
  missing: boolean;
};

export type WordFrequencyLookup = Pick<ReadonlyMap<string, number>, "get"> &
  ({ keys(): Iterable<string> } | { anchors: Lexicon });

export function createFrequencyAnchors(
  lexicon: Lexicon,
  frequencies: { keys(): Iterable<string> },
) {
  const common: string[] = [];
  for (const token of frequencies.keys()) {
    if (lexicon.has(token)) common.push(token);
    if (common.length === 10_000) break;
  }
  return new Lexicon(common);
}

export function createWordDifficulty(
  lexicon: Lexicon,
  frequencies: WordFrequencyLookup,
): WordDifficulty {
  let anchors = "anchors" in frequencies ? frequencies.anchors : undefined;
  const pattern = new Int32Array(26);
  return (word) => {
    const zipf = frequencies.get(word);
    if (zipf !== undefined)
      return { difficulty: Math.max(0, 3 * (3 - zipf)), missing: false };
    anchors ??= "anchors" in frequencies ? frequencies.anchors : createFrequencyAnchors(lexicon, frequencies);
    const edits = /^[A-Z]{2,25}$/.test(word)
      ? cappedDistance(word, anchors, pattern)
      : 4;
    return { difficulty: [0, 12, 16, 24, 32][edits], missing: true };
  };
}
