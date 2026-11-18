import {
  endgameStreaks,
  nextEndgameStreak,
  type EndgameSettings,
} from "./endgame";
import type { Lexicon } from "./lexicon";
import {
  isBingo,
  minimumBingoTiles,
  type BoardTemplate,
  type Move,
  type Position,
} from "./model";
import { bestStrongReply, sampleTiles } from "./move-analysis";
import { leaveValue } from "./rack-leave";
import { createSolverFactory, SEARCH_LIMITS, SearchLimitError } from "./solver";
import { unseenTiles } from "./tile-pool";
import type { RackOdds } from "./bingo-odds";

export const HUNTER_INITIAL = 64;
export const HUNTER_CHECKPOINT = 192;
export const HUNTER_MAX = 384;
export const HUNTER_CANDIDATES = 20;
export const HUNTER_FINALISTS = 8;

export type HunterPosition = Position &
  EndgameSettings & { template: BoardTemplate; bagSize: number };
export type HunterDeal = { opponent: string; bag: string; weight?: number };
export type HunterUtility = {
  bingoNow: number;
  nextBingoPoints: number;
  bingoChance: number;
  meanBingoScore: number;
  total: number;
  samples: number;
  exact: boolean;
  close: boolean;
};
export type RankedHunterMove = { move: Move; utility: HunterUtility };

const sortTiles = (rack: string) => [...rack].sort().join("");

export function bingoNow(move: Move, template: BoardTemplate) {
  return isBingo(template, move.tiles.length) ? move.score : 0;
}

export function hunterPool(position: HunterPosition) {
  const { tiles, total, excess } = unseenTiles(position, position.template);
  const { bagSize, template } = position;
  const opponentSize = total - bagSize;
  if (
    excess.length ||
    !Number.isInteger(total) ||
    !Number.isInteger(bagSize) ||
    bagSize < 0 ||
    opponentSize < 0 ||
    opponentSize > template.rackSize
  )
    throw new Error("Check the board, rack and bag count to analyze bingos.");
  return {
    pool: tiles.flatMap(({ symbol, count }) =>
      Array<string>(count).fill(symbol),
    ),
    opponentSize,
  };
}

export function sampleHunterDeals(
  pool: string[],
  opponentSize: number,
  draw: number,
  count: number,
  random: () => number,
): HunterDeal[] {
  return Array.from({ length: count }, () => {
    const order = sampleTiles(pool, opponentSize + draw, random);
    return {
      opponent: sortTiles(order.slice(0, opponentSize)),
      bag: order.slice(opponentSize),
    };
  });
}

export function exactHunterDeals(
  pool: string[],
  bagSize: number,
): HunterDeal[] {
  if (
    !Number.isInteger(bagSize) ||
    bagSize < 0 ||
    bagSize > 3 ||
    bagSize > pool.length
  )
    throw new Error(
      "Exact bingo analysis supports up to three tiles in the bag.",
    );
  const deals = new Map<string, HunterDeal>();
  function visit(remaining: string[], bag: string) {
    if (bag.length === bagSize) {
      const deal = deals.get(bag);
      if (deal) deal.weight!++;
      else
        deals.set(bag, {
          opponent: sortTiles(remaining.join("")),
          bag,
          weight: 1,
        });
      return;
    }
    for (const [i, letter] of remaining.entries())
      visit(remaining.slice(0, i).concat(remaining.slice(i + 1)), bag + letter);
  }
  visit(pool, "");
  return [...deals.values()];
}

export function hunterScreen(
  moves: readonly Move[],
  template: BoardTemplate,
  odds?: RackOdds,
) {
  const groups = new Map<string, Move[]>();
  const short = new Map<string, Move>();
  for (const move of moves) {
    const group = groups.get(move.leave);
    if (!group) groups.set(move.leave, [move]);
    else if (group.length < 2) group.push(move);
    if (bingoNow(move, template) && short.size < 6) short.set(move.id, move);
  }
  const prior = (move: Move) => {
    const chance = odds?.byLeave[move.leave];
    return (
      bingoNow(move, template) +
      (chance === undefined ? 2 * leaveValue(move.leave) : 75 * chance)
    );
  };
  const byLeave = [...groups.values()].sort(([a], [b]) => prior(b) - prior(a));
  for (const move of byLeave.slice(0, 24).flat()) short.set(move.id, move);
  return [...short.values()];
}

