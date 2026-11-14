import { rackPoints } from "./endgame";
import { minimumExchangeBag } from "./exchange";
import type { Lexicon } from "./lexicon";
import type { Board, BoardTemplate, Move, Position } from "./model";
import {
  bestStrongReply,
  leaveValue,
  placeTiles,
  randomGenerator,
  sampleTiles,
} from "./move-analysis";
import { rackLetters } from "./rack-entry";
import { prepareSolver, SEARCH_LIMITS, SearchLimitError } from "./solver";
import { unseenTiles } from "./tile-pool";

export type ExchangeAdviceRequest = Position & {
  template: BoardTemplate;
  plays: Move[];
};

export type ExchangeAdvice = {
  slots: number[];
  edge: number;
  comparedWith?: string;
};

const SCREEN_TRIALS = 20;
const MIN_TRIALS = 48;
const MAX_TRIALS = 300;
const STRONG_PLAY_EQUITY = 24;

export function exchangeAdvicePlays(
  position: Position,
  template: BoardTemplate,
  moves: Move[],
): Move[] | undefined {
  if (
    rackLetters(position.rack).length !== template.rackSize ||
    position.excludedRackSlots?.length
  )
    return;
  const { total, excess } = unseenTiles(position, template);
  if (
    excess.length ||
    total - template.rackSize < minimumExchangeBag(template, 1)
  )
    return;

  const bestByLeave = new Map<string, { move: Move; equity: number }>();
  for (const move of moves) {
    // Find Moves supplies score order, so the first move for each leave scores highest.
    if (!bestByLeave.has(move.leave)) {
      const equity = move.score + leaveValue(move.leave);
      if (equity > STRONG_PLAY_EQUITY) return;
      bestByLeave.set(move.leave, { move, equity });
    }
  }
  const highest = moves[0];
  if (!highest) return [];
  const others = [...bestByLeave.values()]
    .filter(({ move }) => move !== highest)
    .sort((a, b) => b.equity - a.equity)
    .slice(0, 2)
    .map(({ move }) => move);
  return [highest, ...others];
}

function exchangeCandidates(rack: string, maxSwap: number) {
  const letters = [...rack].flatMap((letter, slot) =>
    letter === "." ? [] : [{ letter, slot }],
  );
  const seen = new Set<string>();
  const bySize = new Map<
    number,
    { slots: number[]; keep: string; value: number }[]
  >();
  for (let mask = 1; mask < 1 << letters.length; mask++) {
    const slots: number[] = [];
    let keep = "";
    for (const [i, { letter, slot }] of letters.entries()) {
      if (mask & (1 << i)) slots.push(slot);
      else keep += letter;
    }
    if (slots.length > maxSwap) continue;
    keep = [...keep].sort().join("");
    if (seen.has(keep)) continue;
    seen.add(keep);
    const options = bySize.get(slots.length) ?? [];
    options.push({ slots, keep, value: leaveValue(keep) });
    bySize.set(slots.length, options);
  }
  return [...bySize.values()].flatMap((options) =>
    options.sort((a, b) => b.value - a.value).slice(0, 2),
  );
}

