import type { BingoTarget } from "./bingo-draw-lanes";
import type { HunterPosition } from "./bingo-hunter";
import { endgameStreaks, nextEndgameStreak } from "./endgame";
import { scorePlacement } from "./game-scoring";
import type { Lexicon } from "./lexicon";
import { isBingo, minimumBingoTiles, type Move } from "./model";
import { placeTiles, randomGenerator, sampleTiles } from "./move-analysis";
import { profileWordHash } from "./player-profiles";
import { leaveValue } from "./rack-leave";
import { createSolverFactory, SEARCH_LIMITS, SearchLimitError } from "./solver";
import { choose } from "./tile-pool";

const MAX_DRAWS = 384;
const MAX_REPLY_RACKS = 384;
const REPLY_SAMPLES = 64;
const OPENING_SCOUT_SAMPLES = 16;
const MAX_OPENING_RACKS = 3_000;
const MAX_OPENING_REVIEW_RACKS = 1_600;
export const MIN_BINGO_CEILING = 100;

type WeightedTiles = { tiles: string; weight: number };
export type BingoCeiling = {
  draw: string;
  drawChance: number;
  bingo: BingoTarget;
  needsReply: boolean;
};

export type CeilingReply = { score: number; laneBingo: boolean; canBlock: boolean };
export type BingoCeilingResult = BingoCeiling & {
  move: Move;
  chance: number;
  laneBingoChance: number;
  blockChance: number;
  exact: boolean;
  cases: number;
};

function countsOf(tiles: Iterable<string>) {
  const counts = new Map<string, number>();
  for (const tile of tiles) counts.set(tile, (counts.get(tile) ?? 0) + 1);
  return counts;
}

/** Multiset draws retain the number of physical draws that yield each rack. */
export function weightedBingoDraws(
  pool: readonly string[],
  size: number,
  cap: number,
): WeightedTiles[] | undefined {
  const entries = [...countsOf(pool)].sort(([a], [b]) => a.localeCompare(b));
  const suffixCopies = Array<number>(entries.length + 1).fill(0);
  for (let i = entries.length - 1; i >= 0; i--) {
    suffixCopies[i] = suffixCopies[i + 1] + entries[i][1];
  }
  const draws: WeightedTiles[] = [];
  function visit(start: number, left: number, tiles: string, weight: number) {
    if (!left) {
      draws.push({ tiles, weight });
      return draws.length <= cap;
    }
    for (let i = start; i < entries.length && suffixCopies[i] >= left; i++) {
      const [tile, copies] = entries[i];
      for (let taken = 1; taken <= Math.min(copies, left); taken++) {
        if (!visit(i + 1, left - taken, tiles + tile.repeat(taken), weight * choose(copies, taken)))
          return false;
      }
    }
    return true;
  }
  return visit(0, size, "", 1) ? draws : undefined;
}

export function bingoDrawChance(pool: readonly string[], draw: string) {
  const counts = countsOf(pool);
  let weight = 1;
  for (const [tile, copies] of countsOf(draw)) {
    weight *= choose(counts.get(tile) ?? 0, copies);
  }
  return weight / choose(pool.length, draw.length);
}

export function ceilingOpponentRacks(
  pool: readonly string[],
  draw: string,
  opponentSize: number,
  random: () => number,
  needsReply = false,
) {
  const remaining = [...pool];
  for (const tile of draw) {
    const i = remaining.indexOf(tile);
    if (i < 0) throw new Error("A bingo draw exceeds the available tile counts.");
    remaining.splice(i, 1);
  }
  const cap = needsReply && draw.length === 1 && pool.length <= 16
    ? MAX_OPENING_REVIEW_RACKS : MAX_REPLY_RACKS;
  const exact = weightedBingoDraws(remaining, opponentSize, cap);
  return {
    exact: !!exact,
    racks: exact ?? sampleCeilingRacks(remaining, opponentSize, REPLY_SAMPLES, random),
  };
}

