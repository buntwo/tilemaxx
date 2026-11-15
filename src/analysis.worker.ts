import { Lexicon, parseWords } from "../shared/lexicon";
import { analyzeMoves, type AnalysisRequest } from "../shared/move-analysis";
import {
  DEFAULT_ENDGAME_POSITION_LIMIT,
  EndgameSearchLimitError,
} from "../shared/endgame";
import { replyEndgameLine } from "../shared/reply-analysis";
import type {
  EndgamePrecomputeMessage,
  EndgamePrecomputeRequest,
} from "./useEndgameLines";

let dictionary: { id: string; lexicon: Lexicon } | undefined;
let familiar: Set<string> | undefined;

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
      try {
        const line = replyEndgameLine(
          lexicon,
          request,
          move,
          5_000,
          10 * DEFAULT_ENDGAME_POSITION_LIMIT,
        );
        post({ moveId: move.id, line });
      } catch (error) {
        if (!(error instanceof EndgameSearchLimitError)) throw error;
      }
    }
  } finally {
    post({ done: true });
  }
}

self.onmessage = async (
  event: MessageEvent<
    EndgamePrecomputeRequest | (AnalysisRequest & { dictionaryId: string })
  >,
) => {
  const request = event.data;
  if ("kind" in request) {
    // Prefetch failures leave normal on-demand analysis available.
    await precomputeEndgames(request).catch(() => {});
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
