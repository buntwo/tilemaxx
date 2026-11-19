import type { Dictionary, Rules } from "./model";

export const grammalecteDownloadName = "fr.d61940ba";

export function isGrammalecte(name: string) {
  return /\bgrammalecte\b/i.test(name) || name === grammalecteDownloadName;
}

export function defaultDictionary(
  dictionaries: readonly Dictionary[],
  currentId?: string,
  rules?: Rules,
) {
  if (rules === "scrabble-fr")
    return dictionaries.find(({ name }) => isGrammalecte(name));
  return (
    dictionaries.find((dictionary) => dictionary.id === "wow24") ??
    dictionaries.find((dictionary) => /\bwow24\b/i.test(dictionary.name)) ??
    dictionaries.find(
      ({ id, name }) => id === currentId && !isGrammalecte(name),
    ) ??
    dictionaries.find((dictionary) => dictionary.id === "wordnik") ??
    dictionaries.find(({ name }) => !isGrammalecte(name))
  );
}
