import { sampleBingoDeals, type BingoDeal } from "./bingo-replies";
import type { Lexicon } from "./lexicon";
import { createMasterEvaluator, type MasterOutcome } from "./master-evaluation";
import type { BoardTemplate, Move } from "./model";
import { randomGenerator, sampleTiles } from "./move-analysis";
import {
  screenPlayerExchange,
  type PlayerExchangeAdvice,
} from "./player-exchange";
import {
  LEARNER_HALF_LIFE,
  profileWordHash,
  type createPlayerProfiles,
  type LearnerCandidate,
  type LearnerStyle,
  type ProfilePosition,
  type RankedProfileMove,
} from "./player-profiles";
import { learnerAppeal } from "./player-profile-sampling";
import { rackComposition, splitRack } from "./rack-entry";
import { createSolverFactory, SearchLimitError } from "./solver";
import { unseenTiles } from "./tile-pool";

const DEALS = 8;
export const LEARNER_EXCHANGE_DEALS = 32;
const BUDGET_MS = 1_000;
const FOLLOW_UP_WEIGHT = 0.5;
const TACTICAL_WEIGHT = 0.55;
const MINIMUM_SWAP_EDGE = 2;
const EXCHANGE_ERROR_MULTIPLIER = 1.3;

export type LearnerLookahead = {
  ranked: readonly RankedProfileMove[];
  exchange?: PlayerExchangeAdvice;
};

function promote(ranked: readonly RankedProfileMove[], move: Move) {
  const index = ranked.findIndex((row) => row.move.id === move.id);
  if (index <= 0) return ranked;
  return [ranked[index], ...ranked.slice(0, index), ...ranked.slice(index + 1)];
}

function rankPlacements(
  ranked: readonly RankedProfileMove[],
  slate: readonly LearnerCandidate[],
  outcomes: readonly MasterOutcome[][],
  halfLife: number,
) {
  const horizons = outcomes.map(
    (deals) =>
      deals.reduce(
        (total, { reply, followUp, rackAdjustment, terminal }) =>
          total -
          reply +
          (terminal ? 1 : FOLLOW_UP_WEIGHT) * followUp +
          rackAdjustment,
        0,
      ) / DEALS,
  );
  const alternatives = slate.map((entry, index) => {
    const lookahead = TACTICAL_WEIGHT * (horizons[index] - horizons[0]);
    const adjustedUtility = entry.value + lookahead;
    return {
      move: entry.move,
      lookahead,
      appeal: learnerAppeal(adjustedUtility, halfLife),
      adjustedUtility,
    };
  });
  const picked = alternatives.reduce((best, entry) =>
    entry.adjustedUtility > best.adjustedUtility ||
      (entry.adjustedUtility === best.adjustedUtility && entry.move.score > best.move.score)
      ? entry
      : best,
  ).move;
  const adjustments = new Map(
    alternatives.map((entry) => [entry.move.id, entry]),
  );
  return promote(
    ranked.map((row) => {
      const adjustment = adjustments.get(row.move.id);
      if (!adjustment) return row;
      const { lookahead, appeal } = adjustment;
      return {
        move: row.move,
        utility: {
          ...row.utility,
          lookahead,
          appeal,
          total: row.utility.total + lookahead,
        },
      };
    }),
    picked,
  );
}

function spread(score: number, outcome: MasterOutcome) {
  return score + outcome.followUp - outcome.reply + outcome.rackAdjustment;
}

function completeBag(
  deal: BingoDeal,
  pool: string[],
  random: () => number,
): BingoDeal {
  if (deal.opponent.length + deal.bag.length === pool.length) return deal;
  const remaining = [...pool];
  for (const tile of deal.opponent + deal.bag)
    remaining.splice(remaining.indexOf(tile), 1);
  return {
    ...deal,
    bag: deal.bag + sampleTiles(remaining, remaining.length, random),
  };
}

