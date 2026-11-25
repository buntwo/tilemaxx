import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { z } from "zod";
import type {
  analysisRequest,
  boardPosition,
  inferPremiumsRequest,
  screenshotRequest,
} from "./api-analysis-request";
import type { Game } from "../shared/model";
import { ApiError } from "./api-error";

type Dictionary = { file: string } | { text: string };
export type Computation =
  | {
      kind: "analysis";
      dictionary: Dictionary;
      position: z.infer<typeof boardPosition>;
      operation: z.infer<typeof analysisRequest>["operation"];
      game?: Game;
      profileVocabulary?: Uint8Array;
      root: string;
    }
  | { kind: "word-check"; dictionary: Dictionary; words: string[] }
  | { kind: "premium-inference"; request: z.infer<typeof inferPremiumsRequest> }
  | { kind: "screenshot"; request: z.infer<typeof screenshotRequest> };

export type ComputationResult =
  | { result: unknown }
  | { error: { status: number; message: string } };

const builtWorker = new URL("./api-analysis.worker.js", import.meta.url);
const sourceWorker = new URL("./api-analysis.worker.ts", import.meta.url);
const concurrency = 1;
const timeout = 210_000;

export function createComputationRunner() {
  let active = 0;
  return async (input: Computation, signal: AbortSignal) => {
    if (active >= concurrency)
      throw new ApiError(429, "Tilemaxx is busy. Retry in a few seconds.");
    signal.throwIfAborted();
    active++;
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    try {
      worker = existsSync(builtWorker)
        ? new Worker(builtWorker, { workerData: input, execArgv: [] })
        : new Worker(
            'require("tsx/cjs"); require(require("node:worker_threads").workerData.entry);',
            {
              eval: true,
              workerData: { ...input, entry: fileURLToPath(sourceWorker) },
              execArgv: [],
            },
          );
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
        worker!.once("message", resolve);
        worker!.once("error", reject);
        worker!.once("exit", (code) =>
          reject(new Error(`Computation worker exited with code ${code}.`)),
        );
      });
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
