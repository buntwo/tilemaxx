import type { Dictionary, Rules } from "./model";
import type { GameLanguage } from "./presets";

export const grammalecteDownloadName = "fr.d61940ba";

export function isGrammalecte(name: string) {
  return /\bgrammalecte\b/i.test(name) || name === grammalecteDownloadName;
}

const italian =
  /(?:^|[^a-z])(?:italian(?:o)?|zingarelli|morph[- ]?it|it[-_]it)(?=$|[^a-z])/i;
const french = /(?:^|[^a-z])(?:french|fran[cç]ais|ods[-_ ]?\d+)(?=$|[^a-z])/i;
const ukEnglish = /\b(?:collins|sowpods|csw\d*|uk english)\b/i;
const usEnglish = /\b(?:us english|nwl\d*|twl\d*|wow24)\b/i;
const lexulous = /\blexulous\b/i;
const wordfeud = /(?:^|[^a-z])word[-_ ]?feud(?=$|[^a-z])/i;

export function defaultDictionary(
  dictionaries: readonly Dictionary[],
  currentId?: string,
  rules?: Rules,
  language?: GameLanguage,
) {
  if (rules === "scrabble-fr")
    return dictionaries.find(({ name }) => isGrammalecte(name));
  if (language === "fr" || rules === "wordfeud-fr") {
    const [platform, otherPlatform] =
      rules === "wordfeud-fr" ? [wordfeud, lexulous] : [lexulous, wordfeud];
    const candidates = dictionaries.filter(
      ({ name }) => !otherPlatform.test(name),
    );
    return (
      candidates.find(
        ({ name }) =>
          platform.test(name) && (french.test(name) || isGrammalecte(name)),
      ) ??
      candidates.find(({ name }) => isGrammalecte(name)) ??
      candidates.find(({ name }) => french.test(name))
    );
  }
  if (language === "it")
    return (
      dictionaries.find(
        ({ name }) => lexulous.test(name) && italian.test(name),
      ) ?? dictionaries.find(({ name }) => italian.test(name))
    );
  if (language === "en-GB")
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
      (language !== "en-US" || !ukEnglish.test(name)),
  );
  return (
    (language === "en-US"
      ? english.find(({ name }) => lexulous.test(name) && usEnglish.test(name))
      : undefined) ??
    english.find(({ id }) => id === "wow24") ??
    english.find(({ name }) => /\bwow24\b/i.test(name)) ??
    english.find(({ id }) => id === currentId) ??
    english.find(({ id }) => id === "wordnik") ??
    english[0]
  );
}
