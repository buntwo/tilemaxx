import { canSpellRack } from "./bingo-odds";
import { exactHunterDeals, hunterScreen } from "./bingo-hunter";
import type { Lexicon } from "./lexicon";
import {
  bingoTileCounts,
  isBingo,
  minimumBingoTiles,
  type Board,
  type BoardTemplate,
  type Move,
  type Position,
} from "./model";
import { randomGenerator, sampleTiles } from "./move-analysis";
import { profileWordHash } from "./player-profiles";
import { rackLetters } from "./rack-entry";
import { leaveValue } from "./rack-leave";
import type { SoloSimulatedStyle } from "./simulated-styles";
import { createSolverFactory, SearchLimitError } from "./solver";
import { unseenTiles } from "./tile-pool";

const DRAW_SAMPLES = 24;
const SCREEN_SAMPLES = 48;
const POINTS_FINALISTS = 6;
const CHECK_MS = 120;
const sortTiles = (letters: string) => [...letters].sort().join("");
const byScore = (a: Move, b: Move) =>
  b.score - a.score || leaveValue(b.leave) - leaveValue(a.leave) || a.id.localeCompare(b.id);

type SampledUtility = { total: number; score: number; samples: number; exact: boolean };
export type SoloStyleUtility = SampledUtility & (
  | { kind: "solo-bingo"; bingoNow: boolean; bingoChance: number }
  | { kind: "solo-points"; nextPoints: number; followUpPoints: number }
);
export type RankedSoloMove = { move: Move; utility: SoloStyleUtility };

export type SoloStyleProgress = {
  phase: "solo-bingo" | "solo-points" | "solo-follow-up";
  done: number;
  total: number;
  stage: number;
};
type Deal = { bag: string; weight: number };
type PointCandidate = {
  move: Move;
  after: Board;
  nextPoints: number;
};

function sampleOrders(pool: string, length: number, count: number, seed: number) {
  const random = randomGenerator(seed);
  const tiles = [...pool];
  return Array.from({ length: count }, () =>
    sampleTiles(tiles, Math.min(tiles.length, length), random));
}

function extendDeals(deals: readonly Deal[], pool: string, rackSize: number, seed: number) {
  const random = randomGenerator(seed);
  return deals.map(({ bag, weight }) => {
    let remaining = pool;
    for (const letter of bag) remaining = remaining.replace(letter, "");
    return {
      bag: bag + sampleTiles([...remaining], Math.min(rackSize, remaining.length), random),
      weight,
    };
  });
}

function pointsCandidates(moves: readonly Move[], bagSize: number) {
  const ordered = [...moves].sort(byScore);
  if (!bagSize) return ordered;
  const byLeave = new Map<string, Move>();
  for (const move of ordered) {
    if (!byLeave.has(move.leave)) byLeave.set(move.leave, move);
  }
  const leavePicks = [...byLeave.values()].sort((a, b) =>
    b.score + leaveValue(b.leave) - (a.score + leaveValue(a.leave)) || byScore(a, b));
  return [...new Set([...ordered.slice(0, 12), ...leavePicks.slice(0, 12)])];
}

function greedyCandidates(
  moves: readonly Move[],
  position: Position & { template: BoardTemplate },
  bagSize: number,
  byLeave: Record<string, number>,
) {
  const { template } = position;
  const top = [...moves].sort(byScore);
  const minimum = minimumBingoTiles(template);
  if (bagSize <= 1)
    return [...new Set([
      ...top.filter((move) =>
        isBingo(template, move.tiles.length) || move.leave.length + bagSize >= minimum),
      ...top.slice(0, 12),
    ])];
  const byOdds = (a: Move, b: Move) =>
    (byLeave[b.leave] ?? 0) - (byLeave[a.leave] ?? 0) || byScore(a, b);
  const ordered = [...moves].sort(byOdds);
  const bingos: Move[] = [];
  const leaves = new Map<string, Move[]>();
  for (const move of ordered) {
    if (isBingo(template, move.tiles.length)) {
      if (bingos.length < 6) bingos.push(move);
      continue;
    }
    const group = leaves.get(move.leave);
    if (!group) leaves.set(move.leave, [move]);
    else if (group.length < 2) group.push(move);
  }
  const { laneOrder } = hunterScreen(top, position, {
    byLeave, exact: false, bagSize,
  });
  const groups = [...leaves.values()];
  return [...new Set([
    ...bingos,
    ...groups.slice(0, 9).map(([move]) => move),
    ...groups.slice(0, 3).flatMap((group) => group.slice(1)),
    ...laneOrder.slice(0, 5),
    top[0],
  ])];
}

