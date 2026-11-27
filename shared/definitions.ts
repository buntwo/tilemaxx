import { gameWordLanguage, type Rules } from "./model";

export type DefinitionLanguage = "en" | "fr";

export interface WordDefinition {
  source: string;
  spelling: string;
  headword: string;
  partOfSpeech: string;
  glosses: string[];
  sourceUrl: string | null;
  license: string | null;
}

export interface DefinitionLookup {
  available: boolean;
  entries: WordDefinition[][];
  // English only, aligned with the requested spellings. Null means no wordfreq entry.
  wordFrequencyZipf?: (number | null)[];
}

export function definitionSpelling(word: string) {
  return word.trim().normalize("NFC").toLowerCase().replaceAll("’", "'");
}

export function definitionTileKey(word: string) {
  const key = definitionSpelling(word)
    .replaceAll("œ", "oe")
    .replaceAll("æ", "ae")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return /^[a-z]{2,25}$/.test(key) ? key : null;
}

export function definitionLanguageForRules(
  rules: Rules,
): DefinitionLanguage | undefined {
  const language = gameWordLanguage(rules);
  return language === "it" ? undefined : language;
}
