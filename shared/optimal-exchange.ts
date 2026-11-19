import { RackBingoIndex } from "./bingo-odds";
import {
  createBingoReplySearch,
  sampleBingoDeals,
  type BingoDeal,
} from "./bingo-replies";
import {
  endgameStreaks,
  nextEndgameStreak,
  validEndgameStreak,
} from "./endgame";
import { minimumExchangeBag } from "./exchange";
import type { Lexicon } from "./lexicon";
import { minimumBingoTiles, type BoardTemplate, type Position } from "./model";
import { randomGenerator, sampleTiles } from "./move-analysis";
import { splitRack } from "./rack-entry";
import {
  createSolverFactory,
  prepareSolver,
  SEARCH_LIMITS,
  SearchLimitError,
} from "./solver";
import { unseenTiles } from "./tile-pool";

export type OptimalExchangeRequest = Position & {
  template: BoardTemplate;
  bag: number;
  scorelessTurns?: number;
};

type Swap = { slots: number[]; leave: string; hits: number };
type Estimate = { slots: number[]; chance: number; close: boolean };
export type OptimalExchangeResult = {
  keepBingo: boolean;
  bestSwaps: Estimate[];
  checked: number;
  finalists: number;
  screeningDraws: number;
  refinementDraws: number;
};

const SCREEN_DRAWS = 128;
const FINALIST_LIMIT = 20;
export const EXCHANGE_REPLY_TRIALS = 256;
const DISPLAY_LIMIT = 7;
const MIN_DRAWS = 12;
const canonical = (rack: string) => [...rack].sort().join("");

function swapOptions({ rack, excludedRackSlots = [] }: Position, max: number) {
  const available = [...rack].flatMap((letter, index) =>
    letter !== "." && !excludedRackSlots.includes(index) ? [index] : [],
  );
  const options: Swap[] = [];
  const seen = new Set<string>();
  for (let mask = 1; mask < 1 << available.length; mask++) {
    const slots = available.filter((_, bit) => mask & (1 << bit));
    if (slots.length > max) continue;
    const leave = canonical(
      available
        .filter((slot) => !slots.includes(slot))
        .map((slot) => rack[slot])
        .join(""),
    );
    if (seen.has(leave)) continue;
    seen.add(leave);
    options.push({ slots, leave, hits: 0 });
  }
  return options;
}

function interval(hits: number, samples: number) {
  const rate = hits / samples;
  // Wilson interval stays meaningful even when the sample has zero hits.
  const z = 1.96;
  const middle = rate + z ** 2 / (2 * samples);
  const radius =
    z * Math.sqrt((rate * (1 - rate) + z ** 2 / (4 * samples)) / samples);
  const denominator = 1 + z ** 2 / samples;
  return {
    low: (middle - radius) / denominator,
    high: (middle + radius) / denominator,
  };
}

export type ExchangeProgress = {
  completed: number;
  total: number;
  phase: "screen" | "replies";
};
type ExchangeLeave = { leave: string; draw: number };
export type ExchangeBatch = { deadline: number } & (
  | { kind: "exchange-racks"; racks: string[] }
  | { kind: "exchange-replies"; deals: BingoDeal[]; swaps: ExchangeLeave[] }
);
type ExchangeHits = (boolean | undefined)[];

export function checkExchangeRacks(
  solver: ReturnType<typeof prepareSolver>,
  racks: readonly string[],
  deadline: number,
): ExchangeHits {
  const hits: ExchangeHits = [];
  try {
    for (const rack of racks) {
      const maxMs = Math.min(SEARCH_LIMITS.maxMs, deadline - performance.now());
      if (maxMs <= 0) break;
      hits.push(!!solver.solve(rack, { maxMs }, { bingoOnly: true }).length);
    }
  } catch (error) {
    if (!(error instanceof SearchLimitError)) throw error;
  }
  return hits;
}