export function createLearnerLookahead(
  lexicon: Lexicon,
  template: BoardTemplate,
  choose: ReturnType<typeof createPlayerProfiles>,
  profile: LearnerStyle = "learner",
) {
  const factory = createSolverFactory(lexicon, template, true);
  const policy = { reply: 1, leaf: 1, followUp: FOLLOW_UP_WEIGHT };
  return function* (
    position: ProfilePosition,
    original: readonly RankedProfileMove[],
    slate: readonly LearnerCandidate[],
    deadline = performance.now() + BUDGET_MS,
    reference?: Move,
  ): Generator<void, LearnerLookahead, void> {
    let ranked = original;
    const { board, rack, bagSize, playerSeed } = position;
    if (position.solo || !Number.isInteger(bagSize) || bagSize <= 0)
      return { ranked };

    const state = {
      ...position,
      template,
      scorelessTurns: position.scorelessTurns ?? 0,
    };
    const screen = (move?: Move) =>
      screenPlayerExchange({ ...state, profile, move });
    const rankTactically = !reference && slate.length >= 2;
    const initialScreen = rankTactically
      ? undefined
      : screen(reference ?? ranked[0]?.move);
    if (initialScreen && !initialScreen.learnerSwap)
      return { ranked, exchange: initialScreen.advice };

    const { tiles, total, excess } = unseenTiles(position, template);
    const opponentSize = total - bagSize;
    if (excess.length || opponentSize < 1 || opponentSize > template.rackSize)
      return { ranked };

    const pool = tiles.flatMap(({ symbol, count }) =>
      Array<string>(count).fill(symbol),
    );
    const { held } = splitRack(position);
    const dealSeed = profileWordHash(
      `${board.join(".")}:${rackComposition(rack)}:${bagSize}`,
    );
    const random = randomGenerator(dealSeed);
    const drawDeals = (count: number) =>
      sampleBingoDeals(
        pool,
        opponentSize,
        Math.min(bagSize, 3 * template.rackSize),
        count,
        random,
      );
    const follow: NonNullable<Parameters<typeof createMasterEvaluator>[4]> = (
      moves,
      board,
      rack,
      bagSize,
    ) =>
      choose(moves, profile, {
        board,
        rack,
        bagSize,
        playerSeed,
        seed: profileWordHash(`${board.join(".")}:${rackComposition(rack)}`),
      }).move;

    const moves = rankTactically
      ? slate.map(({ move }) => move)
      : [reference ?? ranked[0].move];
    const deals = drawDeals(DEALS);
    const evaluators = moves.map((move) =>
      createMasterEvaluator(
        factory,
        state,
        {
          move,
          leave: move.leave,
          draw: Math.min(bagSize, move.tiles.length),
          held,
        },
        policy,
        follow,
      ),
    );
    const outcomes: MasterOutcome[][] = [];
    try {
      for (const evaluate of evaluators) {
        const results: MasterOutcome[] = [];
        for (const deal of deals) {
          if (performance.now() >= deadline) return { ranked };
          results.push(evaluate(deal, deadline));
          yield;
        }
        outcomes.push(results);
      }
      if (performance.now() >= deadline) return { ranked };
      if (rankTactically)
        ranked = rankPlacements(ranked, slate, outcomes, LEARNER_HALF_LIFE[profile]);
      const { advice, learnerSwap } = initialScreen ?? screen(ranked[0]?.move);
      if (!learnerSwap) return { ranked, exchange: advice };

      // Use the best full-spread placement from the first eight deals as the
      // reference. Matching the draws measures the opportunity cost of swapping.
      const totals = outcomes.map((results, index) =>
        results.reduce(
          (total, outcome) => total + spread(moves[index].score, outcome),
          0,
        ),
      );
      const best = totals.reduce(
        (top, value, index) => (value > totals[top] ? index : top),
        0,
      );
      const move = moves[best];
      const exchange = createMasterEvaluator(
        factory,
        state,
        {
          move: null,
          leave: learnerSwap.keep,
          draw: learnerSwap.returned.length,
          returned: learnerSwap.returned,
          held,
        },
        policy,
        follow,
      );
      const suffix = randomGenerator(dealSeed ^ 0x523fd101);
      const remix = randomGenerator(dealSeed ^ 0x48eb40a1);
      const more = drawDeals(LEARNER_EXCHANGE_DEALS - DEALS);
      let sum = 0;
      let squares = 0;
      for (const [index, deal] of [...deals, ...more].entries()) {
        if (performance.now() >= deadline) return { ranked };
        const swapped = exchange(
          completeBag(deal, pool, suffix),
          deadline,
          Math.floor(remix() * 2 ** 32),
        );
        const played =
          outcomes[best][index] ?? evaluators[best](deal, deadline);
        const delta = spread(0, swapped) - spread(move.score, played);
        sum += delta;
        squares += delta * delta;
        yield;
      }
      if (performance.now() >= deadline) return { ranked };
      const edge = sum / LEARNER_EXCHANGE_DEALS;
      const error = Math.sqrt(
        Math.max(0, squares - sum * edge) /
          (LEARNER_EXCHANGE_DEALS * (LEARNER_EXCHANGE_DEALS - 1)),
      );
      if (edge - EXCHANGE_ERROR_MULTIPLIER * error > MINIMUM_SWAP_EDGE)
        return {
          ranked,
          exchange: {
            ...learnerSwap.advice,
            comparedWith: { word: move.word, score: move.score },
            edge,
          },
        };
      return { ranked: advice ? promote(ranked, move) : ranked };
    } catch (error) {
      if (!(error instanceof SearchLimitError)) throw error;
      return { ranked };
    }
  };
}
