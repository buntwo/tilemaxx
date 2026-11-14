import { RackBingoIndex } from "./bingo-odds";
import { minimumExchangeBag } from "./exchange";
import type { Lexicon } from "./lexicon";
import type { BoardTemplate, Position } from "./model";
import { randomGenerator, sampleTiles } from "./move-analysis";
import { splitRack } from "./rack-entry";
import { prepareSolver, SEARCH_LIMITS, SearchLimitError } from "./solver";
import { unseenTiles } from "./tile-pool";

export type OptimalExchangeRequest = Position & {
  template: BoardTemplate;
  bag: number;
};

type Swap = { slots: number[]; leave: string; hits: number };
type Estimate = { slots: number[]; chance: number; close: boolean };
export type OptimalExchangeResult = {
  keepBingo: boolean;
  bestBySize: Estimate[];
  checked: number;
  screeningDraws: number;
  refinementDraws: number;
};

const SCREEN_DRAWS = 64;
const REFINE_DRAWS = 600;
const MIN_DRAWS = 12;
const canonical = (rack: string) => [...rack].sort().join("");

function swapOptions({ rack, excludedRackSlots = [] }: Position, max: number) {
  const available = [...rack].flatMap((letter, index) =>
    letter !== "." && !excludedRackSlots.includes(index) ? [index] : [],
  );
  const bySize = new Map<number, Swap[]>();
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
    const group = bySize.get(slots.length) ?? [];
    group.push({ slots, leave, hits: 0 });
    bySize.set(slots.length, group);
  }
  return [...bySize.values()].sort(
    (a, b) => a[0].slots.length - b[0].slots.length,
  );
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

export function optimizeExchange(
  lexicon: Lexicon,
  rackIndex: RackBingoIndex,
  request: OptimalExchangeRequest,
  progress: (completed: number, total: number) => void = () => {},
  { seed = 0x604bd5, maxMs = 6000 } = {},
): OptimalExchangeResult {
  const { board, template, bag } = request;
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
  if (!available) throw new Error("Enter at least one tile that is not held.");
  const groups = swapOptions(request, bag);
  const options = groups.flat();
  const maxDraw = groups[groups.length - 1][0].slots.length;
  const pool = tiles.flatMap(({ symbol, count }) =>
    Array<string>(count).fill(symbol),
  );
  const random = randomGenerator(seed);
  const solver = prepareSolver(lexicon, board, template);
  const memo = new Map<string, boolean>();
  function canBingo(rack: string, deadline: number) {
    const key = canonical(rack);
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const maxMs = Math.min(SEARCH_LIMITS.maxMs, deadline - performance.now());
    if (maxMs <= 0) throw new SearchLimitError();
    const hit = !!solver.solve(key, { maxMs }, { bingoOnly: true }).length;
    memo.set(key, hit);
    return hit;
  }
  const start = performance.now();
  const deadline = start + maxMs;
  const keepBingo = canBingo(available, deadline);
  function sample(swaps: Swap[], limit: number, until: number, offset: number) {
    let completed = 0;
    try {
      for (; completed < limit && performance.now() < until; completed++) {
        const dealt = sampleTiles(pool, maxDraw, random);
        // Only count a round when every candidate has seen the same draw.
        const hits = swaps.map(({ slots, leave }) =>
          canBingo(leave + dealt.slice(0, slots.length), until),
        );
        hits.forEach((hit, i) => {
          if (hit) swaps[i].hits++;
        });
        if ((completed + 1) % 16 === 0)
          progress(offset + completed + 1, SCREEN_DRAWS + REFINE_DRAWS);
      }
    } catch (error) {
      if (!(error instanceof SearchLimitError)) throw error;
    }
    return completed;
  }

  const screeningDraws = sample(options, SCREEN_DRAWS, start + maxMs * 0.45, 0);
  if (screeningDraws < MIN_DRAWS)
    throw new Error("This position exceeded the exchange search limit.");
  progress(screeningDraws, SCREEN_DRAWS + REFINE_DRAWS);
  // A dictionary-only leave signal can keep a rare candidate in contention.
  // The final estimates still come from legal placements on the current board.
  const drawOdds =
    available.length === template.rackSize && screeningDraws === SCREEN_DRAWS
      ? rackIndex.calculate(lexicon, request, template, options, bag).byLeave
      : {};
  const drawChance = (choice: Swap) => drawOdds[choice.leave] ?? 0;
  const finalists = groups.map((group) => {
    const [first, second, ...others] = group.sort(
      (a, b) => b.hits - a.hits || drawChance(b) - drawChance(a),
    );
    const low = interval(first.hits, screeningDraws).low;
    const promising = others
      .filter(({ hits }) => interval(hits, screeningDraws).high >= low)
      .sort((a, b) => drawChance(b) - drawChance(a))[0];
    return [first, second, promising]
      .filter((choice): choice is Swap => !!choice)
      .map((choice) => ({ ...choice, hits: 0 }));
  });
  const refinementDraws = sample(
    finalists.flat(),
    REFINE_DRAWS,
    deadline,
    screeningDraws,
  );
  const refined = refinementDraws >= MIN_DRAWS;
  const samples = refined ? refinementDraws : screeningDraws;
  const ranked = (refined ? finalists : groups).map((group) =>
    group.sort((a, b) => b.hits - a.hits),
  );
  const best = ranked.reduce(
    (leader, [swap]) => (swap.hits > leader.hits ? swap : leader),
    ranked[0][0],
  );
  const bestLow = interval(best.hits, samples).low;
  return {
    keepBingo,
    checked: options.length,
    screeningDraws,
    refinementDraws: refined ? refinementDraws : 0,
    bestBySize: ranked.map(([swap, runnerUp]) => ({
      slots: swap.slots,
      chance: swap.hits / samples,
      close:
        (swap !== best && interval(swap.hits, samples).high >= bestLow) ||
        (!!runnerUp &&
          interval(runnerUp.hits, samples).high >=
            interval(swap.hits, samples).low),
    })),
  };
}