export function createExchangeReplyCheck(
  lexicon: Lexicon,
  {
    board,
    template,
    scorelessTurns = 0,
  }: Pick<OptimalExchangeRequest, "board" | "template" | "scorelessTurns">,
) {
  const factory = createSolverFactory(lexicon, template, true);
  const search = createBingoReplySearch(
    factory,
    board,
    true,
    (solver, rack, limits) =>
      !!solver.solve(rack, limits, { bingoOnly: true }).length,
  );
  const rule = endgameStreaks[template.rules];
  const streak = rule && !rule.passesOnly ? scorelessTurns + 1 : 0;

  return (
    deals: BingoDeal[],
    swaps: ExchangeLeave[],
    deadline: number,
  ): ExchangeHits => {
    const hits: boolean[] = [];
    try {
      for (const deal of deals) {
        if (performance.now() >= deadline) break;
        if (rule && streak >= rule.limit) {
          hits.push(...swaps.map(() => false));
          continue;
        }
        const reply = search.reply(deal.opponent, deadline);
        const ended =
          rule && nextEndgameStreak(rule, streak, reply) >= rule.limit;
        // Evaluate every swap on the same reply board before recording this deal.
        hits.push(
          ...swaps.map(
            ({ leave, draw }) =>
              !ended &&
              search.bingo(
                reply,
                canonical(leave + deal.bag.slice(0, draw)),
                deadline,
              ),
          ),
        );
      }
    } catch (error) {
      if (!(error instanceof SearchLimitError)) throw error;
    }
    return hits;
  };
}

