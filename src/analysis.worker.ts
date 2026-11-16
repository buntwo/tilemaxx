import { Lexicon, parseWords } from "../shared/lexicon";
import { analyzeMoves, type AnalysisRequest } from "../shared/move-analysis";
import { runCandidateJobs } from "./candidate-analysis-pool";
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
    const { dictionaryId, moves, workerLimit, kind: _, ...position } = request;
    const lexicon = await loadDictionary(dictionaryId);
    await runCandidateJobs(
      lexicon,
      moves.map((move) => ({ kind: "endgame", position, move })),
      ({ move }, result) => {
        const { id: moveId } = move;
        if (result.kind === "endgame")
          post({ moveId, line: result.line, elapsed: result.elapsed });
        else if (result.kind === "limit")
          post({ moveId, limit: result.message, elapsed: result.elapsed });
        else
          throw new Error(
            result.kind === "error"
              ? result.message
              : "Unexpected endgame result.",
          );
      },
      workerLimit,
    );
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
