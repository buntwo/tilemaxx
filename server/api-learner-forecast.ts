import { createLearnerLookahead, type LearnerLineWork } from "../shared/learner-lookahead";
import type { Lexicon } from "../shared/lexicon";
import type { MasterOutcome } from "../shared/master-evaluation";
import type { BoardTemplate, Move } from "../shared/model";
import type { createPlayerProfiles, LearnerStyle, ProfilePosition } from "../shared/player-profiles";
import { createCandidateAnalyzer, type CandidateJob } from "../src/candidate-analysis-jobs";
import { createCandidatePool } from "../src/candidate-analysis-pool";

type ForecastOptions = {
  root: string;
  vocabulary?: Uint8Array;
  workerLimit: number;
  reference?: Move;
};

async function evaluateFinalists(
  lexicon: Lexicon,
  choose: ReturnType<typeof createPlayerProfiles>,
  work: LearnerLineWork,
  { root, vocabulary, workerLimit }: ForecastOptions,
) {
  const outcomes = work.actions.map((): MasterOutcome[] => []);
  const jobs = work.actions.map((action, index) => ({
    kind: "learner-lines",
    position: work.position,
    action,
    deals: work.deals,
    deadline: performance.timeOrigin + work.deadline,
    root,
    vocabulary,
    index,
  }) satisfies CandidateJob & { index: number });
  const analyze = createCandidateAnalyzer(lexicon, () => choose);
  const local = jobs[workerLimit];
  const pool = createCandidatePool(
    lexicon, workerLimit, undefined, true, analyze,
  );
  function receive(job: typeof jobs[number], result: ReturnType<typeof analyze>) {
    if (result.kind === "error") throw new Error(result.message);
    if (result.kind !== job.kind) throw new Error("Could not evaluate the Learner finalist.");
    outcomes[job.index] = result.outcomes;
  }
  try {
    await Promise.all([
      pool.run(jobs.slice(0, workerLimit), receive),
      Promise.resolve().then(() => {
        if (local) receive(local, analyze(local));
      }),
    ]);
  } finally {
    pool.close();
  }
  return outcomes;
}

export async function forecastLearner(
  lexicon: Lexicon,
  template: BoardTemplate,
  choose: ReturnType<typeof createPlayerProfiles>,
  style: LearnerStyle,
  moves: readonly Move[],
  position: ProfilePosition,
  options: ForecastOptions,
) {
  const { reference, workerLimit } = options;
  const { considered, learnerSlate } = reference ? {} : choose(moves, style, position, {
    all: true,
    learnerSlate: true,
  });
  const finalists = learnerSlate?.length ?? 0;
  const parallel = style === "learner" && finalists >= 2 && workerLimit + 1 >= finalists;
  const forecast = createLearnerLookahead(lexicon, template, choose, style, parallel);
  const work = forecast(position, considered ?? [], learnerSlate ?? [], undefined, reference);
  let step = work.next();
  while (!step.done) {
    const outcomes = step.value
      ? await evaluateFinalists(lexicon, choose, step.value, options)
      : undefined;
    step = work.next(outcomes);
  }
  return step.value;
}
