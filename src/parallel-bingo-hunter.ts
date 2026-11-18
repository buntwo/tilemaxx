import {
  bingoNow,
  chooseHunterCandidates,
  exactHunterDeals,
  hunterClose,
  hunterPool,
  hunterScreen,
  hunterUtility,
  sampleHunterDeals,
  HUNTER_CANDIDATES,
  HUNTER_CHECKPOINT,
  HUNTER_FINALISTS,
  HUNTER_INITIAL,
  HUNTER_MAX,
  type HunterDeal,
  type HunterPosition,
  type RankedHunterMove,
} from "../shared/bingo-hunter";
import type { RackOdds } from "../shared/bingo-odds";
import type { Lexicon } from "../shared/lexicon";
import type { Move } from "../shared/model";
import { randomGenerator } from "../shared/move-analysis";
import { profileWordHash } from "../shared/player-profiles";
import { rackComposition } from "../shared/rack-entry";
import type { CandidateJob } from "./candidate-analysis-jobs";
import { createCandidatePool } from "./candidate-analysis-pool";

export type HunterProgress = {
  phase: "screen" | "sample" | "refine";
  done: number;
  total: number;
};
export type HunterSummary = {
  checked: number;
  limited: boolean;
  finalistsFirst?: boolean;
};

const SCREEN_DEALS = 48;
const SCREEN_TIME_MS = 5_000;
const TOTAL_TIME_MS = 22_000;
const FIRST_PASS_MS = 8_000;
const MIN_DEALS = 24;
const now = () => performance.timeOrigin + performance.now();

