import { limitedCandidateWorker } from "./api-worker-adapter";
import { parentPort, workerData } from "node:worker_threads";
import { Lexicon } from "../shared/lexicon";
import {
  inferWordfeudPremiums,
  openingSequences,
} from "../shared/infer-premiums";
import { isWordfeudRules } from "../shared/model";
import { ReplySearchLimitError } from "../shared/reply-analysis";
import { SearchLimitError } from "../shared/solver";
import { analyzePosition } from "./api-analysis";
import { buildDictionaryIndex, buildPlayerIndex, loadDictionaryWords, needsPlayerIndex,
  type ApiAnalysisIndexes } from "./api-analysis-index";
import type { ComputationResult, ComputationWorkerInput } from "./api-computation";
import { ApiError } from "./api-error";
import { readScreenshot } from "./api-screenshot";

const builtIndexes: ApiAnalysisIndexes = {};

async function compute(input: ComputationWorkerInput) {
  if (input.kind === "screenshot") return readScreenshot(input.request);
  if (input.kind === "premium-inference") {
    const { board, template, squares, sequence, scores } = input.request;
    if (!isWordfeudRules(template.rules))
      throw new ApiError(
        422,
        "Opening score inference requires Wordfeud rules.",
      );
    const turns = openingSequences(board, template);
    if (!scores) return { sequences: turns };
    const selected = turns[sequence ?? 0];
    if (!selected || scores.length !== selected.length)
      throw new ApiError(
        422,
        "Provide one score or null for each turn in the selected opening sequence.",
      );
    return inferWordfeudPremiums(template, selected, squares, scores);
  }
  if (input.kind === "word-check") {
    const list = new Set(loadDictionaryWords(input.dictionary));
    return input.words.map((entry) => {
      const word = entry.toUpperCase();
      return { word, found: list.has(word) };
    });
  }
  const workerLimit = input.threadLimit - 1;
  globalThis.Worker = limitedCandidateWorker(workerLimit) as unknown as typeof Worker;
  let words: string[] | undefined;
  const graph = input.indexes?.dictionary ??
    (builtIndexes.dictionary = buildDictionaryIndex(words = loadDictionaryWords(input.dictionary)));
  const lexicon = Lexicon.fromIndex(graph);
  const profiles = !needsPlayerIndex(input) ? undefined : input.indexes?.profiles ??
    (builtIndexes.profiles = buildPlayerIndex(input.root, lexicon,
      words ?? [...lexicon.words()].sort(), input.position.template, input.profileVocabulary));
  return analyzePosition(lexicon, input, workerLimit, profiles);
}

function errorResult(error: unknown): ComputationResult {
  if (error instanceof ApiError)
    return { error: { status: error.status, message: error.message } };
  if (
    error instanceof SearchLimitError ||
    error instanceof ReplySearchLimitError
  )
    return { error: { status: 422, message: error.message } };
  if (error instanceof Error && !("code" in error))
    return { error: { status: 422, message: error.message } };
  console.error(error);
  return {
    error: { status: 500, message: "The computation stopped unexpectedly." },
  };
}

void compute(workerData as ComputationWorkerInput).then(
  (result) => parentPort!.postMessage({ result, builtIndexes } satisfies ComputationResult),
  (error) => parentPort!.postMessage({ ...errorResult(error), builtIndexes }),
);
