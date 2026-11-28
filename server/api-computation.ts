import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import type { Worker } from "node:worker_threads";
import type { z } from "zod";
import type {
  analysisRequest,
  boardPosition,
  inferPremiumsRequest,
  screenshotRequest,
} from "./api-analysis-request";
import type { Game } from "../shared/model";
import type { LexiconIndex } from "../shared/lexicon";
import type { PlayerProfileIndex } from "../shared/player-profile-index";
import { wordFrequencyLanguage } from "../shared/word-familiarity";
import { needsPlayerIndex, type ApiAnalysisIndexes } from "./api-analysis-index";
import { ApiError } from "./api-error";
import { startApiThread } from "./api-thread";

type Dictionary = { file: string } | { text: string };
export type Computation =
  | {
      kind: "analysis";
      dictionary: Dictionary;
      position: z.infer<typeof boardPosition>;
      operation: z.infer<typeof analysisRequest>["operation"];
      game?: Game;
      savedScoreSpread?: number;
      profileVocabulary?: Uint8Array;
      root: string;
    }
  | { kind: "word-check"; dictionary: Dictionary; words: string[] }
  | { kind: "premium-inference"; request: z.infer<typeof inferPremiumsRequest> }
  | { kind: "screenshot"; request: z.infer<typeof screenshotRequest> };

export type ComputationResult =
  ({ result: unknown } | { error: { status: number; message: string } }) &
  { builtIndexes?: ApiAnalysisIndexes };

export type ComputationWorkerInput = Computation & {
  threadLimit: number;
  indexes?: ApiAnalysisIndexes;
};

const builtWorker = new URL("./api-analysis.worker.js", import.meta.url);
const sourceWorker = new URL("./api-analysis.worker.ts", import.meta.url);
const concurrency = 1;
const timeout = 210_000;
const maxCachedIndexes = 4;

function rememberIndex<T>(cache: Map<string, T>, key: string | undefined, built?: T) {
  if (key === undefined) return;
  const value = built ?? cache.get(key);
  if (value === undefined) return;
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > maxCachedIndexes) cache.delete(cache.keys().next().value!);
  return value;
}

export function analysisThreadLimit(value = process.env.TILEMAXX_ANALYSIS_THREADS) {
  const limit = value === undefined ? 10 : Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("TILEMAXX_ANALYSIS_THREADS must be a positive integer.");
  return limit;
}

export function createComputationRunner() {
  const threadLimit = analysisThreadLimit();
  const dictionaries = new Map<string, LexiconIndex>();
  const profiles = new Map<string, PlayerProfileIndex>();
  let active = 0;
  return async (
    signal: AbortSignal,
    prepare: () => Computation | Promise<Computation>,
  ) => {
    if (active >= concurrency)
      throw new ApiError(429, "Tilemaxx is busy. Retry in a few seconds.");
    signal.throwIfAborted();
    active++;
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    try {
      const input = await prepare();
      let dictionaryKey: string | undefined;
      let profileKey: string | undefined;
      if (input.kind === "analysis" && "file" in input.dictionary) {
        const { file } = input.dictionary;
        const info = await stat(file).catch(() => {
          throw new ApiError(404, "Word list is unavailable.");
        });
        dictionaryKey = JSON.stringify([file, info.ino, info.size, info.mtimeMs, info.ctimeMs]);
        if (needsPlayerIndex(input)) {
          const vocabulary = input.profileVocabulary &&
            createHash("sha256").update(input.profileVocabulary).digest("hex");
          profileKey = JSON.stringify([dictionaryKey, input.root,
            wordFrequencyLanguage(input.position.template.rules), vocabulary]);
        }
      }
      const indexes = {
        dictionary: rememberIndex(dictionaries, dictionaryKey),
        profiles: rememberIndex(profiles, profileKey),
      };
      signal.throwIfAborted();
      const thread = startApiThread(builtWorker, sourceWorker,
        { ...input, ...(indexes.profiles && { profileVocabulary: undefined }),
          threadLimit, indexes } satisfies ComputationWorkerInput);
      worker = thread;
      const reply = await new Promise<ComputationResult>((resolve, reject) => {
        cancel = () => reject(signal.reason);
        signal.addEventListener("abort", cancel, { once: true });
        timer = setTimeout(
          () =>
            reject(
              new ApiError(504, "The computation exceeded its time limit."),
            ),
          timeout,
        );
        thread.once("message", resolve);
        thread.once("error", reject);
        thread.once("exit", (code) =>
          reject(new Error(`Computation worker exited with code ${code}.`)),
        );
      });
      rememberIndex(dictionaries, dictionaryKey, reply.builtIndexes?.dictionary);
      rememberIndex(profiles, profileKey, reply.builtIndexes?.profiles);
      if ("error" in reply)
        throw new ApiError(reply.error.status, reply.error.message);
      return reply.result;
    } finally {
      clearTimeout(timer);
      if (cancel) signal.removeEventListener("abort", cancel);
      try {
        await worker?.terminate();
      } finally {
        active--;
      }
    }
  };
}
