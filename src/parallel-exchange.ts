import type { RackBingoIndex } from "../shared/bingo-odds";
import type { Lexicon } from "../shared/lexicon";
import {
  planOptimalExchange,
  type OptimalExchangeRequest,
} from "../shared/optimal-exchange";
import type { CandidateJob } from "./candidate-analysis-jobs";
import { createCandidatePool } from "./candidate-analysis-pool";

export async function parallelOptimalExchange(
  lexicon: Lexicon,
  rackIndex: RackBingoIndex,
  request: OptimalExchangeRequest,
  progress: (completed: number, total: number) => void,
  workerLimit: number,
  createWorker?: () => Worker,
) {
  const pool = createCandidatePool(lexicon, workerLimit, createWorker);
  const position = { board: request.board, template: request.template };
  const plan = planOptimalExchange(lexicon, rackIndex, request, progress);
  try {
    let step = plan.next();
    while (!step.done) {
      const { racks, deadline } = step.value;
      const jobs: CandidateJob[] = [];
      const size =
        workerLimit > 1
          ? Math.ceil(racks.length / (workerLimit * 2))
          : racks.length;
      for (let offset = 0; offset < racks.length; offset += size) {
        jobs.push({
          kind: "exchange-racks",
          position,
          offset,
          racks: racks.slice(offset, offset + size),
          deadline: performance.timeOrigin + deadline,
        });
      }
      const hits: (boolean | undefined)[] = Array(racks.length);
      await pool.run(jobs, (job, result) => {
        if (job.kind !== "exchange-racks" || result.kind !== "exchange-racks")
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
