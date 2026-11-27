import type { Worker } from "node:worker_threads";
import type { z } from "zod";
import type {
  analysisRequest,
  boardPosition,
  inferPremiumsRequest,
  screenshotRequest,
} from "./api-analysis-request";
import type { Game } from "../shared/model";
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
  | { result: unknown }
  | { error: { status: number; message: string } };

const builtWorker = new URL("./api-analysis.worker.js", import.meta.url);
const sourceWorker = new URL("./api-analysis.worker.ts", import.meta.url);
const concurrency = 1;
const timeout = 210_000;

export function createComputationRunner() {
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
      signal.throwIfAborted();
      const thread = startApiThread(builtWorker, sourceWorker, input);
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