function sampleCeilingRacks(
  pool: readonly string[],
  size: number,
  samples: number,
  random: () => number,
): WeightedTiles[] {
  const racks = Array.from({ length: samples }, () => [...sampleTiles(pool, size, random)].sort().join(""));
  return [...countsOf(racks)].map(([tiles, weight]) => ({ tiles, weight }));
}

function hunterCeilingPosition(lexicon: Lexicon, position: HunterPosition, move: Move) {
  const { board, template, bagSize, scorelessTurns } = position;
  const factory = createSolverFactory(lexicon, template, true);
  const next = factory.place(board, move);
  const solver = factory(next);
  const drawSize = Math.min(bagSize, template.rackSize - move.leave.length);
  const rule = endgameStreaks[template.rules];
  const streak = rule ? nextEndgameStreak(rule, scorelessTurns, move) : 0;
  const bagAfter = bagSize - drawSize;
  const canBingoNextTurn = move.leave.length + drawSize >= minimumBingoTiles(template) &&
    (!rule || streak < rule.limit);
  const endsGame = (reply: Move | null) =>
    !!rule && ((!bagAfter && reply?.leave === "") ||
      nextEndgameStreak(rule, streak, reply) >= rule.limit);
  return { next, solver, factory, drawSize, bagAfter, endsGame, canBingoNextTurn };
}

function searchBudget(deadline: number) {
  const maxMs = Math.min(SEARCH_LIMITS.maxMs, deadline - performance.now());
  if (maxMs <= 0) throw new SearchLimitError("time");
  return { maxMs };
}

export function findBingoCeiling(
  lexicon: Lexicon,
  position: HunterPosition,
  move: Move,
  pool: readonly string[],
  opponentSize: number,
  scoutReplyOpenings: boolean,
  deadline: number,
): BingoCeiling | undefined {
  const { next, solver, factory, drawSize, bagAfter, endsGame, canBingoNextTurn } =
    hunterCeilingPosition(lexicon, position, move);
  if (!canBingoNextTurn) return;
  const draws = weightedBingoDraws(pool, drawSize, MAX_DRAWS);
  let best: BingoCeiling | undefined;
  function accept(draw: string, bingo: BingoTarget, needsReply: boolean) {
    if (bingo.score < MIN_BINGO_CEILING) return;
    const drawChance = bingoDrawChance(pool, draw);
    if (!best || bingo.score > best.bingo.score ||
        (bingo.score === best.bingo.score && drawChance > best.drawChance))
      best = { draw, drawChance, bingo, needsReply };
  }
  try {
    if (draws) {
      let peak = MIN_BINGO_CEILING - 1;
      for (const { tiles: draw } of draws) {
        const rack = move.leave + draw;
        const score = solver.bestBingoScore(rack, searchBudget(deadline));
        if (score < peak) continue;
        const bingo = solver.bestBingo(rack, searchBudget(deadline));
        if (!bingo || bingo.score < MIN_BINGO_CEILING) continue;
        accept(draw, bingo, false);
        peak = bingo.score;
      }
    } else {
      const lane = solver.bingoDrawLanes(move.leave, pool, drawSize, deadline);
      if (lane) accept(lane.draw, lane.bingo, false);
    }

    // In a small pool, enumerate opponent racks once, then check every
    // one-tile refill they leave behind. Many racks play the same reply.
    if (scoutReplyOpenings && drawSize === 1 && draws && opponentSize) {
      const random = randomGenerator(profileWordHash(move.id));
      const racks = weightedBingoDraws(pool, opponentSize, MAX_OPENING_RACKS) ??
        sampleCeilingRacks(pool, opponentSize, OPENING_SCOUT_SAMPLES * draws.length, random);
      const followups = new Map<string, { solver: ReturnType<typeof factory>; checked: Set<string> }>();
      for (const { tiles: opponent } of racks) {
        const reply = solver.bestReply(opponent, bagAfter > 0, searchBudget(deadline));
        if (!reply || endsGame(reply)) continue;
        let followup = followups.get(reply.id);
        if (!followup) {
          followup = { solver: factory(factory.place(next, reply)), checked: new Set() };
          followups.set(reply.id, followup);
        }
        const held = countsOf(opponent);
        for (const { tiles: draw, weight: copies } of draws) {
          if (followup.checked.has(draw) || (held.get(draw) ?? 0) >= copies) continue;
          followup.checked.add(draw);
          const rack = move.leave + draw;
          const score = followup.solver.bestBingoScore(rack, searchBudget(deadline));
          if (score < MIN_BINGO_CEILING || score <= (best?.bingo.score ?? 0)) continue;
          const bingo = followup.solver.bestBingo(rack, searchBudget(deadline));
          if (bingo) accept(draw, bingo, !bingoScore(lexicon, position, next, bingo));
        }
      }
    }
  } catch (error) {
    if (!(error instanceof SearchLimitError)) throw error;
  }
  return best;
}

