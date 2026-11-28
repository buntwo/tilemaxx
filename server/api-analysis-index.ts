import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { Lexicon, parseWords, type LexiconIndex } from "../shared/lexicon";
import type { BoardTemplate } from "../shared/model";
import { packPlayerProfileIndex, type PlayerProfileIndex } from "../shared/player-profile-index";
import { usesLearnerPolicy } from "../shared/player-profiles";
import { readPackedProfileVocabulary } from "../shared/profile-vocabulary";
import { isSimulatedStyle } from "../shared/simulated-styles";
import { createFrequencyAnchors, decodeWordFrequencies, wordFrequencyLanguage, wordFrequencyUrl } from "../shared/word-familiarity";
import type { Computation } from "./api-computation";
import { ApiError } from "./api-error";

export type ApiAnalysisIndexes = {
  dictionary?: LexiconIndex;
  profiles?: PlayerProfileIndex;
};

export function needsPlayerIndex({ operation }: Extract<Computation, { kind: "analysis" }>) {
  if (operation.kind === "compare") return !!operation.opponent;
  if (operation.kind === "moves") return !!operation.style && !isSimulatedStyle(operation.style);
  return operation.kind === "exchange-advice" && !!operation.style;
}

function share(source: Int32Array | Uint8Array) {
  const buffer = new SharedArrayBuffer(source.byteLength);
  new Uint8Array(buffer).set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
  return buffer;
}

function shareLexicon({ first, mask, terminal, maxTail, count }: Lexicon) {
  return {
    first: new Int32Array(share(first)),
    mask: new Int32Array(share(mask)),
    terminal: new Uint8Array(share(terminal)),
    maxTail: new Uint8Array(share(maxTail)),
    count,
  };
}

export function loadDictionaryWords(dictionary: Extract<Computation, { kind: "analysis" }>["dictionary"]) {
  let text: string;
  try {
    text = "text" in dictionary ? dictionary.text : readFileSync(dictionary.file, "utf8");
  } catch {
    throw new ApiError(404, "Word list is unavailable.");
  }
  const words = parseWords(text);
  if (!words.length) throw new ApiError(422, "The word list contains no valid entries.");
  return words;
}

export function buildDictionaryIndex(words: string[]): LexiconIndex {
  return shareLexicon(new Lexicon(words));
}

export function buildPlayerIndex(
  root: string,
  lexicon: Lexicon,
  words: readonly string[],
  template: BoardTemplate,
  vocabulary?: Uint8Array,
) {
  const language = wordFrequencyLanguage(template.rules);
  const bytes = gunzipSync(readFileSync(join(root, "public", wordFrequencyUrl(language))));
  const frequencies = decodeWordFrequencies(bytes, language);
  const anchors = shareLexicon(createFrequencyAnchors(lexicon, frequencies));
  const familiarity = language === "en" && vocabulary
    ? readPackedProfileVocabulary(vocabulary, words)
    : undefined;
  return packPlayerProfileIndex(words, frequencies, anchors, familiarity);
}
