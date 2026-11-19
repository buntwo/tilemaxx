import {
  endgameStreaks,
  nextEndgameStreak,
  type EndgameSettings,
} from "./endgame";
import { popcount, type Lexicon } from "./lexicon";
import {
  isBingo,
  minimumBingoTiles,
  wordBonuses,
  type BoardTemplate,
  type Move,
  type Position,
} from "./model";
import { sampleTiles } from "./move-analysis";
import { leaveValue } from "./rack-leave";
import { createSolverFactory, SEARCH_LIMITS, SearchLimitError } from "./solver";
import { unseenTiles } from "./tile-pool";
import type { RackOdds } from "./bingo-odds";

export const HUNTER_INITIAL = 80;
export const HUNTER_CHECKPOINT = 256;
export const HUNTER_MAX = 512;
export const HUNTER_SCREEN = 96;
export const HUNTER_CANDIDATES = 36;
export const HUNTER_FINALISTS = 12;

export type HunterPosition = Position &
  EndgameSettings & { template: BoardTemplate; bagSize: number };
export type HunterDeal = { opponent: string; bag: string; weight?: number };
export type HunterUtility = {
  bingoNow: number;
  nextBingoPoints: number;
  bingoChance: number;
  meanBingoScore: number;
  highestBingo: number;
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

// Give crowded-out placements a way into the search based on premium lanes.
// Geometry supplies leads for simulation, so it can ignore cross-word spelling.
function hunterLanes({ board, template }: HunterPosition) {
  const { size, premiums } = template;
  const minimum = minimumBingoTiles(template);
  const occupied = new Int32Array(2 * size);
  const wordMultipliers = new Uint8Array(board.length);
  const scanCache = Array.from(
    { length: occupied.length },
    () => new Map<number, number>(),
  );
  for (const [index, letter] of board.entries()) {
    const row = Math.floor(index / size),
      col = index % size;
    if (letter) {
      occupied[row] |= 1 << col;
      occupied[size + col] |= 1 << row;
    }
    wordMultipliers[index] = wordBonuses[premiums[index]] ?? 1;
  }
  // Only windows long enough for a bingo are relevant. A window with one
  // extra empty square can become available when the reply supplies a letter.
  function scan(line: number, added: number) {
    const cache = scanCache[line];
    const saved = cache.get(added);
    if (saved !== undefined) return saved;
    const filled = occupied[line] | added;
    const origin = line < size ? line * size : line - size;
    const step = line < size ? 1 : size;
    let best = 0;
    for (let start = 0; start <= size - minimum; start++) {
      if (start && filled & (1 << (start - 1))) continue;
      let empty = 0,
        factor = 1,
        span = 0;
      for (let end = start; end < size; end++) {
        const bit = 1 << end;
        span |= bit;
        if (!(filled & bit)) {
          if (++empty > minimum + 1) break;
          factor *= wordMultipliers[origin + end * step];
        }
        if (!(added & span) || empty < minimum || filled & (bit << 1)) continue;
        best = Math.max(best, empty === minimum ? factor : 0.75 * factor);
      }
    }
    if (cache.size < 2_048) cache.set(added, best);
    return best;
  }
  return (move: Move) => {
    const changed = new Map<number, number>();
    for (const { index } of move.tiles) {
      const row = Math.floor(index / size),
        col = index % size;
      changed.set(row, (changed.get(row) ?? 0) | (1 << col));
      changed.set(size + col, (changed.get(size + col) ?? 0) | (1 << row));
    }
    let best = 0;
    for (const [line, added] of changed) {
      if (size - popcount(occupied[line] | added) < minimum) continue;
      best = Math.max(best, scan(line, added));
    }
    return best;
  };
}

export function hunterScreen(
  moves: readonly Move[],
  position: HunterPosition,
  odds?: RackOdds,
) {
  const { template } = position;
  const lanes = hunterLanes(position);
  const groups = new Map<
    string,
    { first: Move; second?: Move; laneMove: Move; lane: number }
  >();
  const openings = new Map<Move, number>();
  const bingos: Move[] = [];
  const premiumAnchors: Move[] = [];
  const deadline = performance.now() + 750;
  let limited = false;
  for (const [i, move] of moves.entries()) {
    if ((i & 63) === 0 && performance.now() >= deadline) limited = true;
    if (bingoNow(move, template) && bingos.length < 12) bingos.push(move);
    const lane = limited ? 0 : lanes(move);
    if (lane > 1) openings.set(move, lane);
    if (move.tiles.length === 1 && lane >= 9) premiumAnchors.push(move);
    const group = groups.get(move.leave);
    if (!group) groups.set(move.leave, { first: move, laneMove: move, lane });
    else {
      group.second ??= move;
      if (lane > group.lane) Object.assign(group, { laneMove: move, lane });
    }
  }
  const prior = (move: Move) => {
    const chance = odds?.byLeave[move.leave];
    return (
      bingoNow(move, template) +
      (chance === undefined ? 2 * leaveValue(move.leave) : 75 * chance)
    );
  };
  const byLeave = [...groups.values()].sort(
    (a, b) => prior(b.first) - prior(a.first),
  );
  const byLane = [...groups.values()]
    .filter(({ lane }) => lane > 1)
    .sort((a, b) => b.lane - a.lane || prior(b.laneMove) - prior(a.laneMove))
    .map(({ laneMove }) => laneMove);
  const base = [
    ...new Set([
      ...bingos.slice(0, 6),
      ...byLeave
        .slice(0, 24)
        .flatMap(({ first, second }) => (second ? [first, second] : [first])),
    ]),
  ];
  const screen = [
    ...new Set([
      ...base,
      // Same-leave hooks can make very different words through two premiums.
      ...premiumAnchors
        .sort(
          (a, b) => openings.get(b)! - openings.get(a)! || prior(b) - prior(a),
        )
        .slice(0, 32),
      ...bingos,
      ...byLane.slice(0, 16),
      ...byLeave.slice(0, 25).map(({ laneMove }) => laneMove),
      ...moves.slice(0, HUNTER_SCREEN),
    ]),
  ].slice(0, HUNTER_SCREEN);
  const laneOrder = screen
    .filter((move) => openings.has(move))
    .sort((a, b) => openings.get(b)! - openings.get(a)! || prior(b) - prior(a));
  return { screen, base, laneOrder, limited };
}

export function chooseHunterCandidates(
  base: readonly Move[],
  before: readonly Move[],
  after: readonly Move[],
  peaks: readonly Move[],
  lanes: readonly Move[],
) {
  // Preserve the board-first picks before spending the extra slots on new leads.
  const oldPicks = new Set(base.slice(0, 12));
  const oldLeaves = new Set<string>();
  for (const move of base) {
    if (oldLeaves.has(move.leave)) continue;
    oldLeaves.add(move.leave);
    oldPicks.add(move);
    if (oldLeaves.size === 8) break;
  }
  return [
    ...new Set([
      ...[...oldPicks, ...base.filter((move) => !oldPicks.has(move))].slice(
        0,
        20,
      ),
      ...peaks.slice(0, 4),
      ...lanes.slice(0, 4),
      ...after,
      ...before,
    ]),
  ].slice(0, HUNTER_CANDIDATES);
}

export function chooseHunterFinalists(ranked: readonly RankedHunterMove[]) {
  const peak = ranked
    .filter(({ utility }) => utility.highestBingo > 0)
    .sort((a, b) => b.utility.highestBingo - a.utility.highestBingo);
  return [
    ...new Set([
      ...ranked.slice(0, HUNTER_FINALISTS - 2),
      ...peak.slice(0, 2),
      ...ranked,
    ]),
  ].slice(0, HUNTER_FINALISTS);
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
          solver.bestReply(deal.opponent, bagAfter > 0, limits()),
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
    weight = 0,
    highestBingo = 0;
  for (const [i, score] of outcomes.entries()) {
    const count = deals[i].weight ?? 1;
    sum += count * score;
    highestBingo = Math.max(highestBingo, score);
    hits += score > 0 ? count : 0;
    weight += count;
  }
  const expected = weight ? sum / weight : 0;
  return {
    bingoNow: now,
    nextBingoPoints: expected,
    bingoChance: weight ? hits / weight : 0,
    meanBingoScore: hits ? sum / hits : 0,
    highestBingo,
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
