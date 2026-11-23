import type { Lexicon } from "../shared/lexicon";
import { computeWorkerLimit } from "./compute-workers";
import {
  createCandidateAnalyzer,
  type CandidateJob,
  type CandidateRequest,
  type CandidateResult,
} from "./candidate-analysis-jobs";

const defaultWorker = () =>
  new Worker(new URL("./candidate-analysis.worker.ts", import.meta.url), {
    type: "module",
  });

function requestCandidate(worker: Worker, request: CandidateRequest, signal: AbortSignal) {
  let workerCleanup: (() => void) | undefined;
  return new Promise<CandidateResult>((resolve, reject) => {
    const cancel = () => reject(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    worker.onmessage = ({ data }: MessageEvent<CandidateResult>) => resolve(data);
    worker.onerror = (event) => {
      event.preventDefault();
      reject(event);
    };
    worker.onmessageerror = reject;
    try {
      worker.postMessage(request);
    } catch (error) {
      reject(error);
    }
    function cleanup() {
      signal.removeEventListener("abort", cancel);
    }
    workerCleanup = cleanup;
  }).finally(() => workerCleanup?.());
}

/** Workers stay initialized across successive batches in one analysis request. */
export function createCandidatePool(
  lexicon: Lexicon,
  concurrency = computeWorkerLimit(),
  createWorker = defaultWorker,
  dedicated = false,
) {
  const slots: { worker?: Worker; initialized: boolean }[] = [];
  const analyze = createCandidateAnalyzer(lexicon);
  let capacity = concurrency;
  let closed = false;
  const abort = new AbortController();

  async function run<Job extends CandidateJob>(
    jobs: readonly Job[],
    receive: (job: Job, result: CandidateResult) => void | Promise<void>,
    // Read shared batch state at dispatch time. An undefined job stops a lane.
    prepare?: (job: Job) => Job | undefined,
  ) {
    let next = 0;
    let stopped = false;
    const count = Math.min(jobs.length, capacity);
    const useWorkers =
      (count > 1 || dedicated) &&
      (createWorker !== defaultWorker || typeof Worker !== "undefined");
    if (useWorkers) {
      while (slots.length < count) {
        try {
          slots.push({ worker: createWorker(), initialized: false });
        } catch {
          // Use the workers that started, or run in the parent worker.
          capacity = slots.length;
          break;
        }
      }
    }

    async function drain(slot?: (typeof slots)[number]) {
      while (!closed && !stopped && next < jobs.length) {
        const original = jobs[next++];
        const job = prepare ? prepare(original) : original;
        if (!job) return;
        let result: CandidateResult;
        if (slot?.worker) {
          try {
            const dictionary = slot.initialized ? undefined : lexicon;
            result = await requestCandidate(slot.worker, { job, dictionary }, abort.signal);
            slot.initialized = true;
          } catch {
            slot.worker.terminate();
            slot.worker = undefined;
            if (closed || stopped) return;
            result = analyze(job);
          }
        } else {
          result = analyze(job);
        }
        if (!closed && !stopped) await receive(job, result);
        if (dedicated && !slot?.worker && next < jobs.length)
          await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    try {
      const active = useWorkers ? slots.slice(0, count) : [];
      await Promise.all(active.length ? active.map(drain) : [drain()]);
    } finally {
      stopped = true;
    }
  }

  function close() {
    closed = true;
    abort.abort();
    for (const { worker } of slots) worker?.terminate();
  }

  return { run, close };
}

export async function runCandidateJobs<Job extends CandidateJob>(
  lexicon: Lexicon,
  jobs: readonly Job[],
  receive: (job: Job, result: CandidateResult) => void | Promise<void>,
  concurrency = computeWorkerLimit(),
  createWorker = defaultWorker,
) {
  const pool = createCandidatePool(lexicon, concurrency, createWorker);
  try {
    await pool.run(jobs, receive);
  } finally {
    pool.close();
  }
}
