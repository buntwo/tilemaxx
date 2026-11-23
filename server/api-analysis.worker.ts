import { readFileSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import { Lexicon, parseWords } from "../shared/lexicon";
import {
  inferWordfeudPremiums,
  openingSequences,
} from "../shared/infer-premiums";
import { isWordfeudRules } from "../shared/model";
import { ReplySearchLimitError } from "../shared/reply-analysis";
import { SearchLimitError } from "../shared/solver";
import { analyzePosition } from "./api-analysis";
import type { Computation, ComputationResult } from "./api-computation";
import { ApiError } from "./api-error";
import { readScreenshot } from "./api-screenshot";

async function compute(input: Computation) {
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
  const { dictionary } = input;
  let text: string;
  try {
    text =
      "text" in dictionary
        ? dictionary.text
        : readFileSync(dictionary.file, "utf8");
  } catch {
    throw new ApiError(404, "Word list is unavailable.");
  }
  const words = parseWords(text);
  if (!words.length)
    throw new ApiError(422, "The word list contains no valid entries.");
  if (input.kind === "word-check") {
    const list = new Set(words);
    return input.words.map((entry) => {
      const word = entry.toUpperCase();
      return { word, found: list.has(word) };
    });
  }
  return analyzePosition(new Lexicon(words), words, input);
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

void compute(workerData as Computation).then(
  (result) => parentPort!.postMessage({ result } satisfies ComputationResult),
  (error) => parentPort!.postMessage(errorResult(error)),
);
