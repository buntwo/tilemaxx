import type { Lexicon } from "../shared/lexicon";
import type { Move } from "../shared/model";
import type { ReplyPosition } from "../shared/reply-analysis";
import {
  createCandidateAnalyzer,
  type CandidateRequest,
  type CandidateResult,
} from "./candidate-analysis-jobs";

type Slot = {
  worker?: Worker;
  initialized: boolean;
  cancel?: () => void;
  analyze: ReturnType<typeof createCandidateAnalyzer>;
};

/** Keep each move on its original lane so another slice reuses the same table.
 * Exact searches have large tables: at most two lanes stay resident, regardless
 * of the browser's hardware hint. The compute setting can lower this further.
 */
export function createEndgamePrecompute(
  lexicon: Lexicon,
  position: ReplyPosition,
  moves: Move[],
  workerLimit: number,
  createWorker = () =>
    new Worker(new URL("./candidate-analysis.worker.ts", import.meta.url), {
      type: "module",
    }),
) {
  const count = Math.max(1, Math.min(2, workerLimit, moves.length));
  const slots: Slot[] = Array.from({ length: count }, () => ({
    initialized: false,
    analyze: createCandidateAnalyzer(lexicon),
  }));
  const lanes = new Map(moves.map((move, index) => [move.id, index % count]));
  let closed = false,
    running = false;
  async function compute(
    slot: Slot,
    request: CandidateRequest,
  ): Promise<CandidateResult> {
    if (count > 1 && !slot.initialized && !slot.worker) {
      try {
        slot.worker = createWorker();
      } catch {
        slot.initialized = true;
      }
    }
    if (slot.worker) {
      try {
        const worker = slot.worker;
        const result = await new Promise<CandidateResult>((resolve, reject) => {
          slot.cancel = () => reject(new Error("Endgame batch canceled."));
          worker.onmessage = ({ data }: MessageEvent<CandidateResult>) =>
            resolve(data);
          worker.onerror = (event) => {
            event.preventDefault();
            reject(new Error("Endgame worker stopped."));
          };
          worker.onmessageerror = () =>
            reject(new Error("Endgame worker message could not be read."));
          worker.postMessage({
            ...request,
            dictionary: slot.initialized ? undefined : lexicon,
          });
          slot.initialized = true;
        });
        slot.cancel = undefined;
        return result;
      } catch {
        slot.worker?.terminate();
        slot.worker = undefined;
        slot.initialized = true;
      }
    }
    slot.cancel = undefined;
    if (closed) return { kind: "error", message: "Endgame batch canceled." };
    return slot.analyze(request.job);
  }
  return {
    async run(
      candidates: Move[],
      timeLimitMs: 5_000 | 10_000,
      receive: (move: Move, result: CandidateResult) => void,
    ) {
      if (closed || running)
        throw new Error("Endgame batch is unavailable or already running.");
      if (candidates.some((move) => !lanes.has(move.id)))
        throw new Error("Endgame candidate belongs to another position.");
      running = true;
      try {
        await Promise.all(
          slots.map(async (slot, index) => {
            for (const move of candidates.filter(
              (move) => lanes.get(move.id) === index,
            )) {
              if (closed) return;
              const result = await compute(slot, {
                job: { kind: "endgame", position, move, timeLimitMs },
              });
              if (closed) return;
              receive(move, result);
              // Let a single-worker parent process cancel or query messages.
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
          }),
        );
      } finally {
        running = false;
      }
    },
    close() {
      closed = true;
      for (const slot of slots) {
        slot.worker?.terminate();
        slot.cancel?.();
      }
    },
  };
}