export function chooseHunterCandidates(ranked: readonly Move[]) {
  const candidates = new Set(ranked.slice(0, 12));
  const seen = new Set<string>();
  for (const move of ranked) {
    if (seen.has(move.leave)) continue;
    seen.add(move.leave);
    candidates.add(move);
    if (seen.size === 8) break;
  }
  return [...new Set([...candidates, ...ranked])].slice(0, HUNTER_CANDIDATES);
}

export function createHunterEvaluator(
  lexicon: Lexicon,
  position: HunterPosition,
  move: Move,
) {
  const { board, template, bagSize, scorelessTurns } = position;
  const factory = createSolverFactory(lexicon, template, true);
  const next = factory.place(board, move);
  const solver = factory(next);
  const draw = Math.min(bagSize, template.rackSize - move.leave.length);
  const bagAfter = bagSize - draw;
  const rule = endgameStreaks[template.rules];
  const streak = rule ? nextEndgameStreak(rule, scorelessTurns, move) : 0;
  const impossible =
    move.leave.length + draw < minimumBingoTiles(template) ||
    (rule
      ? (!bagAfter && !move.leave && !draw) || streak >= rule.limit
      : !bagSize);
  const replies = new Map<string, Move | null>();
  const followups = new Map<
    Move | null,
    {
      solver: typeof solver;
      scores: Map<string, number>;
    }
  >();

  return (deal: HunterDeal, beforeReply: boolean, deadline: number) => {
    if (impossible) return 0;
    function limits() {
      const maxMs = Math.min(SEARCH_LIMITS.maxMs, deadline - performance.now());
      if (maxMs <= 0) throw new SearchLimitError("time");
      return { maxMs };
    }
    let reply: Move | null = null;
    if (!beforeReply && deal.opponent) {
      if (!replies.has(deal.opponent)) {
        replies.set(
          deal.opponent,
          bestStrongReply(
            solver.solve(deal.opponent, limits(), { unsorted: true }),
            bagAfter,
          ),
        );
      }
      reply = replies.get(deal.opponent) ?? null;
      if (
        (rule && !bagAfter && reply?.leave === "") ||
        (rule && nextEndgameStreak(rule, streak, reply) >= rule.limit)
      )
        return 0;
    }
    let entry = followups.get(reply);
    if (entry) followups.delete(reply);
    else
      entry = {
        solver: reply ? factory(factory.place(next, reply)) : solver,
        scores: new Map(),
      };
    followups.set(reply, entry);
    if (followups.size > 32) followups.delete(followups.keys().next().value!);
    const rack = sortTiles(move.leave + deal.bag.slice(0, draw));
    const cached = entry.scores.get(rack);
    if (cached !== undefined) return cached;
    const score = entry.solver.bestBingoScore(rack, limits());
    entry.scores.set(rack, score);
    return score;
  };
}

export function hunterUtility(
  now: number,
  outcomes: readonly number[],
  deals: readonly HunterDeal[],
  exact = false,
): HunterUtility {
  let sum = 0,
    hits = 0,
    weight = 0;
  for (const [i, score] of outcomes.entries()) {
    const count = deals[i].weight ?? 1;
    sum += count * score;
    hits += score > 0 ? count : 0;
    weight += count;
  }
  const expected = weight ? sum / weight : 0;
  return {
    bingoNow: now,
    nextBingoPoints: expected,
    bingoChance: weight ? hits / weight : 0,
    meanBingoScore: hits ? sum / hits : 0,
    total: now + expected,
    exact,
    samples: outcomes.length,
    close: false,
  };
}

// Compare paired outcomes so shared draws cancel their common variation.
export function hunterClose(
  nowGap: number,
  a: readonly number[],
  b: readonly number[],
) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return true;
  let sum = 0,
    squares = 0;
  for (let i = 0; i < n; i++) {
    const gap = a[i] - b[i];
    sum += gap;
    squares += gap * gap;
  }
  const mean = sum / n;
  const error = Math.sqrt(Math.max(0, squares / n - mean * mean) / (n - 1));
  return Math.abs(nowGap + mean) <= Math.max(1, 2 * error);
}
