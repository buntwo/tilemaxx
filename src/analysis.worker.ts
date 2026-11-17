import { loadWordList } from "./word-list-cache";
import { Lexicon, parseWords } from "../shared/lexicon";
import { analyzeMoves, type AnalysisRequest } from "../shared/move-analysis";
import { createEndgamePrecompute } from "./endgame-precompute";
import {
  parallelOpponentEndgame,
  type OpponentEndgameMessage,
  type OpponentEndgameRequest,
} from "./parallel-opponent-endgame";
import type {
  EndgamePrecomputeMessage,
  EndgamePrecomputeRequest,
} from "./useEndgameLines";

let dictionary: { id: string; lexicon: Lexicon } | undefined;
let endgames:
  | { key: string; pool: ReturnType<typeof createEndgamePrecompute> }
  | undefined;
let familiar: Set<string> | undefined;

async function words(url: string) {
  return parseWords((await loadWordList(url)).text);
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
    const { dictionaryId, moves, workerLimit, kind, id, ...position } = request;
    const key = JSON.stringify([dictionaryId, position]);
    if (kind === "precompute-endgames") {
      endgames?.pool.close();
      const lexicon = await loadDictionary(dictionaryId);
      endgames = {
        key,
        pool: createEndgamePrecompute(lexicon, position, moves, workerLimit),
      };
    }
    if (!endgames || endgames.key !== key)
      throw new Error("This endgame position is no longer active.");
    await endgames.pool.run(
      moves,
      kind === "continue-endgames" ? 10_000 : 5_000,
      (move, result) => {
        const { id: moveId } = move;
        if (result.kind === "endgame")
          post({ id, moveId, line: result.line, elapsed: result.elapsed });
        else if (result.kind === "limit")
          post({ id, moveId, limit: result.message, elapsed: result.elapsed });
        else
          throw new Error(
            result.kind === "error"
              ? result.message
              : "Unexpected endgame result.",
          );
      },
    );
    post({ id: request.id, done: true });
  } catch (error) {
    endgames?.pool.close();
    endgames = undefined;
    post({
      id: request.id,
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
    | EndgamePrecomputeRequest
    | OpponentEndgameRequest
    | (AnalysisRequest & { dictionaryId: string })
  >,
) => {
  const request = event.data;
  if ("kind" in request) {
    if (
      request.kind === "precompute-endgames" ||
      request.kind === "continue-endgames"
    ) {
      await precomputeEndgames(request);
    } else {
      const post = (message: OpponentEndgameMessage) =>
        self.postMessage(message);
      try {
        const { dictionaryId, workerLimit, kind: _, ...position } = request;
        const lexicon = await loadDictionary(dictionaryId);
        const result = await parallelOpponentEndgame(
          lexicon,
          position,
          workerLimit,
          (progress) => post({ progress }),
        );
        post({ result });
      } catch (error) {
        post({
          error:
            error instanceof Error
              ? error.message
              : "The opponent endgame stopped unexpectedly.",
        });
      }
    }
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