export function createSoloStyleSearch(
  lexicon: Lexicon,
  position: Position & { template: BoardTemplate },
  moves: readonly Move[],
  style: SoloSimulatedStyle,
) {
  const { board, template } = position;
  const { total: bagSize, tiles, excess } = unseenTiles(position, template);
  if (excess.length) throw new Error("Check the board and rack tile counts.");
  const pool = sortTiles(tiles.map(({ symbol, count }) => symbol.repeat(count)).join(""));
  const seed = profileWordHash(`${sortTiles(rackLetters(position.rack))}|${pool}|${board.join(".")}`);
  const factory = createSolverFactory(lexicon, template, true);
  const rackSize = template.rackSize;
  const greedy = style === "greedy-bingo";
  const availableBingo = greedy && moves.some((move) => isBingo(template, move.tiles.length));
  const exact = bagSize <= 2;
  const deals: Deal[] = exact
    ? exactHunterDeals([...pool], bagSize).map(({ bag, weight = 1 }) => ({ bag, weight }))
    : sampleOrders(pool, rackSize * (greedy ? 2 : 1), DRAW_SAMPLES, seed ^ 0x9bc327e7)
      .map((bag) => ({ bag, weight: 1 }));
  const weight = deals.reduce((sum, deal) => sum + deal.weight, 0);
  const limits = { maxMs: CHECK_MS };
  const ranked: RankedSoloMove[] = [];
  const byLeave: Record<string, number> = Object.create(null);
  let limited = false;

  function* screenGreedy(): Generator<undefined> {
    if (bagSize <= 1) return;
    const minimum = minimumBingoTiles(template);
    const lengths = bingoTileCounts(template).reduce((mask, length) => mask | (1 << length), 0);
    const draws = sampleOrders(pool, rackSize, SCREEN_SAMPLES, seed ^ 0x12412384);
    const cached = new Map<string, boolean>();
    for (const leave of new Set(moves.map((move) => move.leave))) {
      const size = Math.min(bagSize, rackSize - leave.length);
      let hits = 0;
      try {
        for (const draw of draws) {
          const rack = sortTiles(leave + draw.slice(0, size));
          let hit = cached.get(rack);
          if (hit === undefined) {
            hit = rack.length >= minimum &&
              canSpellRack(lexicon, rack, lengths, minimum, performance.now() + CHECK_MS);
            cached.set(rack, hit);
          }
          hits += Number(hit);
          yield;
        }
        byLeave[leave] = hits / draws.length;
      } catch (error) {
        handleLimit(error);
      }
    }
  }

  function handleLimit(error: unknown) {
    if (!(error instanceof SearchLimitError)) throw error;
    limited = true;
  }

  function* rankGreedy(): Generator<SoloStyleProgress | undefined> {
    yield { phase: "solo-bingo", stage: 1, done: 0, total: 0 };
    yield* screenGreedy();
    const candidates = greedyCandidates(moves, position, bagSize, byLeave);
    const minimum = minimumBingoTiles(template);
    for (const [index, move] of candidates.entries()) {
      const drawSize = Math.min(bagSize, rackSize - move.leave.length);
      const bingoNow = isBingo(template, move.tiles.length);
      let hits = 0;
      let points = 0;
      try {
        if (move.leave.length + drawSize >= minimum) {
          const solver = factory(factory.place(board, move));
          const checked = new Map<string, number | null>();
          for (const deal of deals) {
            const rack = sortTiles(move.leave + deal.bag.slice(0, drawSize));
            let score = checked.get(rack);
            if (score === undefined) {
              score = solver.bestBingo(rack, limits)?.score ?? null;
              checked.set(rack, score);
            }
            if (score !== null) {
              hits += deal.weight;
              points += score * deal.weight;
            }
            yield;
          }
        }
        const bingoChance = hits / weight;
        ranked.push({
          move, utility: {
            kind: "solo-bingo", score: move.score, bingoNow, bingoChance,
            total: points / weight, samples: deals.length, exact,
          },
        });
      } catch (error) {
        handleLimit(error);
      }
      yield { phase: "solo-bingo", stage: 1, done: index + 1, total: candidates.length };
    }
  }

  function* scoreFollowUps(candidate: PointCandidate, orders: readonly Deal[]): Generator<undefined, number> {
    const { move, after } = candidate;
    const drawSize = Math.min(bagSize, rackSize - move.leave.length);
    const solver = factory(after);
    const continuations = new Map<string, {
      move: Move;
      solver: ReturnType<typeof factory>;
      scores: Map<string, number>;
    } | null>();
    let points = 0;
    for (const deal of orders) {
      const rack = sortTiles(move.leave + deal.bag.slice(0, drawSize));
      if (!rack) continue;
      let next = continuations.get(rack);
      if (next === undefined) {
        const moves = solver.solve(rack, limits, { unsorted: true });
        const move = moves.reduce<Move | undefined>(
          (best, option) => !best || byScore(option, best) < 0 ? option : best, undefined);
        next = move ? { move, solver: factory(factory.place(after, move)), scores: new Map() } : null;
        continuations.set(rack, next);
        yield;
      }
      if (!next) continue;
      const size = Math.min(bagSize - drawSize, rackSize - next.move.leave.length);
      const nextRack = sortTiles(next.move.leave + deal.bag.slice(drawSize, drawSize + size));
      if (!nextRack) continue;
      let score = next.scores.get(nextRack);
      if (score === undefined) {
        score = next.solver.bestScore(nextRack, limits);
        next.scores.set(nextRack, score);
      }
      points += score * deal.weight;
      yield;
    }
    return points;
  }

  function* rankTriple(): Generator<SoloStyleProgress | undefined> {
    yield { phase: "solo-points", stage: 1, done: 0, total: 0 };
    const candidates = pointsCandidates(moves, bagSize);
    const first: PointCandidate[] = [];
    for (const [index, move] of candidates.entries()) {
      const size = Math.min(bagSize, rackSize - move.leave.length);
      const after = factory.place(board, move);
      const solver = factory(after);
      const scores = new Map<string, number>();
      let points = 0;
      try {
        for (const deal of deals) {
          const rack = sortTiles(move.leave + deal.bag.slice(0, size));
          if (rack) {
            let score = scores.get(rack);
            if (score === undefined) {
              score = solver.bestScore(rack, limits);
              scores.set(rack, score);
            }
            points += score * deal.weight;
          }
          yield;
        }
        first.push({ move, after, nextPoints: points });
      } catch (error) {
        handleLimit(error);
      }
      yield { phase: "solo-points", stage: 1, done: index + 1, total: candidates.length };
    }
    const finalists = first.sort((a, b) =>
      (b.move.score - a.move.score) * weight + b.nextPoints - a.nextPoints || byScore(a.move, b.move))
      .slice(0, POINTS_FINALISTS);
    const extended = exact ? deals : extendDeals(deals, pool, rackSize, seed ^ 0xf0dc23a1);
    yield { phase: "solo-follow-up", stage: 2, done: 0, total: finalists.length };
    for (const [index, candidate] of finalists.entries()) {
      const { move, nextPoints } = candidate;
      try {
        const followUpPoints = yield* scoreFollowUps(candidate, extended);
        ranked.push({
          move, utility: {
            kind: "solo-points", score: move.score,
            nextPoints: nextPoints / weight, followUpPoints: followUpPoints / weight,
            total: (move.score * weight + nextPoints + followUpPoints) / weight,
            samples: deals.length, exact,
          },
        });
      } catch (error) {
        handleLimit(error);
      }
      yield { phase: "solo-follow-up", stage: 2, done: index + 1, total: finalists.length };
    }
  }

  const steps = !moves.length ? [][Symbol.iterator]() : greedy ? rankGreedy() : rankTriple();
  return {
    steps,
    result() {
      // Show a provisional ranking only after at least one immediate bingo
      // has been evaluated, if there is a bingo available in this position.
      if (availableBingo && !ranked.some(({ utility }) => utility.kind === "solo-bingo" && utility.bingoNow))
        return { limited, ranked: [] };
      return {
        limited,
        ranked: [...ranked].sort((a, b) => {
          if (a.utility.kind === "solo-bingo" && b.utility.kind === "solo-bingo") {
            return Number(b.utility.bingoNow) - Number(a.utility.bingoNow) ||
              b.utility.total - a.utility.total ||
              b.utility.bingoChance - a.utility.bingoChance ||
              (byLeave[b.move.leave] ?? 0) - (byLeave[a.move.leave] ?? 0) ||
              byScore(a.move, b.move);
          }
          return b.utility.total - a.utility.total || byScore(a.move, b.move);
        }),
      };
    },
  };
}