export function* planOptimalExchange(
  lexicon: Lexicon,
  rackIndex: RackBingoIndex,
  request: OptimalExchangeRequest,
  progress: (progress: ExchangeProgress) => void,
  { seed = 0x604bd5, maxMs = 6000 } = {},
): Generator<ExchangeBatch, OptimalExchangeResult, ExchangeHits> {
  const { template, bag } = request;
  const { available } = splitRack(request);
  const { tiles, total, excess } = unseenTiles(request, template);
  if (excess.length) throw new Error("Check the entered tile counts first.");
  if (
    !Number.isInteger(bag) ||
    bag <
      Math.max(minimumExchangeBag(template, 1), total - template.rackSize) ||
    bag > total
  )
    throw new Error("The bag does not have enough tiles for an exchange.");
  if (!validEndgameStreak(template.rules, request.scorelessTurns ?? 0))
    throw new Error("Enter a valid number of prior passes or scoreless turns.");
  const bingoMinimum = minimumBingoTiles(template);
  if (available.length < bingoMinimum)
    throw new Error(
      `Optimal exchange needs at least ${bingoMinimum} playable rack tiles for a bingo.`,
    );
  const options = swapOptions(request, bag);
  const maxDraw = Math.min(bag, available.length);
  const pool = tiles.flatMap(({ symbol, count }) =>
    Array<string>(count).fill(symbol),
  );
  const random = randomGenerator(seed);
  const memo = new Map<string, boolean>();
  const start = performance.now();
  const deadline = start + maxMs;
  const kept = canonical(available);
  progress({ completed: 0, total: SCREEN_DRAWS, phase: "screen" });
  const [keepBingo] = yield { kind: "exchange-racks", racks: [kept], deadline };
  if (keepBingo === undefined) throw new SearchLimitError();
  memo.set(kept, keepBingo);

  function* screen(
    until: number,
  ): Generator<ExchangeBatch, number, ExchangeHits> {
    let completed = 0;
    while (completed < SCREEN_DRAWS && performance.now() < until) {
      const rounds: string[][] = [];
      const pending = new Set<string>();
      const batchSize = Math.min(16, SCREEN_DRAWS - completed);
      for (let i = 0; i < batchSize; i++) {
        const dealt = sampleTiles(pool, maxDraw, random);
        const racks = options.map(({ slots, leave }) =>
          canonical(leave + dealt.slice(0, slots.length)),
        );
        for (const rack of racks) if (!memo.has(rack)) pending.add(rack);
        rounds.push(racks);
      }
      if (pending.size) {
        const racks = [...pending];
        const hits = yield { kind: "exchange-racks", racks, deadline: until };
        for (const [i, rack] of racks.entries()) {
          const hit = hits[i];
          if (hit !== undefined) memo.set(rack, hit);
        }
      }
      for (const racks of rounds) {
        const hits = racks.map((rack) => memo.get(rack));
        // A draw contributes only when every swap has a result.
        if (hits.includes(undefined)) return completed;
        hits.forEach((hit, i) => {
          if (hit) options[i].hits++;
        });
        if (++completed % 16 === 0)
          progress({ completed, total: SCREEN_DRAWS, phase: "screen" });
      }
    }
    return completed;
  }

  const screeningDraws = yield* screen(start + maxMs * 0.45);
  if (screeningDraws < MIN_DRAWS)
    throw new Error("This position exceeded the exchange search limit.");
  progress({ completed: screeningDraws, total: SCREEN_DRAWS, phase: "screen" });
  // Break screening ties with dictionary-only bingo odds.
  const drawOdds =
    available.length === template.rackSize && screeningDraws === SCREEN_DRAWS
      ? rackIndex.calculate(
          lexicon,
          request,
          template,
          options,
          bag,
          randomGenerator(seed),
        ).byLeave
      : {};
  const drawChance = (choice: Swap) => drawOdds[choice.leave] ?? 0;
  options.sort((a, b) => b.hits - a.hits || drawChance(b) - drawChance(a));
  const finalists = options
    .slice(0, FINALIST_LIMIT)
    .map((choice) => ({ ...choice, hits: 0 }));
  const swaps = finalists.map(({ slots, leave }) => ({
    leave,
    draw: slots.length,
  }));
  const largestSwap = Math.max(...swaps.map(({ draw }) => draw));
  let refinementDraws = 0;
  progress({ completed: 0, total: EXCHANGE_REPLY_TRIALS, phase: "replies" });
  while (
    refinementDraws < EXCHANGE_REPLY_TRIALS &&
    performance.now() < deadline
  ) {
    const deals = sampleBingoDeals(
      pool,
      total - bag,
      largestSwap,
      Math.min(16, EXCHANGE_REPLY_TRIALS - refinementDraws),
      random,
    );
    const hits = yield { kind: "exchange-replies", deals, swaps, deadline };
    let completed = 0;
    for (let i = 0; i < deals.length; i++) {
      const row = hits.slice(i * swaps.length, (i + 1) * swaps.length);
      if (row.length !== swaps.length || row.includes(undefined)) break;
      row.forEach((hit, j) => {
        if (hit) finalists[j].hits++;
      });
      completed++;
    }
    refinementDraws += completed;
    progress({
      completed: refinementDraws,
      total: EXCHANGE_REPLY_TRIALS,
      phase: "replies",
    });
    if (completed < deals.length) break;
  }
  const refined = refinementDraws >= MIN_DRAWS;
  const samples = refined ? refinementDraws : screeningDraws;
  // Stable sorting preserves the screening order when refined estimates tie.
  const ranked = refined ? finalists.sort((a, b) => b.hits - a.hits) : options;
  const [best, runnerUp] = ranked;
  const bestLow = interval(best.hits, samples).low;
  return {
    keepBingo,
    checked: options.length,
    finalists: refined ? finalists.length : 0,
    screeningDraws,
    refinementDraws: refined ? refinementDraws : 0,
    bestSwaps: ranked.slice(0, DISPLAY_LIMIT).map((swap) => ({
      slots: swap.slots,
      chance: swap.hits / samples,
      close:
        swap === best
          ? !!runnerUp && interval(runnerUp.hits, samples).high >= bestLow
          : interval(swap.hits, samples).high >= bestLow,
    })),
  };
}

export function optimizeExchange(
  lexicon: Lexicon,
  rackIndex: RackBingoIndex,
  request: OptimalExchangeRequest,
  progress: (progress: ExchangeProgress) => void = () => {},
  options?: { seed?: number; maxMs?: number },
): OptimalExchangeResult {
  const solver = prepareSolver(lexicon, request.board, request.template);
  let replies: ReturnType<typeof createExchangeReplyCheck> | undefined;
  const plan = planOptimalExchange(
    lexicon,
    rackIndex,
    request,
    progress,
    options,
  );
  let step = plan.next();
  while (!step.done) {
    const batch = step.value;
    step = plan.next(
      batch.kind === "exchange-racks"
        ? checkExchangeRacks(solver, batch.racks, batch.deadline)
        : (replies ??= createExchangeReplyCheck(lexicon, request))(
            batch.deals,
            batch.swaps,
            batch.deadline,
          ),
    );
  }
  return step.value;
}
