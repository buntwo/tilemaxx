import type { Lexicon } from "../shared/lexicon";
import {
  analyzeCandidate,
  type CandidateJob,
  type CandidateRequest,
  type CandidateResult,
} from "./candidate-analysis-jobs";

const defaultWorker = () =>
  new Worker(new URL("./candidate-analysis.worker.ts", import.meta.url), {
    type: "module",
  });

function workerCount() {
  const mobile = /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent);
  return Math.min(mobile ? 2 : 4, navigator.hardwareConcurrency || 2);
}

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

/** Each active worker pulls another move as soon as its current move is done. */
export async function runCandidateJobs(
  lexicon: Lexicon,
  jobs: readonly CandidateJob[],
  receive: (job: CandidateJob, result: CandidateResult) => void | Promise<void>,
  createWorker = defaultWorker,
  concurrency = workerCount(),
) {
  const workers: Worker[] = [];
  let next = 0;
  let stopped = false;
  const count = Math.min(jobs.length, concurrency);
  if (count > 1) {
    for (let i = 0; i < count; i++) {
      try {
        workers.push(createWorker());
      } catch {
        // Keep using the workers that started, or run in the parent worker.
        break;
      }
    }
  }

  async function run(worker?: Worker) {
    let dictionary: Lexicon | undefined = lexicon;
    while (!stopped && next < jobs.length) {
      const job = jobs[next++];
      let result: CandidateResult;
      if (worker) {
        try {
          result = await requestCandidate(worker, { job, dictionary });
          dictionary = undefined;
        } catch {
          worker.terminate();
          worker = undefined;
          if (stopped) return;
          result = analyzeCandidate(lexicon, job);
        }
      } else {
        result = analyzeCandidate(lexicon, job);
      }
      if (!stopped) await receive(job, result);
    }
  }

  try {
    await Promise.all(workers.length ? workers.map(run) : [run()]);
  } finally {
    stopped = true;
    for (const worker of workers) worker.terminate();
  }
}
