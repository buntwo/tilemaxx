import type { Rules } from "../shared/model";
import {
  decodeWordFrequencies,
  wordFrequencyLanguage,
  wordFrequencyUrl,
  type WordFrequencyLanguage,
} from "../shared/word-familiarity";

const frequencies = new Map<
  WordFrequencyLanguage,
  Promise<ReadonlyMap<string, number>>
>();

export function loadWordFrequencies(rules: Rules) {
  const language = wordFrequencyLanguage(rules);
  const cached = frequencies.get(language);
  if (cached) return cached;
  const pending = (async () => {
    const response = await fetch(wordFrequencyUrl(language));
    if (!response.ok)
      throw new Error("Could not load this game's word frequency data.");
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    // Fetch already decompresses responses served with Content-Encoding: gzip.
    const data = bytes[0] === 0x1f && bytes[1] === 0x8b
      ? new Uint8Array(await new Response(
          new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip")),
        ).arrayBuffer())
      : bytes;
    return decodeWordFrequencies(data, language);
  })().catch((error) => {
    frequencies.delete(language);
    throw error;
  });
  frequencies.set(language, pending);
  return pending;
}
