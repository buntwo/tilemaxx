import type { Lexicon } from "../shared/lexicon";
import type { HunterPosition } from "../shared/bingo-hunter";
import type { MasterOutcome, MasterAction } from "../shared/master-evaluation";
import {
  masterEndgameCandidates,
  planMaster,
  rankMasterEndgame,
} from "../shared/master-search";
import type { Move } from "../shared/model";
import type { HunterProgress, HunterSummary } from "./parallel-bingo-hunter";
import { createCandidatePool } from "./candidate-analysis-pool";
import type { CandidateJob } from "./candidate-analysis-jobs";
import { styleCandidate, styleEvaluation } from "../shared/style-explanation";

const now = () => performance.timeOrigin + performance.now();

export function createMasterSession(
  lexicon: Lexicon,
  position: HunterPosition,
  moves: readonly Move[],
  workerLimit: number,
) {
  const plan = planMaster(position, moves);
  const { candidates, deals, exact, opponent, settings } = plan;
  const outcomes = new Map<MasterAction, MasterOutcome[]>();
  const blocked = new Set<MasterAction>();
  let finalists: MasterAction[] | undefined;
  let endgames: Map<MasterAction, number> | undefined;
  let endgameSlate: MasterAction[] = [];
  let limited = false;
  let stalled = false;
  let done = !candidates.length;
  const screenCount = exact ? deals.length : settings.first;

  function commonCount(slate: readonly MasterAction[], max: number) {
    return slate.length
      ? Math.min(
          max,
          ...slate.map((action) => outcomes.get(action)?.length ?? 0),
        )
      : 0;
  }

  function rankings() {
    const first = plan.rank(outcomes, screenCount);
    const complete =
      finalists && finalists.filter((action) => !blocked.has(action));
    const count = complete && commonCount(complete, deals.length);
    if (count && count > screenCount) {
      const refined = new Set(complete);
      return [
        ...plan
          .rank(outcomes, count)
          .filter(({ action }) => refined.has(action)),
        ...first.filter(({ action }) => !refined.has(action)),
      ];
    }
    return first;
  }

  function snapshot() {
    const rankedByEstimate = rankings();
    const rankingsToShow = endgames
      ? rankMasterEndgame(rankedByEstimate, endgameSlate, endgames)
      : rankedByEstimate;
    const ranked = rankingsToShow.flatMap(({ action, utility }) =>
      action.move ? [{ move: action.move, utility }] : [],
    );
    const [best] = rankingsToShow;
    const passRecommended = !!(done && best && !best.action.move);
    const other = ranked[0];
    return {
      ranked,
      summary: {
        checked: ranked.length,
        limited,
        canContinue: !done,
        finalistsRefined:
          !!endgames?.size || (best?.utility.samples ?? 0) > screenCount,
        passRecommended,
        passExplanation: passRecommended ? {
          kind: "pass", style: "master", provisional: limited,
          evaluation: styleEvaluation({ ...best.utility, rank: 1 }),
          alternative: other && styleCandidate(other.move, { ...other.utility, rank: 2 }),
        } : undefined,
      } satisfies HunterSummary,
    };
  }

  async function run(
    signal: AbortSignal,
    progress: (update: HunterProgress) => void,
    budgetMs: number,
  ) {
    signal.throwIfAborted();
    if (done || budgetMs <= 0) return snapshot();
    const deadline = now() + budgetMs;
    let advanced = false;
    const workers = createCandidatePool(
      lexicon,
      Math.min(workerLimit, 8),
      undefined,
      true,
    );
    const stop = () => workers.close();
    signal.addEventListener("abort", stop, { once: true });
    async function batch(
      slate: readonly MasterAction[],
      count: number,
      stage: number,
    ) {
      const ready = (action: MasterAction) =>
        blocked.has(action) || (outcomes.get(action)?.length ?? 0) >= count;
      const phase = exact
        ? ("exact" as const)
        : stage === 1
          ? ("master-screen" as const)
          : ("master-refine" as const);
      const pending = slate.filter((action) => !ready(action));
      let checked = slate.length - pending.length;
      const update = () =>
        progress({ phase, stage, done: checked, total: slate.length });
      update();
      await workers.run(
        pending.map(
          (action) =>
            ({
              kind: "master-deals",
              position,
              action,
              policy: settings,
              deals: deals.slice(outcomes.get(action)?.length ?? 0, count),
              deadline,
            }) satisfies CandidateJob,
        ),
        (job, result) => {
          if (result.kind === "error") throw new Error(result.message);
          if (result.kind !== job.kind)
            throw new Error("Could not finish the Master simulation.");
          const saved = outcomes.get(job.action) ?? [];
          saved.push(...result.outcomes);
          advanced ||= !!result.outcomes.length || !!result.blocked;
          outcomes.set(job.action, saved);
          if (result.blocked) {
            blocked.add(job.action);
            limited = true;
          }
          if (ready(job.action)) checked++;
          update();
        },
        (job) => (now() < deadline ? job : undefined),
      );
      signal.throwIfAborted();
      return checked === slate.length;
    }

    function pause() {
      if (!advanced && stalled) {
        limited = true;
        done = true;
      }
      stalled = !advanced;
      return snapshot();
    }

    try {
      if (!finalists) {
        if (!(await batch(candidates, screenCount, 1))) return pause();
        finalists = plan
          .rank(outcomes, screenCount)
          .slice(0, settings.finalists)
          .map(({ action }) => action);
      }
      if (!exact && !(await batch(finalists, deals.length, 2))) return pause();
      const slate = masterEndgameCandidates(
        plan,
        position,
        plan.rank(outcomes, screenCount),
      );
      endgameSlate = slate;
      if (opponent !== undefined && slate.length) {
        let checked = 0;
        const exactSpreads = new Map<MasterAction, number>();
        progress({
          phase: "master-endgame",
          stage: 2,
          done: checked,
          total: slate.length,
        });
        await workers.run(
          slate.map(
            (action) =>
              ({
                kind: "master-endgame",
                position,
                action,
                opponent,
                deadline,
              }) satisfies CandidateJob,
          ),
          (job, result) => {
            if (result.kind === "error") throw new Error(result.message);
            if (result.kind !== job.kind)
              throw new Error("Could not finish the Master endgame.");
            if (result.spread !== undefined)
              exactSpreads.set(job.action, result.spread);
            progress({
              phase: "master-endgame",
              stage: 2,
              done: ++checked,
              total: slate.length,
            });
          },
          (job) => (now() < deadline ? job : undefined),
        );
        signal.throwIfAborted();
        // Keep the common-deal estimate when any of the compared lines times out.
        if (exactSpreads.size === slate.length) endgames = exactSpreads;
        else limited = true;
      }
      done = true;
      return snapshot();
    } finally {
      signal.removeEventListener("abort", stop);
      stop();
    }
  }
  return { run };
}
