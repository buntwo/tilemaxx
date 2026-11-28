import { Lexicon, type LexiconIndex } from "./lexicon";
import type { BoardTemplate } from "./model";
import { profileWordHash } from "./player-profile-sampling";
import { createPlayerProfiles } from "./player-profiles";
import { missingFamiliarity } from "./profile-vocabulary";

const missingFrequency = -32_768;

/** Shared buffers are immutable after publication to analysis workers. */
export type PlayerProfileIndex = {
  spellings: Uint8Array;
  offsets: Uint32Array;
  slots: Uint32Array;
  zipf: Int16Array;
  familiarity?: Uint16Array;
  anchors: LexiconIndex;
};

export function packPlayerProfileIndex(
  words: readonly string[],
  frequency: ReadonlyMap<string, number>,
  anchors: LexiconIndex,
  familiarity?: (index: number) => number | undefined,
): PlayerProfileIndex {
  const text = new TextEncoder().encode(words.join(""));
  const spellings = new Uint8Array(new SharedArrayBuffer(text.byteLength));
  spellings.set(text);
  const offsets = new Uint32Array(new SharedArrayBuffer(4 * (words.length + 1)));
  let slotCount = 1;
  while (slotCount < 2 * words.length) slotCount *= 2;
  const slots = new Uint32Array(new SharedArrayBuffer(4 * slotCount));
  const zipf = new Int16Array(new SharedArrayBuffer(2 * words.length));
  const entries = familiarity && new Uint16Array(new SharedArrayBuffer(2 * words.length));
  for (const [index, word] of words.entries()) {
    offsets[index + 1] = offsets[index] + word.length;
    let slot = profileWordHash(word) & (slotCount - 1);
    while (slots[slot]) slot = (slot + 1) & (slotCount - 1);
    slots[slot] = index + 1;
    const score = frequency.get(word);
    zipf[index] = score === undefined ? missingFrequency : Math.round(score * 100);
    if (entries) entries[index] = familiarity!(index) ?? missingFamiliarity;
  }
  return { spellings, offsets, slots, zipf, familiarity: entries, anchors };
}

export function indexedProfileLookups(index: PlayerProfileIndex) {
  const { spellings, offsets, slots, zipf, familiarity } = index;
  const mask = slots.length - 1;
  function matches(word: string, start: number) {
    for (let i = 0; i < word.length; i++)
      if (spellings[start + i] !== word.charCodeAt(i)) return false;
    return true;
  }
  function find(word: string) {
    for (let slot = profileWordHash(word) & mask; slots[slot]; slot = (slot + 1) & mask) {
      const entry = slots[slot] - 1;
      const start = offsets[entry];
      if (offsets[entry + 1] - start === word.length && matches(word, start)) return entry;
    }
    return -1;
  }
  return {
    frequencies: {
      anchors: Lexicon.fromIndex(index.anchors),
      get(word: string) {
        const entry = find(word);
        return entry < 0 || zipf[entry] === missingFrequency ? undefined : zipf[entry] / 100;
      },
    },
    vocabulary: familiarity && {
      get(word: string) {
        const entry = find(word);
        return entry < 0 || familiarity[entry] === missingFamiliarity ? undefined : familiarity[entry];
      },
    },
  };
}

export function createIndexedPlayerProfiles(
  lexicon: Lexicon,
  template: BoardTemplate,
  index: PlayerProfileIndex,
) {
  const { frequencies, vocabulary } = indexedProfileLookups(index);
  return createPlayerProfiles(lexicon, template, frequencies, undefined, vocabulary);
}
