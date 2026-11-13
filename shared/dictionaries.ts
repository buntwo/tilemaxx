import { type Dictionary } from "./model";

export function defaultDictionary(
  dictionaries: readonly Dictionary[],
  currentId?: string,
) {
  return (
    dictionaries.find((dictionary) => dictionary.id === "wow24") ??
    dictionaries.find((dictionary) => /\bwow24\b/i.test(dictionary.name)) ??
    dictionaries.find((dictionary) => dictionary.id === currentId) ??
    dictionaries.find((dictionary) => dictionary.id === "wordnik") ??
    dictionaries[0]
  );
}
