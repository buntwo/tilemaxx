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
  // Aligned with the requested spellings. Null means wordfreq has no entry.
  wordFrequencyZipf?: (number | null)[];
}

export function definitionLanguageForRules(
  rules: Rules,
): DefinitionLanguage | undefined {
  const language = gameWordLanguage(rules);
  return language === "it" ? undefined : language;
}
