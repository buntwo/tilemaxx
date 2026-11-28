import { sampleBingoDeals, type BingoDeal, type BingoReplyPicker } from "./bingo-replies";
import { endgameStreaks, nextEndgameStreak } from "./endgame";
import {
  evaluateSharedBatch,
  INITIAL_LEARNER_DEALS as DEALS,
  LEARNER_REPLY_DEALS,
  screenLearnerReplies,
} from "./learner-reply-screen";
import type { Lexicon } from "./lexicon";
import { createMasterEvaluator, type MasterOutcome } from "./master-evaluation";
import type { Board, BoardTemplate, Move } from "./model";
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
import { learnerAppeal, mixProfileSeed } from "./player-profile-sampling";
import { rackComposition, splitRack } from "./rack-entry";
import { createSolverFactory, SearchLimitError } from "./solver";
import { unseenTiles } from "./tile-pool";
import { stylePlacement } from "./style-explanation";

export const LEARNER_EXCHANGE_DEALS = 32;
const BUDGET_MS = { casual: 1_000, learner: 1_500 } as const;
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
  estimates: readonly { horizon: number; reply: number; followUp?: number }[],
  halfLife: number,
  replyDeals: number,
  followUpDeals?: number,
) {
  const alternatives = slate.map((entry, index) => {
    const { horizon, reply, followUp } = estimates[index];
    const lookahead = TACTICAL_WEIGHT * (horizon - estimates[0].horizon);
    const adjustedUtility = entry.value + lookahead;
    return {
      move: entry.move,
      lookahead,
      appeal: learnerAppeal(adjustedUtility, halfLife),
      adjustedUtility,
      modeledReply: reply,
      modeledFollowUp: followUp,
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
      const { lookahead, appeal, modeledReply, modeledFollowUp } = adjustment;
      return {
        move: row.move,
        utility: {
          ...row.utility,
          lookahead,
          modeledReply,
          modeledFollowUp,
          lookaheadDeals: replyDeals,
          followUpDeals,
          appeal,
          total: row.utility.total + lookahead,
        },
      };
    }),
    picked,
  );
}

function averageOutcome(deals: readonly MasterOutcome[]) {
  let reply = 0, followUp = 0, horizon = 0;
  for (const outcome of deals) {
    reply += outcome.reply;
    followUp += outcome.followUp;
    horizon += -outcome.reply + (outcome.terminal ? 1 : FOLLOW_UP_WEIGHT) * outcome.followUp + outcome.rackAdjustment;
  }
  return { reply: reply / deals.length, followUp: followUp / deals.length, horizon: horizon / deals.length };
}

function learnerOpponent(choose: ReturnType<typeof createPlayerProfiles>, playerSeed: number) {
  return (board: Board, bagSize: number): BingoReplyPicker => {
    const legalByRack = new Map<string, Move[]>();
    return (solver, rack, limits, choiceSeed) => {
      let moves = legalByRack.get(rack);
      if (!moves) {
        moves = solver.solve(rack, limits, { unsorted: true });
        legalByRack.set(rack, moves);
      }
      return choose(moves, "learner", {
        board, rack, bagSize, playerSeed,
        seed: profileWordHash(`${board.join(".")}:${rackComposition(rack)}`),
      }, { modeledReply: { choiceSeed } }).move ?? null;
    };
  };
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
    deadline = performance.now() + BUDGET_MS[profile],
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
    const pickReply = profile === "learner"
      ? learnerOpponent(choose, mixProfileSeed(playerSeed ^ 0x715df9e1))
      : undefined;
    let drawn = 0;
    const drawDeals = (count: number) => {
      const deals = sampleBingoDeals(
        pool,
        opponentSize,
        Math.min(bagSize, 3 * template.rackSize),
        count,
        random,
      );
      if (pickReply)
        for (const deal of deals) deal.replySeed = profileWordHash(`reply:${dealSeed}:${drawn++}`);
      return deals;
    };
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
    const rule = endgameStreaks[template.rules];
    const replyFirst = pickReply && rankTactically && bagSize > 2 * template.rackSize &&
      (!rule || moves.every((move) => nextEndgameStreak(rule, state.scorelessTurns, move) + 2 < rule.limit));
    const deals = drawDeals(replyFirst ? LEARNER_REPLY_DEALS : DEALS);
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
        pickReply,
      ),
    );
    try {
      const halfLife = LEARNER_HALF_LIFE[profile];
      let outcomes: MasterOutcome[][];
      if (replyFirst) {
        const screened = yield* screenLearnerReplies(evaluators, deals, deadline);
        if (!screened.replyDeals) return { ranked };
        outcomes = screened.outcomes;
        const followUpDeals = outcomes[0].length;
        const estimates = screened.totals.map((total, index) => {
          const reply = total / screened.replyDeals;
          const followUp = followUpDeals ? averageOutcome(outcomes[index]).followUp : undefined;
          return { reply, followUp, horizon: -reply + FOLLOW_UP_WEIGHT * (followUp ?? 0) };
        });
        ranked = rankPlacements(ranked, slate, estimates, halfLife, screened.replyDeals, followUpDeals);
        if (followUpDeals < DEALS) return { ranked };
      } else {
        outcomes = yield* evaluateSharedBatch(evaluators, deals, deadline);
        if (rankTactically)
          ranked = rankPlacements(ranked, slate, outcomes.map(averageOutcome), halfLife, DEALS);
      }
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
        pickReply,
      );
      const suffix = randomGenerator(dealSeed ^ 0x523fd101);
      const remix = randomGenerator(dealSeed ^ 0x48eb40a1);
      const more = drawDeals(LEARNER_EXCHANGE_DEALS - deals.length);
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
            comparedPlacement: stylePlacement(move),
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
