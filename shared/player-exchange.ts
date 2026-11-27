import { endgameStreaks, nextEndgameStreak, rackPoints } from "./endgame";
import { minimumExchangeBag } from "./exchange";
import type { Lexicon } from "./lexicon";
import type { Board, BoardTemplate, Move, Position } from "./model";
import { placeTiles, randomGenerator, sampleTiles } from "./move-analysis";
import {
  profileWordHash,
  usesLearnerPolicy,
  type createPlayerProfiles,
  type PlayerProfile,
} from "./player-profiles";
import { rackComposition, splitRack } from "./rack-entry";
import { prepareSolver, SearchLimitError } from "./solver";
import { unseenTiles } from "./tile-pool";

export interface PlayerExchangePosition extends Position {
  template: BoardTemplate;
  bagSize: number;
  scorelessTurns: number;
  profile: PlayerProfile;
  playerSeed: number;
  move?: Move;
}

type RackProblem = "balance" | "duplicates" | "awkward" | "leave";
export interface PlayerExchangeAdvice {
  slots: number[];
  profile: PlayerProfile;
  comparedWith?: Pick<Move, "word" | "score">;
  problem: RackProblem;
  edge?: number;
}

type Swap = {
  slots: number[];
  keep: string;
  returned: string;
  quality: number;
};
type ExchangeComparison = {
  position: PlayerExchangePosition;
  move: Move;
  choices: Swap[];
  pool: string[];
  opponentSize: number;
  held: string;
};
type ExchangeScreen = {
  advice?: PlayerExchangeAdvice;
  comparison?: ExchangeComparison;
  learnerSwap?: Pick<Swap, "keep" | "returned"> & { advice: PlayerExchangeAdvice };
};

export const PLAYER_EXCHANGE_SAMPLES = 16;
const FORECAST_BUDGET_MS = 1_500;
const LEARNER_MIN_HEURISTIC_EDGE = -5;
const vowels = "AEIOU";
const scoreGate = 24;
const learnerWeights: Record<string, number> = {
  Q: -7,
  V: -3.5,
  W: -2.7,
  U: -2.2,
  J: -1.8,
  X: -0.5,
  "?": 13,
  S: 6,
  E: 1,
  A: 1,
  R: 1.3,
  N: 1,
  T: 1,
};

function letterCounts(rack: string) {
  const counts: Record<string, number> = {};
  for (const tile of rack) counts[tile] = (counts[tile] ?? 0) + 1;
  return counts;
}

function vowelCount(letters: string) {
  return [...letters].filter((tile) => vowels.includes(tile)).length;
}

function noDrawChance(total: number, copies: number, draw: number) {
  let chance = 1;
  for (let i = 0; i < draw && chance; i++)
    chance *= Math.max(0, total - copies - i) / (total - i);
  return chance;
}

function rackQuality(
  { tiles, total, totals }: ReturnType<typeof unseenTiles>,
  rank: number,
  maxDraw: number,
) {
  const weights = learnerWeights;
  const target = Math.round((3 * rank) / 7);
  const vowelProbabilities = [[1]];
  // A random refill from the hidden bag is a marginal sample of the unseen pool.
  for (let draw = 1; draw <= maxDraw; draw++) {
    const previous = vowelProbabilities[draw - 1];
    const remaining = total - draw + 1;
    vowelProbabilities.push(
      Array.from(
        { length: draw + 1 },
        (_, count) =>
          ((previous[count] ?? 0) *
            Math.max(0, remaining - totals.vowel + count) +
            (previous[count - 1] ?? 0) *
              Math.max(0, totals.vowel - count + 1)) /
          remaining,
      ),
    );
  }
  const imbalance = vowelProbabilities.map((distribution) =>
    Array.from({ length: rank + 1 }, (_, kept) =>
      distribution.reduce(
        (cost, chance, drawn) =>
          cost +
          chance *
            3.2 *
            Math.max(0, Math.abs(kept + drawn - target) - 0.5) ** 1.65,
        0,
      ),
    ),
  );
  const average =
    tiles.reduce(
      (sum, { symbol, count }) => sum + count * (weights[symbol] ?? 0),
      0,
    ) / total;
  const duplicates = tiles
    .filter(({ symbol }) => symbol !== "?")
    .map(({ symbol, count }) => ({
      symbol,
      proportion: count / total,
      unseen: Array.from({ length: maxDraw + 1 }, (_, draw) =>
        noDrawChance(total, count, draw),
      ),
    }));

  return (keep: string, draw: number) => {
    const kept = letterCounts(keep);
    let value = draw * average - imbalance[draw][vowelCount(keep)];
    for (const tile of keep) value += weights[tile] ?? 0;
    for (const { symbol, proportion, unseen } of duplicates) {
      const copies = kept[symbol] ?? 0;
      const extra =
        copies + draw * proportion - (copies ? 1 : 1 - unseen[draw]);
      value -= extra * (symbol === "S" ? 0.8 : 3.2);
    }
    if (kept.Q && kept.U) value += 2.5;
    return value;
  };
}

