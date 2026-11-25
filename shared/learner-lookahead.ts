import { sampleBingoDeals } from "./bingo-replies";
import type { Lexicon } from "./lexicon";
import { createMasterEvaluator } from "./master-evaluation";
import type { BoardTemplate } from "./model";
import { randomGenerator } from "./move-analysis";
import {
  profileWordHash,
  type createPlayerProfiles,
  type LearnerCandidate,
  type ProfilePosition,
  type RankedProfileMove,
} from "./player-profiles";
import {
  DEFAULT_PROFILE_APPEAL,
  profileAppeal,
  sampleProfilePlacements,
} from "./player-profile-sampling";
import { rackComposition } from "./rack-entry";
import { createSolverFactory, SearchLimitError } from "./solver";
import { unseenTiles } from "./tile-pool";

const DEALS = 8;
const BUDGET_MS = 1_000;
const FOLLOW_UP_WEIGHT = 0.5;
const TACTICAL_WEIGHT = 0.55;

export function createLearnerLookahead(
  lexicon: Lexicon,
  template: BoardTemplate,
  choose: ReturnType<typeof createPlayerProfiles>,
) {
  const factory = createSolverFactory(lexicon, template, true);
  return function* (
    position: ProfilePosition,
    ranked: readonly RankedProfileMove[],
    slate: readonly LearnerCandidate[],
    deadline = performance.now() + BUDGET_MS,
  ): Generator<void, readonly RankedProfileMove[], void> {
    const { board, rack, bagSize, playerSeed, seed } = position;
    if (
      position.solo ||
      !Number.isInteger(bagSize) ||
      bagSize <= 0 ||
      slate.length < 2
    )
      return ranked;
    const { tiles, total, excess } = unseenTiles(position, template);
    const opponentSize = total - bagSize;
    if (excess.length || opponentSize < 1 || opponentSize > template.rackSize)
      return ranked;

    const deals = sampleBingoDeals(
      tiles.flatMap(({ symbol, count }) => Array<string>(count).fill(symbol)),
      opponentSize,
      Math.min(bagSize, 3 * template.rackSize),
      DEALS,
      randomGenerator(
        profileWordHash(
          `${board.join(".")}:${rackComposition(rack)}:${bagSize}`,
        ),
      ),
    );
    const horizons: number[] = [];
    try {
      for (const { move } of slate) {
        if (performance.now() >= deadline) return ranked;
        const evaluate = createMasterEvaluator(
          factory,
          {
            ...position,
            template,
            scorelessTurns: position.scorelessTurns ?? 0,
          },
          {
            move,
            leave: move.leave,
            draw: Math.min(bagSize, move.tiles.length),
          },
          { reply: 1, leaf: 1, followUp: FOLLOW_UP_WEIGHT },
          (moves, board, rack, bagSize) =>
            choose(moves, "learner", {
              board,
              rack,
              bagSize,
              playerSeed,
              seed: profileWordHash(
                `${board.join(".")}:${rackComposition(rack)}`,
              ),
            }).move,
        );
        let total = 0;
        for (const deal of deals) {
          if (performance.now() >= deadline) return ranked;
          const { reply, followUp, rackAdjustment, terminal } = evaluate(
            deal,
            deadline,
          );
          total +=
            -reply +
            (terminal ? 1 : FOLLOW_UP_WEIGHT) * followUp +
            rackAdjustment;
          yield;
        }
        horizons.push(total / DEALS);
      }
    } catch (error) {
      if (!(error instanceof SearchLimitError)) throw error;
      return ranked;
    }

    if (performance.now() >= deadline) return ranked;
    const alternatives = slate.map((entry, index) => {
      const lookahead = TACTICAL_WEIGHT * (horizons[index] - horizons[0]);
      const appeal = profileAppeal(
        entry.value + lookahead,
        DEFAULT_PROFILE_APPEAL,
      );
      return {
        move: entry.move,
        lookahead,
        appeal,
        weight: entry.visibility * appeal,
      };
    });
    const picked = sampleProfilePlacements(alternatives, seed, 1)[0].move;
    const adjustments = new Map(
      alternatives.map((entry) => [entry.move.id, entry]),
    );
    const rescored = ranked.map((row) => {
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
    });
    const index = rescored.findIndex(({ move }) => move.id === picked.id);
    if (index > 0) rescored.unshift(...rescored.splice(index, 1));
    return rescored;
  };
}