export async function runBingoHunter(
  lexicon: Lexicon,
  position: HunterPosition,
  moves: readonly Move[],
  odds: RackOdds | undefined,
  workerLimit: number,
  signal: AbortSignal,
  progress: (value: HunterProgress) => void,
) {
  const { pool, opponentSize } = hunterPool(position);
  const { template, bagSize } = position;
  const limit = Math.min(workerLimit, 8);
  const workers = createCandidatePool(lexicon, limit, undefined, true);
  const stop = () => workers.close();
  signal.addEventListener("abort", stop, { once: true });
  const deadline = now() + TOTAL_TIME_MS;
  const draw = Math.min(bagSize, template.rackSize);
  const seed = profileWordHash(
    `${position.board.join(".")}:${rackComposition(position.rack)}:${bagSize}`,
  );
  const common = sampleHunterDeals(
    pool,
    opponentSize,
    draw,
    HUNTER_MAX,
    randomGenerator(seed),
  );
  const screen = hunterScreen(
    moves,
    template,
    odds?.bagSize === bagSize ? odds : undefined,
  );
  const values = new Map<Move, number[]>();
  let limited = false;

  async function batch(
    candidates: readonly Move[],
    deals: HunterDeal[],
    phase: HunterProgress["phase"],
    until: number,
    beforeReply = false,
  ) {
    signal.throwIfAborted();
    const batchValues = new Map<Move, number[]>();
    let done = 0;
    progress({ phase, done, total: candidates.length });
    await workers.run(
      candidates.map(
        (move): Extract<CandidateJob, { kind: "bingo-hunter" }> => ({
          kind: "bingo-hunter",
          position,
          move,
          deals,
          deadline: until,
          beforeReply,
          wavesRemaining: 1,
        }),
      ),
      ({ move }, result) => {
        if (result.kind !== "bingo-hunter")
          throw new Error(
            result.kind === "error"
              ? result.message
              : "Bingo hunter could not finish a search.",
          );
        batchValues.set(move, result.outcomes);
        progress({ phase, done: ++done, total: candidates.length });
      },
      (job) => ({
        ...job,
        wavesRemaining: Math.max(
          1,
          Math.ceil((candidates.length - done) / limit),
        ),
      }),
    );
    signal.throwIfAborted();
    const count = Math.min(
      deals.length,
      ...[...batchValues.values()].map((outcomes) => outcomes.length),
    );
    return { batchValues, count };
  }

  function order(
    candidates: readonly Move[],
    deals: HunterDeal[],
    exact = false,
  ) {
    return candidates
      .map(
        (move): RankedHunterMove => ({
          move,
          utility: hunterUtility(
            bingoNow(move, template),
            values.get(move)!,
            deals,
            exact,
          ),
        }),
      )
      .sort((a, b) => b.utility.total - a.utility.total);
  }

  function keep(
    batchValues: Map<Move, number[]>,
    count: number,
    append = false,
  ) {
    for (const [move, outcomes] of batchValues)
      values.set(move, [
        ...(append ? values.get(move)! : []),
        ...outcomes.slice(0, count),
      ]);
  }

  function ranking(
    ranked: RankedHunterMove[],
    compared: RankedHunterMove[],
    exact = false,
  ) {
    const best = compared[0];
    if (best && !exact) {
      const near = compared
        .slice(1)
        .filter((item) =>
          hunterClose(
            best.utility.bingoNow - item.utility.bingoNow,
            values.get(best.move)!,
            values.get(item.move)!,
          ),
        );
      best.utility.close = near.length > 0;
      for (const item of near) item.utility.close = true;
    }
    return {
      ranked,
      summary: {
        checked: ranked.length,
        limited,
        finalistsFirst: compared.length < ranked.length,
      } satisfies HunterSummary,
    };
  }

  try {
    if (!moves.length) return ranking([], []);
    let candidates = moves;
    if (
      bagSize &&
      moves.length > HUNTER_CANDIDATES &&
      screen.length > HUNTER_CANDIDATES
    ) {
      const draws = sampleHunterDeals(
        pool,
        opponentSize,
        draw,
        SCREEN_DEALS,
        randomGenerator(seed ^ 0x8c748391),
      );
      const screened = await batch(
        screen,
        draws,
        "screen",
        Math.min(deadline, now() + SCREEN_TIME_MS),
        true,
      );
      if (screened.count >= 12) {
        keep(screened.batchValues, screened.count);
        candidates = chooseHunterCandidates(
          order(screen, draws).map(({ move }) => move),
        );
        values.clear();
      } else {
        candidates = chooseHunterCandidates(screen);
      }
    } else if (moves.length > HUNTER_CANDIDATES) {
      candidates = chooseHunterCandidates(
        screen.length < HUNTER_CANDIDATES
          ? [...screen, ...moves.slice(0, HUNTER_CANDIDATES)]
          : screen,
      );
    }

    if (bagSize <= 3) {
      const deals = exactHunterDeals(pool, bagSize);
      const run = await batch(
        candidates,
        deals,
        "sample",
        Math.min(deadline, now() + FIRST_PASS_MS),
      );
      if (run.count === deals.length) {
        keep(run.batchValues, run.count);
        const ranked = order(candidates, deals, true);
        return ranking(ranked, ranked, true);
      }
    }

    const first = await batch(
      candidates,
      common.slice(0, HUNTER_INITIAL),
      "sample",
      Math.min(deadline, now() + FIRST_PASS_MS),
    );
    if (first.count < MIN_DEALS)
      throw new Error(
        "Bingo hunter reached its search limit before it could compare the moves.",
      );
    limited = first.count < HUNTER_INITIAL;
    keep(first.batchValues, first.count);
    const provisional = order(candidates, common);
    if (limited) return ranking(provisional, provisional);
    const finalists = provisional
      .slice(0, HUNTER_FINALISTS)
      .map(({ move }) => move);
    let ranked = provisional.slice(0, finalists.length);
    let done = first.count;
    for (const target of [HUNTER_CHECKPOINT, HUNTER_MAX]) {
      if (limited) break;
      const run = await batch(
        finalists,
        common.slice(done, target),
        "refine",
        deadline,
      );
      keep(run.batchValues, run.count, true);
      done += run.count;
      ranked = order(finalists, common);
      limited = done < target;
      const [best, ...others] = ranked;
      const close = others.some(({ move, utility }) =>
        hunterClose(
          best.utility.bingoNow - utility.bingoNow,
          values.get(best.move)!,
          values.get(move)!,
        ),
      );
      if (!close) break;
    }
    return ranking([...ranked, ...provisional.slice(finalists.length)], ranked);
  } finally {
    signal.removeEventListener("abort", stop);
    stop();
  }
}