function* subsets(slots: readonly number[], maxDraw: number) {
  for (let mask = 1; mask < 1 << slots.length; mask++) {
    const subset = slots.filter((_, bit) => mask & (1 << bit));
    if (subset.length <= maxDraw) yield subset;
  }
}

function adviceFor(
  position: PlayerExchangePosition,
  swap: Swap,
  edge?: number,
): PlayerExchangeAdvice {
  const { rack, move, profile } = position;
  const count = vowelCount(rack);
  const problem =
    count < Math.ceil((2 * rack.length) / 7) ||
    count > Math.ceil((4 * rack.length) / 7)
      ? "balance"
      : [...swap.returned].some(
            (tile) =>
              tile !== "?" && rack.indexOf(tile) !== rack.lastIndexOf(tile),
          )
        ? "duplicates"
        : /[QVWUJ]/.test(swap.returned)
          ? "awkward"
          : "leave";
  return {
    slots: swap.slots,
    profile,
    comparedWith: move && { word: move.word, score: move.score },
    problem,
    edge,
  };
}

export function screenPlayerExchange(
  position: PlayerExchangePosition,
): ExchangeScreen {
  const {
    rack,
    template,
    bagSize,
    profile,
    move,
    requiredRackSlots,
    excludedRackSlots = [],
  } = position;
  if (
    requiredRackSlots?.length ||
    rack.length !== template.rackSize ||
    rack.includes(".") ||
    bagSize < minimumExchangeBag(template, 1) ||
    (move && move.score > scoreGate)
  )
    return {};
  const unseen = unseenTiles(position, template);
  const opponentSize = unseen.total - bagSize;
  if (
    unseen.excess.length ||
    !Number.isInteger(bagSize) ||
    opponentSize < 0 ||
    opponentSize > template.rackSize
  )
    return {};
  const slots = [...rack].flatMap((_, slot) =>
    excludedRackSlots.includes(slot) ? [] : [slot],
  );
  const maxDraw = Math.min(bagSize, slots.length);
  if (!maxDraw) return {};

  const { held } = splitRack(position);
  const grade = rackQuality(
    unseen,
    rack.length,
    Math.min(bagSize, rack.length),
  );
  const seen = new Set<string>();
  const choices: Swap[] = [];
  for (const marked of subsets(slots, maxDraw)) {
    const returned = marked.map((slot) => rack[slot]).join("");
    const keep = [...rack].filter((_, slot) => !marked.includes(slot)).join("");
    const key = rackComposition(keep);
    if (seen.has(key)) continue;
    seen.add(key);
    choices.push({
      slots: marked,
      keep,
      returned,
      quality: grade(keep, marked.length),
    });
  }
  const [first, second] = choices.sort(
    (a, b) => b.quality - a.quality || a.slots.length - b.slots.length,
  );
  if (!first) return {};
  const delta = move
    ? first.quality -
      grade(move.leave, Math.min(bagSize, move.tiles.length)) -
      move.score
    : Infinity;
  const advice = delta > 1.5 ? adviceFor(position, first) : undefined;
  if (usesLearnerPolicy(profile) && move && delta >= LEARNER_MIN_HEURISTIC_EDGE)
    return {
      advice,
      learnerSwap: {
        keep: first.keep,
        returned: first.returned,
        advice: advice ?? adviceFor(position, first),
      },
    };
  if (profile !== "strong" || !move || delta < -10 || delta > 8)
    return { advice };
  const pool = unseen.tiles.flatMap(({ symbol, count }) =>
    Array<string>(count).fill(symbol),
  );
  return {
    advice,
    comparison: {
      position,
      move,
      choices: second ? [first, second] : [first],
      pool,
      opponentSize,
      held,
    },
  };
}

