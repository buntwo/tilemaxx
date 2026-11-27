import { loadWordList } from "./word-list-cache";
import { Lexicon, parseWords } from "../shared/lexicon";
import { analyzeMoves, type AnalysisRequest } from "../shared/move-analysis";
import { createPlayerProfiles } from "../shared/player-profiles";
import { loadProfileVocabulary } from "./word-frequencies";
import { createEndgamePrecompute } from "./endgame-precompute";
import {
  createExactEndgameSearch,
  type ExactEndgameContinuation,
  type ExactEndgameRequest,
  type OpponentEndgameMessage,
} from "./parallel-opponent-endgame";
import type {
  EndgamePrecomputeMessage,
  EndgamePrecomputeRequest,
} from "./useEndgameLines";

let dictionary: { id: string; lexicon: Lexicon; words: string[] } | undefined;
let endgames:
  | { key: string; pool: ReturnType<typeof createEndgamePrecompute> }
  | undefined;
let exactEndgame: ReturnType<typeof createExactEndgameSearch> | undefined;

async function words(url: string) {
  return parseWords((await loadWordList(url)).text);
}

async function loadDictionary(id: string) {
  if (dictionary?.id !== id) {
    const list = await words(`/api/dictionaries/${encodeURIComponent(id)}`);
    dictionary = { id, lexicon: new Lexicon(list), words: list };
  }
  return dictionary;
}

async function precomputeEndgames(request: EndgamePrecomputeRequest) {
  const post = (message: EndgamePrecomputeMessage) => self.postMessage(message);
  try {
    const { dictionaryId, moves, workerLimit, kind, id, ...position } = request;
    const key = JSON.stringify([dictionaryId, position]);
    if (kind === "precompute-endgames") {
      endgames?.pool.close();
      const { lexicon } = await loadDictionary(dictionaryId);
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
    | ExactEndgameRequest
    | ExactEndgameContinuation
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
        if (request.kind !== "continue-exact-endgame") {
          const { dictionaryId, workerLimit, kind, ...position } = request;
          const { lexicon } = await loadDictionary(dictionaryId);
          exactEndgame = createExactEndgameSearch(
            lexicon,
            { ...position, firstPlayer: kind === "solve-own-endgame" ? "you" : "opponent" },
            workerLimit,
          );
        }
        if (!exactEndgame) throw new Error("This endgame search is no longer active.");
        const result = await exactEndgame.run((progress) => post({ progress }));
        if (result.checked === result.total) exactEndgame = undefined;
        post({ result });
      } catch (error) {
        exactEndgame = undefined;
        post({
          error:
            error instanceof Error
              ? error.message
              : "The endgame search stopped unexpectedly.",
        });
      }
    }
    return;
  }
  try {
    const dictionary = await loadDictionary(request.dictionaryId);
    const { lexicon } = dictionary;
    const [frequencies, vocabulary] = await loadProfileVocabulary(request.template.rules, dictionary);
    const profiles = createPlayerProfiles(lexicon, request.template, frequencies, undefined, vocabulary);
    const result = analyzeMoves(lexicon, request, profiles, (progress) => {
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
