export const profileVocabularyVersion = 1;
export const missingFamiliarity = 0x3fff;

const scoreMask = 0x3fff;
const studyFlag = 0x4000;
const headerSize = 20;
const magic = "TMV1";
const shortFavorites = new Set(
  (
    "AA AE AX EX JO OE OX QI XI XU ZA " +
    "AAL AAS ADZ AIS AJI AZO CWM EAU HAJ JEE JEU JIN JOW JUS KEX OES OXO " +
    "PHT PYX QAT QIS QUA RAJ RAX SUQ ULU VOX XIS ZAS ZAX ZEK ZOA"
  ).split(" "),
);
const learnerLongFavorites = new Set("CINQ CWMS EAUX QADI QAID QATS QOPH SUQS".split(" "));

export type EnglishProfileVocabulary = ReadonlyMap<string, number>;
export type ProfileDictionary = { id: string; words: readonly string[] };

/** Fingerprint canonical spellings and their order, including on plain HTTP LANs. */
export function profileDictionaryRevision(words: readonly string[]) {
  let first = 0x811c9dc5;
  let second = 0x9747b28c;
  for (const word of words) {
    for (let i = 0; i < word.length; i++) {
      const code = word.charCodeAt(i);
      first = Math.imul(first ^ code, 0x01000193);
      second = Math.imul(second ^ code, 0x5bd1e995);
    }
    first = Math.imul(first ^ 10, 0x01000193);
    second = Math.imul(second ^ 10, 0x5bd1e995);
  }
  return (
    (first >>> 0).toString(16).padStart(8, "0") +
    (second >>> 0).toString(16).padStart(8, "0")
  );
}

export const profileVocabularyUrl = (id: string, revision: string) =>
  `/api/dictionaries/${encodeURIComponent(id)}/vocabulary/${profileVocabularyVersion}/${revision}`;

/** The dictionary words are stored separately. Each entry uses one 16-bit lane. */
export function packProfileVocabulary(
  words: readonly string[],
  entry: (word: string) => number,
): Uint8Array {
  const bytes = new Uint8Array(headerSize + words.length * 2);
  bytes.set(new TextEncoder().encode(magic + profileDictionaryRevision(words)));
  const data = new DataView(bytes.buffer);
  for (let i = 0; i < words.length; i++)
    data.setUint16(headerSize + i * 2, entry(words[i]), true);
  return bytes;
}

export const packFamiliarity = (score: number | undefined, studied = false) =>
  (score ?? missingFamiliarity) | (studied ? studyFlag : 0);

export function readPackedProfileVocabulary(
  bytes: Uint8Array,
  words: readonly string[],
) {
  const invalid = "The familiarity table does not match this word list.";
  if (
    bytes.byteLength !== headerSize + words.length * 2 ||
    new TextDecoder().decode(bytes.subarray(0, headerSize)) !==
      magic + profileDictionaryRevision(words)
  )
    throw new Error(invalid);
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return (index: number) => {
    const value = data.getUint16(headerSize + index * 2, true);
    const score = value & scoreMask;
    if (value & 0x8000 || (score > 10_000 && score !== missingFamiliarity))
      throw new Error(invalid);
    return value === missingFamiliarity ? undefined : value;
  };
}

export function decodeProfileVocabulary(
  bytes: Uint8Array,
  words: readonly string[],
): EnglishProfileVocabulary {
  const entry = readPackedProfileVocabulary(bytes, words);
  const vocabulary = new Map<string, number>();
  for (let i = 0; i < words.length; i++) {
    const value = entry(i);
    if (value !== undefined) vocabulary.set(words[i], value);
  }
  return vocabulary;
}

function familiarityProbability(
  entry: number | undefined,
  cutoff: number,
  halfLife: number,
) {
  const score = (entry ?? missingFamiliarity) & scoreMask;
  return score === missingFamiliarity
    ? 0
    : 2 ** (Math.min(0, score - cutoff) / halfLife);
}

export function casualWordProbability(
  spelling: string,
  entry: number | undefined,
) {
  return shortFavorites.has(spelling) ? 1 : familiarityProbability(entry, 9_000, 250);
}

export function learnerWordProbability(
  spelling: string,
  entry: number | undefined,
) {
  if (shortFavorites.has(spelling) || learnerLongFavorites.has(spelling)) return 1;
  const studied = !!((entry ?? 0) & studyFlag);
  if (studied && spelling.length === 2) return 1;
  const familiarity = familiarityProbability(entry, 8_000, 500);
  return studied && spelling.length === 3
    ? 0.5 + 0.5 * familiarity
    : familiarity;
}
