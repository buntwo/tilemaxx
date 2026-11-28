import type { RackBingoIndex } from "../shared/bingo-odds";
import type { Lexicon } from "../shared/lexicon";
import {
  planOptimalExchange,
  type ExchangeProgress,
  type OptimalExchangeRequest,
} from "../shared/optimal-exchange";
import type { CandidateJob } from "./candidate-analysis-jobs";
import { createCandidatePool } from "./candidate-analysis-pool";

export async function parallelOptimalExchange(
  lexicon: Lexicon,
  rackIndex: RackBingoIndex,
  request: OptimalExchangeRequest,
  progress: (progress: ExchangeProgress) => void,
  workerLimit: number,
  createWorker?: () => Worker,
  options?: Parameters<typeof planOptimalExchange>[4],
) {
  const pool = createCandidatePool(lexicon, workerLimit, createWorker);
  const { board, template, scorelessTurns } = request;
  const position = { board, template, scorelessTurns };
  const plan = planOptimalExchange(lexicon, rackIndex, request, progress, options);
  try {
    let step = plan.next();
    while (!step.done) {
      const batch = step.value;
      const screening = batch.kind === "exchange-racks";
      const count = screening ? batch.racks.length : batch.deals.length;
      const stride = screening ? 1 : batch.swaps.length;
      const deadline = performance.timeOrigin + batch.deadline;
      const jobs: Extract<
        CandidateJob,
        { kind: "exchange-racks" | "exchange-replies" }
      >[] = [];
      const size =
        workerLimit > 1 ? Math.ceil(count / (workerLimit * 2)) : count;
      for (let start = 0; start < count; start += size) {
        const job = { position, offset: start * stride, deadline };
        jobs.push(
          screening
            ? {
                ...job,
                kind: batch.kind,
                racks: batch.racks.slice(start, start + size),
              }
            : {
                ...job,
                kind: batch.kind,
                swaps: batch.swaps,
                deals: batch.deals.slice(start, start + size),
              },
        );
      }
      const hits: (boolean | undefined)[] = Array(count * stride);
      await pool.run(jobs, (job, result) => {
        if (job.kind !== result.kind)
          throw new Error(
            result.kind === "error"
              ? result.message
              : "Unexpected exchange result.",
          );
        for (const [i, hit] of result.hits.entries())
          hits[job.offset + i] = hit;
      });
      step = plan.next(hits);
    }
    return step.value;
  } finally {
    pool.close();
  }
}