function bingoScore(lexicon: Lexicon, position: HunterPosition, board: HunterPosition["board"], bingo: BingoTarget) {
  if (bingo.tiles.some(({ index }) => !!board[index])) return 0;
  const scored = scorePlacement(board, placeTiles(board, bingo), position.template, bingo.direction);
  return scored?.bingo &&
    scored.word === bingo.word &&
    scored.words.every(({ word }) => lexicon.has(word)) ? scored.score : 0;
}

export function prepareCeilingReplies(
  lexicon: Lexicon,
  position: HunterPosition,
  move: Move,
  ceiling: BingoCeiling,
) {
  const { next, solver, factory, bagAfter, endsGame } = hunterCeilingPosition(lexicon, position, move);
  const { bingo } = ceiling;
  const { size } = position.template;
  const targetSquares = new Set(bingo.tiles.map(({ index }) => index));
  const scores = new Map<string, number>();
  const withoutReply = ceiling.needsReply ? 0 : bingoScore(lexicon, position, next, bingo);
  function scoreAfter(reply: Move | null) {
    if (!reply) return endsGame(null) ? 0 : withoutReply;
    if (!scores.has(reply.id))
      scores.set(reply.id, endsGame(reply) ? 0 :
        bingoScore(lexicon, position, factory.place(next, reply), bingo));
    return scores.get(reply.id)!;
  }

  return (rack: string, deadline: number): CeilingReply => {
    const plays = solver.solve(rack, searchBudget(deadline), { unsorted: true });
    let best: Move | null = null;
    let bestValue = -Infinity;
    let laneBingo = false;
    for (const play of plays) {
      const value = play.score + (bagAfter > 0 ? leaveValue(play.leave) : 0);
      if (value > bestValue) {
        bestValue = value;
        best = play;
      }
      laneBingo ||= play.direction === bingo.direction &&
        (play.direction === "across" ? play.row === bingo.row : play.col === bingo.col) &&
        isBingo(position.template, play.tiles.length) &&
        play.tiles.some(({ index }) => targetSquares.has(index));
    }
    const score = scoreAfter(best);
    const canBlock = !score || ceiling.needsReply || plays.some((play) => !scoreAfter(play));
    return { score, laneBingo, canBlock };
  };
}

export function summarizeCeilingReplies(
  move: Move,
  ceiling: BingoCeiling,
  racks: readonly WeightedTiles[],
  outcomes: readonly CeilingReply[],
  exact: boolean,
): BingoCeilingResult {
  const topScore = outcomes.reduce((score, outcome) => Math.max(score, outcome.score), ceiling.bingo.score);
  let trials = 0, open = 0, claim = 0, block = 0;
  for (const [i, outcome] of outcomes.entries()) {
    const { weight } = racks[i];
    trials += weight;
    if (outcome.score === topScore) open += weight;
    if (outcome.laneBingo) claim += weight;
    if (outcome.canBlock) block += weight;
  }
  return {
    ...ceiling, bingo: { ...ceiling.bingo, score: topScore }, move, exact, cases: trials,
    chance: ceiling.drawChance * open / trials,
    laneBingoChance: claim / trials,
    blockChance: block / trials,
  };
}
