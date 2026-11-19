import type { Dictionary, Rules } from "./model";
import type { LexulousLanguage } from "./presets";

export const grammalecteDownloadName = "fr.d61940ba";

export function isGrammalecte(name: string) {
  return /\bgrammalecte\b/i.test(name) || name === grammalecteDownloadName;
}

const italian =
  /(?:^|[^a-z])(?:italian(?:o)?|zingarelli|morph[- ]?it|it[-_]it)(?=$|[^a-z])/i;
const french = /\bfrench\b|\bods[-_ ]?\d+\b/i;
const ukEnglish = /\b(?:collins|sowpods|csw\d*|uk english)\b/i;
const usEnglish = /\b(?:us english|nwl\d*|twl\d*|wow24)\b/i;
const lexulous = /\blexulous\b/i;

export function defaultDictionary(
  dictionaries: readonly Dictionary[],
  currentId?: string,
  rules?: Rules,
  lexulousLanguage?: LexulousLanguage,
) {
  if (rules === "scrabble-fr")
    return dictionaries.find(({ name }) => isGrammalecte(name));
  if (lexulousLanguage === "fr")
    return (
      dictionaries.find(
        ({ name }) => lexulous.test(name) && french.test(name),
      ) ??
      dictionaries.find(({ name }) => isGrammalecte(name)) ??
      dictionaries.find(({ name }) => french.test(name))
    );
  if (lexulousLanguage === "it")
    return (
      dictionaries.find(
        ({ name }) => lexulous.test(name) && italian.test(name),
      ) ?? dictionaries.find(({ name }) => italian.test(name))
    );
  if (lexulousLanguage === "en-GB")
    return (
      dictionaries.find(
        ({ name }) => lexulous.test(name) && ukEnglish.test(name),
      ) ?? dictionaries.find(({ name }) => ukEnglish.test(name))
    );
  const english = dictionaries.filter(
    ({ name }) =>
      !isGrammalecte(name) &&
      !french.test(name) &&
      !italian.test(name) &&
      (lexulousLanguage !== "en-US" || !ukEnglish.test(name)),
  );
  return (
    (lexulousLanguage === "en-US"
      ? english.find(({ name }) => lexulous.test(name) && usEnglish.test(name))
      : undefined) ??
    english.find(({ id }) => id === "wow24") ??
    english.find(({ name }) => /\bwow24\b/i.test(name)) ??
    english.find(({ id }) => id === currentId) ??
    english.find(({ id }) => id === "wordnik") ??
    english[0]
  );
}
