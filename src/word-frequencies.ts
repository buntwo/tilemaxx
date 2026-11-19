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
    if (!response.ok || !response.body)
      throw new Error("Could not load this game's word frequency data.");
    const data = await new Response(
      response.body.pipeThrough(new DecompressionStream("gzip")),
    ).arrayBuffer();
    return decodeWordFrequencies(new Uint8Array(data), language);
  })().catch((error) => {
    frequencies.delete(language);
    throw error;
  });
  frequencies.set(language, pending);
  return pending;
}
