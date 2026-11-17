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

function requestCandidate(worker: Worker, request: CandidateRequest) {
  return new Promise<CandidateResult>((resolve, reject) => {
    worker.onmessage = ({ data }: MessageEvent<CandidateResult>) =>
      resolve(data);
    worker.onerror = (event) => {
      event.preventDefault();
      reject(event);
    };
    worker.onmessageerror = reject;
    worker.postMessage(request);
  });
}

/** Workers stay initialized across successive batches in one analysis request. */
export function createCandidatePool(
  lexicon: Lexicon,
  concurrency = computeWorkerLimit(),
  createWorker = defaultWorker,
) {
  const slots: { worker?: Worker; initialized: boolean }[] = [];
  const analyze = createCandidateAnalyzer(lexicon);
  let capacity = concurrency;
  let closed = false;

  async function run<Job extends CandidateJob>(
    jobs: readonly Job[],
    receive: (job: Job, result: CandidateResult) => void | Promise<void>,
    // Read shared batch state at dispatch time. An undefined job stops a lane.
    prepare?: (job: Job) => Job | undefined,
  ) {
    let next = 0;
    let stopped = false;
    const count = Math.min(jobs.length, capacity);
    if (count > 1) {
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
            result = await requestCandidate(slot.worker, { job, dictionary });
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
      }
    }

    try {
      const active = count > 1 ? slots.slice(0, count) : [];
      await Promise.all(active.length ? active.map(drain) : [drain()]);
    } finally {
      stopped = true;
    }
  }

  function close() {
    closed = true;
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
