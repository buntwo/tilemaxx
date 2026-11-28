import type { BingoDeal } from "./bingo-replies";
import type { createMasterEvaluator, MasterOutcome } from "./master-evaluation";
import { SearchLimitError } from "./solver";

export const INITIAL_LEARNER_DEALS = 8;
export const LEARNER_REPLY_DEALS = 32;
const FOLLOW_UP_RESERVE_MS = 350;

export function* evaluateSharedBatch<T>(
  candidates: readonly ((deal: BingoDeal, deadline: number) => T)[],
  deals: readonly BingoDeal[],
  deadline: number,
): Generator<void, T[][], void> {
  const batch: T[][] = [];
  for (const evaluate of candidates) {
    const results: T[] = [];
    for (const deal of deals) {
      if (performance.now() >= deadline) throw new SearchLimitError("time");
      results.push(evaluate(deal, deadline));
      yield;
    }
    batch.push(results);
  }
  if (performance.now() >= deadline) throw new SearchLimitError("time");
  return batch;
}

export function* screenLearnerReplies(
  evaluators: readonly ReturnType<typeof createMasterEvaluator>[],
  deals: readonly BingoDeal[],
  deadline: number,
) {
  const totals = evaluators.map(() => 0);
  const scoreReply = evaluators.map((evaluate) =>
    (deal: BingoDeal, until: number) => evaluate.opponentReply(deal, until)?.score ?? 0,
  );
  let replyDeals = 0;
  try {
    for (const count of [INITIAL_LEARNER_DEALS, 16, LEARNER_REPLY_DEALS]) {
      const batch = yield* evaluateSharedBatch(
        scoreReply, deals.slice(replyDeals, count), deadline - FOLLOW_UP_RESERVE_MS,
      );
      for (const [index, scores] of batch.entries())
        totals[index] += scores.reduce((sum, score) => sum + score, 0);
      replyDeals = count;
    }
  } catch (error) {
    if (!(error instanceof SearchLimitError)) throw error;
  }

  const outcomes: MasterOutcome[][] = evaluators.map(() => []);
  if (replyDeals) {
    try {
      for (const count of [4, INITIAL_LEARNER_DEALS]) {
        const batch = yield* evaluateSharedBatch(
          evaluators, deals.slice(outcomes[0].length, count), deadline,
        );
        for (const [index, results] of batch.entries()) outcomes[index].push(...results);
      }
    } catch (error) {
      if (!(error instanceof SearchLimitError)) throw error;
    }
  }
  return { replyDeals, totals, outcomes };
}
