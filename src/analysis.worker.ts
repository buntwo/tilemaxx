import { Lexicon, parseWords } from "../shared/lexicon";
import { analyzeMoves, type AnalysisRequest } from "../shared/move-analysis";

let dictionary: { id: string; lexicon: Lexicon } | undefined;
let familiar: Set<string> | undefined;

async function words(url: string) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error("Could not load the word list for analysis.");
  return parseWords(await response.text());
}

self.onmessage = async (
  event: MessageEvent<AnalysisRequest & { dictionaryId: string }>,
) => {
  try {
    const request = event.data;
    if (dictionary?.id !== request.dictionaryId || !familiar) {
      const [dictionaryWords, familiarWords] = await Promise.all([
        dictionary?.id === request.dictionaryId
          ? null
          : words(
              `/api/dictionaries/${encodeURIComponent(request.dictionaryId)}`,
            ),
        familiar ? null : words("/dictionaries/moby-frequent.txt"),
      ]);
      if (dictionaryWords)
        dictionary = {
          id: request.dictionaryId,
          lexicon: new Lexicon(dictionaryWords),
        };
      if (familiarWords) familiar = new Set(familiarWords);
    }
    const result = analyzeMoves(
      dictionary!.lexicon,
      request,
      familiar!,
      (progress) => {
        self.postMessage({ progress });
      },
    );
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error
          ? error.message
          : "The analysis stopped unexpectedly.",
    });
  }
};