export function samplePlayerExchange(
  lexicon: Lexicon,
  choose: ReturnType<typeof createPlayerProfiles>,
  { position, move, choices, pool, opponentSize, held }: ExchangeComparison,
  maxMs = FORECAST_BUDGET_MS,
): { advice?: PlayerExchangeAdvice } | undefined {
  const { board, template, bagSize, scorelessTurns, playerSeed } = position;
  const deadline = performance.now() + maxMs;
  const seed = profileWordHash(
    `${board.join(".")}:${rackComposition(position.rack)}`,
  );
  const playedBoard = placeTiles(board, move);
  const playDraw = Math.min(bagSize, move.tiles.length);
  const prepared = new Map<Board, ReturnType<typeof prepareSolver>>();
  const continuations = new Map<Board, Map<string, Board>>();
  const rule = endgameStreaks[template.rules];
  const rackValue = (rack: string) => rackPoints(rack, template.rules);
  const nextStreak = (previous: number, move?: Move) =>
    rule ? nextEndgameStreak(rule, previous, move ?? null) : 0;
  const finished = (streak: number) => !!rule && streak >= rule.limit;

  function pick(
    board: Board,
    rack: string,
    bagSize: number,
    seed: number,
    playerSeed: number,
    holds = "",
  ) {
    const maxMs = Math.min(300, deadline - performance.now());
    if (maxMs <= 0) throw new SearchLimitError();
    let solver = prepared.get(board);
    if (!solver) {
      solver = prepareSolver(lexicon, board, template);
      prepared.set(board, solver);
    }
    let available = rack;
    for (const letter of holds) available = available.replace(letter, "");
    const moves = solver.solve(available, { maxMs });
    if (holds)
      for (const move of moves)
        move.leave = rackComposition(move.leave + holds);
    return choose(
      moves,
      "strong",
      { board, rack, bagSize, seed, playerSeed },
    ).move;
  }
  function afterReply(board: Board, reply: Move) {
    let byMove = continuations.get(board);
    if (!byMove) {
      byMove = new Map();
      continuations.set(board, byMove);
    }
    let next = byMove.get(reply.id);
    if (!next) {
      next = placeTiles(board, reply);
      byMove.set(reply.id, next);
    }
    return next;
  }
  function followUp(
    board: Board,
    reply: Move | undefined,
    rack: string,
    bag: string,
    opponent: string,
    streak: number,
    seed: number,
  ) {
    const replyScore = reply?.score ?? 0;
    const pointsTransfer = template.rules !== "crossplay";
    if (pointsTransfer && reply && !bag.length && !reply.leave)
      return -replyScore - 2 * rackValue(rack);
    const draw = Math.min(bag.length, reply?.tiles.length ?? 0);
    const remaining = bag.length - draw;
    const opponentRack = reply ? reply.leave + bag.slice(0, draw) : opponent;
    const updated = nextStreak(streak, reply);
    if (finished(updated))
      return -replyScore + rackValue(opponentRack) - rackValue(rack);
    const next = pick(
      reply ? afterReply(board, reply) : board,
      rack,
      remaining,
      seed,
      playerSeed,
      held,
    );
    if (pointsTransfer && next && !remaining && !next.leave)
      return next.score - replyScore + 2 * rackValue(opponentRack);
    const deduction = finished(nextStreak(updated, next))
      ? rackValue(opponentRack) -
        rackValue(
          (next?.leave ?? rack) +
            bag.slice(draw, draw + (next?.tiles.length ?? 0)),
        )
      : 0;
    return (next?.score ?? 0) - replyScore + deduction;
  }

  const totals = choices.map(() => ({ sum: 0, squares: 0 }));
  try {
    for (let trial = 1; trial <= PLAYER_EXCHANGE_SAMPLES; trial++) {
      const scenarioSeed =
        (seed ^ Math.imul(trial, 0xac564b05) ^ 0x8537bd19) >>> 0;
      const opponentSeed = scenarioSeed ^ 0x1fcedbc2;
      const order = sampleTiles(
        pool,
        pool.length,
        randomGenerator(scenarioSeed),
      );
      const opponent = order.slice(0, opponentSize);
      const bag = order.slice(opponentSize);
      const replySeed = seed ^ 0x3b68d61f;
      const nextSeed = seed ^ 0x78af31b5;
      const playStreak = nextStreak(scorelessTurns, move);
      const afterPlayRack = move.leave + bag.slice(0, playDraw);
      const playValue =
        move.score +
        (finished(playStreak)
          ? rackValue(opponent) - rackValue(afterPlayRack)
          : followUp(
              playedBoard,
              pick(
                playedBoard,
                opponent,
                bagSize - playDraw,
                replySeed,
                opponentSeed,
              ),
              afterPlayRack,
              bag.slice(playDraw),
              opponent,
              playStreak,
              nextSeed,
            ));
      // In rules that count consecutive passes, a tile exchange breaks the streak.
      const swapStreak = rule?.passesOnly ? 0 : nextStreak(scorelessTurns);
      const swapReply = finished(swapStreak)
        ? undefined
        : pick(board, opponent, bagSize, replySeed, opponentSeed);
      choices.forEach((swap, index) => {
        const rack = swap.keep + bag.slice(0, swap.slots.length);
        const remaining = bag.slice(swap.slots.length) + swap.returned;
        const remixed = sampleTiles(
          [...remaining],
          remaining.length,
          randomGenerator(scenarioSeed ^ 0x28b09e53),
        );
        const exchangeValue = finished(swapStreak)
          ? rackValue(opponent) - rackValue(rack)
          : followUp(
              board,
              swapReply,
              rack,
              remixed,
              opponent,
              swapStreak,
              nextSeed,
            );
        const delta = exchangeValue - playValue;
        totals[index].sum += delta;
        totals[index].squares += delta ** 2;
      });
    }
  } catch (error) {
    if (error instanceof SearchLimitError) return;
    throw error;
  }
  const trials = PLAYER_EXCHANGE_SAMPLES;
  let bestEdge = 2;
  let advice: PlayerExchangeAdvice | undefined;
  for (const [index, { sum, squares }] of totals.entries()) {
    const mean = sum / trials;
    const error = Math.sqrt(
      Math.max(0, squares - sum * mean) / (trials * (trials - 1)),
    );
    const conservativeEdge = mean - 0.5 * error;
    if (conservativeEdge > bestEdge) {
      bestEdge = conservativeEdge;
      advice = adviceFor(position, choices[index], mean);
    }
  }
  return { advice };
}
