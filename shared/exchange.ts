import type { BoardTemplate, Move, Position } from "./model";
import { Lexicon } from "./lexicon";
import { sampleTiles, weightedDraws } from "./move-analysis";
import { prepareSolver, SEARCH_LIMITS, SearchLimitError } from "./solver";
import { unseenTiles } from "./tile-pool";

export type ExchangeRequest = Position & {
  slots: number[];
  bag: number;
  template: BoardTemplate;
};
export const EXCHANGE_SAMPLES = 120;

export function simulateExchange(
  lexicon: Lexicon,
  request: ExchangeRequest,
  progress: (completed: number, total: number) => void = () => {},
  random = Math.random,
) {
  const { slots, bag, template, rack, board } = request;
  const chosen = new Set(slots);
  if (
    !slots.length ||
    chosen.size !== slots.length ||
    slots.some(
      (i) => !Number.isInteger(i) || i < 0 || !rack[i] || rack[i] === ".",
    )
  )
    throw new Error("Mark at least one occupied rack tile for exchange.");
  const { total, excess, tiles } = unseenTiles(request, template);
  if (excess.length) throw new Error("Check the entered tile counts first.");
  const minimum = Math.max(slots.length, template.rules === "wwf" ? 1 : 7);
  if (
    !Number.isInteger(bag) ||
    bag < Math.max(minimum, total - template.rackSize) ||
    bag > total
  )
    throw new Error(
      "The bag count must allow this exchange and leave at most one opponent rack.",
    );
  const keep = [...rack]
    .filter((tile, i) => tile !== "." && !chosen.has(i))
    .join("");
  const pool = tiles.flatMap(({ symbol, count }) =>
    Array<string>(count).fill(symbol),
  );
  const prepared = prepareSolver(lexicon, board, template);
  function measure(
    draws: { draw: string; weight: number }[],
    exact: boolean,
    maxMs: number,
  ) {
    const deadline = performance.now() + maxMs;
    const cache = new Map<string, { best?: Move; bingo?: Move }>();
    const examples = new Map<
      string,
      {
        rack: string;
        word: string;
        score: number;
        bingo: boolean;
        weight: number;
      }
    >();
    let weight = 0,
      points = 0,
      bingos = 0,
      completed = 0,
      playable = 0;
    for (const { draw, weight: copies } of draws) {
      const full = (keep + draw).split("").sort().join("");
      try {
        let result = cache.get(full);
        if (!result) {
          const maxMs = Math.min(
            SEARCH_LIMITS.maxMs,
            deadline - performance.now(),
          );
          if (maxMs <= 0) throw new SearchLimitError();
          const moves = prepared.solve(full, { maxMs });
          result = {
            best: moves[0],
            bingo: moves.find(
              (move) => move.tiles.length === template.rackSize,
            ),
          };
          cache.set(full, result);
        }
        weight += copies;
        points += (result.best?.score ?? 0) * copies;
        if (result.bingo) bingos += copies;
        if (result.best) playable += copies;
        for (const move of new Set([result.best, result.bingo])) {
          if (!move) continue;
          const key =
            move.word + ":" + (move.tiles.length === template.rackSize);
          const entry = examples.get(key);
          examples.set(key, {
            rack: full,
            word: move.word,
            score: Math.max(move.score, entry?.score ?? 0),
            bingo: move.tiles.length === template.rackSize,
            weight: (entry?.weight ?? 0) + copies,
            ...(entry && entry.score > move.score && { rack: entry.rack }),
          });
        }
        completed++;
        if (completed % 10 === 0 || completed === draws.length)
          progress(completed, draws.length);
      } catch (error) {
        if (!(error instanceof SearchLimitError)) throw error;
        if (exact) return;
        break;
      }
    }
    if (!weight)
      throw new Error("The exchange simulation hit the search limit.");
    return {
      exact,
      completed,
      total: draws.length,
      score: points / weight,
      bingo: bingos / weight,
      playable: playable / weight,
      examples: [...examples.values()]
        .sort((a, b) => b.weight - a.weight || b.score - a.score)
        .slice(0, 8),
    };
  }
  if (slots.length <= 2) {
    const exact = measure(weightedDraws(pool, slots.length), true, 2200);
    if (exact) return exact;
  }
  return measure(
    Array.from({ length: EXCHANGE_SAMPLES }, () => ({
      draw: sampleTiles(pool, slots.length, random),
      weight: 1,
    })),
    false,
    3800,
  )!;
}
export type ExchangeResult = ReturnType<typeof simulateExchange>;
