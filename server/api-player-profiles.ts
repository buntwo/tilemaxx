import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { Lexicon } from "../shared/lexicon";
import type { BoardTemplate } from "../shared/model";
import { createPlayerProfiles } from "../shared/player-profiles";
import type { EnglishProfileVocabulary } from "../shared/profile-vocabulary";
import { decodeWordFrequencies, wordFrequencyLanguage, wordFrequencyUrl } from "../shared/word-familiarity";

export function apiPlayerProfiles(
  root: string,
  lexicon: Lexicon,
  template: BoardTemplate,
  vocabulary?: EnglishProfileVocabulary,
) {
  const language = wordFrequencyLanguage(template.rules);
  const data = gunzipSync(readFileSync(join(root, "public", wordFrequencyUrl(language))));
  return createPlayerProfiles(lexicon, template, decodeWordFrequencies(data, language),
    undefined, vocabulary);
}