export function recommendExchange(
  lexicon: Lexicon,
  { board, rack, template, plays }: ExchangeAdviceRequest,
  { maxMs = 2_000, seed = 0x36efd9 } = {},
): ExchangeAdvice | undefined {
  const { total, tiles } = unseenTiles({ board, rack }, template);
  const bagSize = total - template.rackSize;
  const pool = tiles.flatMap(({ symbol, count }) =>
    Array<string>(count).fill(symbol),
  );
  const choices = exchangeCandidates(rack, bagSize);
  if (!choices.length) return;
  const start = performance.now();
  const deadline = start + maxMs;
  const screenDeadline = start + maxMs * 0.3;
  const random = randomGenerator(seed);
  const drawSize = Math.min(bagSize, template.rackSize);
  const nextWorld = () => {
    const order = sampleTiles(pool, template.rackSize + drawSize, random);
    return {
      opponent: order.slice(0, template.rackSize),
      draws: order.slice(template.rackSize),
    };
  };
  function limits(until: number) {
    const maxMs = Math.min(SEARCH_LIMITS.maxMs, until - performance.now());
    if (maxMs <= 0) throw new SearchLimitError();
    return { maxMs };
  }
  const current = prepareSolver(lexicon, board, template);
  const screenScores = choices.map(() => 0);
  const screenCache = new Map<string, number>();
  let screened = 0;
  try {
    for (; screened < SCREEN_TRIALS; screened++) {
      const { draws } = nextWorld();
      const scores = choices.map(({ slots, keep }) => {
        const refill = [...(keep + draws.slice(0, slots.length))]
          .sort()
          .join("");
        let score = screenCache.get(refill);
        if (score === undefined) {
          score = current.summarize(refill, limits(screenDeadline)).score;
          screenCache.set(refill, score);
        }
        return score;
      });
      scores.forEach((score, i) => {
        screenScores[i] += score;
      });
    }
  } catch (error) {
    if (!(error instanceof SearchLimitError)) throw error;
  }
  if (screened < 6) return;
  const finalists = choices
    .map((choice, i) => ({ ...choice, score: screenScores[i] }))
    .sort((a, b) => b.score - a.score || b.value - a.value)
    .slice(0, 3);

  const comparisons = [...plays, undefined];
  const passingRack = rackLetters(rack);
  const playBoards = comparisons.map((move) =>
    move ? placeTiles(board, move) : board,
  );
  const boards = new Map<Board, ReturnType<typeof prepareSolver>>([
    [board, current],
  ]);
  const replyBoards = new Map<Board, Map<string, Board>>();
  function solver(position: Board) {
    let prepared = boards.get(position);
    if (!prepared) {
      prepared = prepareSolver(lexicon, position, template);
      boards.set(position, prepared);
    }
    return prepared;
  }
  function forecast(position: Board, opponent: string, bagAfter: number) {
    const moves = solver(position).solve(opponent, limits(deadline), {
      unsorted: true,
    });
    const reply = bestStrongReply(moves, bagAfter);
    if (!reply) return { next: solver(position), score: 0 };
    if (!bagAfter && !reply.leave) return { score: reply.score };
    let cache = replyBoards.get(position);
    if (!cache) replyBoards.set(position, (cache = new Map()));
    let next = cache.get(reply.id);
    if (!next) next = placeTiles(position, reply);
    cache.delete(reply.id);
    cache.set(reply.id, next);
    if (cache.size > 16) {
      const oldest = cache.keys().next().value!;
      boards.delete(cache.get(oldest)!);
      cache.delete(oldest);
    }
    return { next: solver(next), score: reply.score };
  }
  function netScore(reply: ReturnType<typeof forecast>, refill: string) {
    const nextScore = reply.next
      ? reply.next.summarize(refill, limits(deadline)).score
      : -2 * rackPoints(refill, template.rules);
    return nextScore - reply.score;
  }

  // Confirmation draws are independent of screening. Each confirmed trial
  // compares every finalist and play in the same hidden-rack scenario.
  const deltas = finalists.map(() =>
    comparisons.map(() => ({ sum: 0, squares: 0 })),
  );
  let trials = 0;
  try {
    for (; trials < MAX_TRIALS; trials++) {
      const { opponent, draws } = nextWorld();
      const exchangeReply = forecast(board, opponent, bagSize);
      const playScores = comparisons.map((move, i) => {
        if (!move) return netScore(exchangeReply, passingRack);
        const count = Math.min(bagSize, move.tiles.length);
        const reply = forecast(playBoards[i], opponent, bagSize - count);
        return move.score + netScore(reply, move.leave + draws.slice(0, count));
      });
      const exchangeScores = finalists.map(({ slots, keep }) =>
        netScore(exchangeReply, keep + draws.slice(0, slots.length)),
      );
      exchangeScores.forEach((score, i) => {
        playScores.forEach((playScore, j) => {
          const delta = score - playScore;
          deltas[i][j].sum += delta;
          deltas[i][j].squares += delta * delta;
        });
      });
    }
  } catch (error) {
    if (!(error instanceof SearchLimitError)) throw error;
  }
  if (trials < MIN_TRIALS) return;
  let best: ExchangeAdvice | undefined;
  for (const [i, measurements] of deltas.entries()) {
    let edge = Infinity;
    let lower = Infinity;
    let comparedWith: string | undefined;
    for (const [j, { sum, squares }] of measurements.entries()) {
      const mean = sum / trials;
      const error = Math.sqrt(
        Math.max(0, squares - sum * mean) / (trials * (trials - 1)),
      );
      lower = Math.min(lower, mean - 2.6 * error);
      if (mean < edge) {
        edge = mean;
        comparedWith = comparisons[j]?.word;
      }
    }
    // A conservative allowance for sampling error across several comparisons,
    // plus two points for a useful edge within this short forecast.
    if (lower >= 2 && (!best || edge > best.edge))
      best = { slots: finalists[i].slots, edge, comparedWith };
  }
  return best;
}
