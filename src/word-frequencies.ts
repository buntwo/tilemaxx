import {
  decodeWordFrequencies,
  WORD_FREQUENCY_URL,
} from "../shared/word-familiarity";

let frequencies: Promise<ReadonlyMap<string, number>> | undefined;

export function loadWordFrequencies() {
  return (frequencies ??= (async () => {
    const response = await fetch(WORD_FREQUENCY_URL);
    if (!response.ok || !response.body)
      throw new Error("Could not load the English word frequency data.");
    const data = await new Response(
      response.body.pipeThrough(new DecompressionStream("gzip")),
    ).arrayBuffer();
    return decodeWordFrequencies(new Uint8Array(data));
  })().catch((error) => {
    frequencies = undefined;
    throw error;
  }));
}
