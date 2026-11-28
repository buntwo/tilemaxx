import { sampleBingoDeals, type BingoDeal, type BingoReplyPicker } from "./bingo-replies";
import type { HunterPosition } from "./bingo-hunter";
import type { Lexicon } from "./lexicon";
import { createMasterEvaluator, type MasterAction, type MasterOutcome } from "./master-evaluation";
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
const INITIAL_DEALS = 8;
const LEARNER_DEALS = 32;
const BUDGET_MS = { casual: 1_000, learner: 2_000 } as const;
const FOLLOW_UP_WEIGHT = 0.5;
const TACTICAL_WEIGHT = 0.55;
const MINIMUM_SWAP_EDGE = 2;
const EXCHANGE_ERROR_MULTIPLIER = 1.3;

export type LearnerLookahead = {
  ranked: readonly RankedProfileMove[];
  exchange?: PlayerExchangeAdvice;
};

export type LearnerLinePosition = HunterPosition & Pick<ProfilePosition, "playerSeed">;
export type LearnerLineWork = {
  position: LearnerLinePosition;
  actions: MasterAction[];
  deals: BingoDeal[];
  deadline: number;
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
  const estimates = outcomes.map(averageOutcome);
  const sampleCount = outcomes[0].length;
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
          lookaheadDeals: sampleCount,
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

function* evaluatePlacements(
  evaluators: readonly ReturnType<typeof createMasterEvaluator>[],
  deals: readonly BingoDeal[],
  deadline: number,
): Generator<void, MasterOutcome[][], unknown> {
  const completed = evaluators.map((): MasterOutcome[] => []);
  try {
    for (const deal of deals) {
      for (const [index, evaluate] of evaluators.entries()) {
        if (performance.now() >= deadline) return completed;
        const outcome = evaluate(deal, deadline);
        if (performance.now() >= deadline) return completed;
        completed[index].push(outcome);
        yield;
      }
    }
  } catch (error) {
    if (!(error instanceof SearchLimitError)) throw error;
  }
  return completed;
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

export function createLearnerLineFactory(
  lexicon: Lexicon,
  template: BoardTemplate,
  choose: ReturnType<typeof createPlayerProfiles>,
  profile: LearnerStyle = "learner",
) {
  const factory = createSolverFactory(lexicon, template, true);
  const policy = { reply: 1, leaf: 1, followUp: FOLLOW_UP_WEIGHT };
  return (position: LearnerLinePosition, action: MasterAction) => {
    const { playerSeed } = position;
    return createMasterEvaluator(
      factory,
      position,
      action,
      policy,
      (moves, board, rack, bagSize) => choose(moves, profile, {
        board, rack, bagSize, playerSeed,
        seed: profileWordHash(`${board.join(".")}:${rackComposition(rack)}`),
      }).move,
      profile === "learner"
        ? learnerOpponent(choose, mixProfileSeed(playerSeed ^ 0x715df9e1))
        : undefined,
    );
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
  delegateFinalists = false,
) {
  const createEvaluator = createLearnerLineFactory(lexicon, template, choose, profile);
  return function* (
    position: ProfilePosition,
    original: readonly RankedProfileMove[],
    slate: readonly LearnerCandidate[],
    deadline = performance.now() + BUDGET_MS[profile],
    reference?: Move,
  ): Generator<void | LearnerLineWork, LearnerLookahead, MasterOutcome[][] | undefined> {
    let ranked = original;
    const { board, rack, bagSize } = position;
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
    let drawn = 0;
    const drawDeals = (count: number) => {
      const deals = sampleBingoDeals(
        pool,
        opponentSize,
        Math.min(bagSize, 3 * template.rackSize),
        count,
        random,
      );
      if (profile === "learner")
        for (const deal of deals) deal.replySeed = profileWordHash(`reply:${dealSeed}:${drawn++}`);
      return deals;
    };
    const moves = rankTactically
      ? slate.map(({ move }) => move)
      : [reference ?? ranked[0].move];
    const fullLearner = profile === "learner" && rankTactically;
    const deals = drawDeals(fullLearner ? LEARNER_DEALS : INITIAL_DEALS);
    const actions = moves.map((move) => ({
      move, leave: move.leave, draw: Math.min(bagSize, move.tiles.length), held,
    }));
    let evaluators: ReturnType<typeof createMasterEvaluator>[] | undefined;
    try {
      const delegated = fullLearner && delegateFinalists
        ? yield { position: state, actions, deals, deadline }
        : undefined;
      const outcomes = delegated ?? (yield* evaluatePlacements(
        evaluators = actions.map((action) => createEvaluator(state, action)),
        deals, deadline,
      ));
      const sharedCount = Math.min(...outcomes.map((results) => results.length));
      if (sharedCount < (fullLearner ? 1 : INITIAL_DEALS)) return { ranked };
      if (rankTactically)
        ranked = rankPlacements(ranked, slate,
          outcomes.map((results) => results.slice(0, sharedCount)), LEARNER_HALF_LIFE[profile]);
      const { advice, learnerSwap } = initialScreen ?? screen(ranked[0]?.move);
      if (!learnerSwap) return { ranked, exchange: advice };

      // Choose the exchange reference from the first shared deals.
      const totals = outcomes.map((results, index) =>
        results.slice(0, Math.min(INITIAL_DEALS, sharedCount)).reduce(
          (total, outcome) => total + spread(moves[index].score, outcome),
          0,
        ),
      );
      const best = totals.reduce(
        (top, value, index) => (value > totals[top] ? index : top),
        0,
      );
      const move = moves[best];
      const exchange = createEvaluator(state, {
        move: null,
        leave: learnerSwap.keep,
        draw: learnerSwap.returned.length,
        returned: learnerSwap.returned,
        held,
      });
      let evaluatePlayed = evaluators?.[best];
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
          outcomes[best][index] ?? (evaluatePlayed ??= createEvaluator(state, actions[best]))(deal, deadline);
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
