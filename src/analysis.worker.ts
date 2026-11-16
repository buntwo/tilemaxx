import { Lexicon, parseWords } from "../shared/lexicon";
import { analyzeMoves, type AnalysisRequest } from "../shared/move-analysis";
import { EndgameSearchLimitError } from "../shared/endgame";
import { replyEndgameLine } from "../shared/reply-analysis";
import type {
  EndgamePrecomputeMessage,
  EndgamePrecomputeRequest,
} from "./useEndgameLines";

let dictionary: { id: string; lexicon: Lexicon } | undefined;
let familiar: Set<string> | undefined;
const PRECOMPUTE_TIME_LIMIT_MS = 5_000;

async function words(url: string) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error("Could not load the word list for analysis.");
  return parseWords(await response.text());
}

async function loadDictionary(id: string) {
  if (dictionary?.id !== id) {
    const list = await words(`/api/dictionaries/${encodeURIComponent(id)}`);
    dictionary = { id, lexicon: new Lexicon(list) };
  }
  return dictionary.lexicon;
}

async function precomputeEndgames(request: EndgamePrecomputeRequest) {
  const post = (message: EndgamePrecomputeMessage) => self.postMessage(message);
  try {
    const lexicon = await loadDictionary(request.dictionaryId);
    for (const move of request.moves) {
      const started = performance.now();
      try {
        const line = replyEndgameLine(
          lexicon,
          request,
          move,
          PRECOMPUTE_TIME_LIMIT_MS,
          Infinity,
        );
        post({ moveId: move.id, line, elapsed: performance.now() - started });
      } catch (error) {
        if (!(error instanceof EndgameSearchLimitError)) throw error;
        post({ moveId: move.id, limit: error.message, elapsed: performance.now() - started });
      }
    }
    post({ done: true });
  } catch (error) {
    post({
      done: true,
      error:
        error instanceof Error
          ? error.message
          : "Background endgame search stopped unexpectedly.",
    });
  }
}

self.onmessage = async (
  event: MessageEvent<
    EndgamePrecomputeRequest | (AnalysisRequest & { dictionaryId: string })
  >,
) => {
  const request = event.data;
  if ("kind" in request) {
    await precomputeEndgames(request);
    return;
  }
  try {
    const [lexicon, common] = await Promise.all([
      loadDictionary(request.dictionaryId),
      familiar ??
        words("/dictionaries/moby-frequent.txt").then((list) => new Set(list)),
    ]);
    familiar = common;
    const result = analyzeMoves(lexicon, request, common, (progress) => {
      self.postMessage({ progress });
    });
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
