import type { Rules } from "../shared/model";
import type { PlayerProfile } from "../shared/player-profiles";
import type { ProfileDictionary } from "../shared/profile-vocabulary";
import {
  decodeWordFrequencies,
  wordFrequencyLanguage,
  wordFrequencyUrl,
  type WordFrequencyLanguage,
} from "../shared/word-familiarity";
import { loadDictionaryVocabulary } from "./profile-vocabulary-cache";

const frequencies = new Map<
  WordFrequencyLanguage,
  Promise<ReadonlyMap<string, number>>
>();

async function loadCompressedAsset(url: string, message: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(message);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Fetch already decompresses responses served with Content-Encoding: gzip.
  return bytes[0] === 0x1f && bytes[1] === 0x8b
    ? new Uint8Array(await new Response(
        new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip")),
      ).arrayBuffer())
    : bytes;
}

export function loadWordFrequencies(rules: Rules) {
  const language = wordFrequencyLanguage(rules);
  const cached = frequencies.get(language);
  if (cached) return cached;
  const pending = loadCompressedAsset(wordFrequencyUrl(language), "Could not load this game's word frequency data.")
    .then((data) => decodeWordFrequencies(data, language))
    .catch((error) => {
      frequencies.delete(language);
      throw error;
    });
  frequencies.set(language, pending);
  return pending;
}

export function loadProfileVocabulary(
  rules: Rules,
  dictionary: ProfileDictionary,
  profile?: PlayerProfile,
  needsCasualFrequencies = false,
) {
  const english = wordFrequencyLanguage(rules) === "en";
  return Promise.all([
    english && profile === "casual" && !needsCasualFrequencies
      ? new Map<string, number>() : loadWordFrequencies(rules),
    english && profile !== "strong" ? loadDictionaryVocabulary(dictionary) : undefined,
  ]);
}
