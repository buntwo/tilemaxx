import {
  isBingo,
  type Game,
  type Move,
  type TrackedMove,
  type TurnPosition,
} from "./model";
import type { Lexicon } from "./lexicon";
import { solvePosition, SEARCH_LIMITS } from "./solver";
import { analyzeMoves } from "./move-analysis";
import { unseenTiles } from "./tile-pool";

export { reviewTurns } from "./game-scoring";

export function reviewTurn(
  lexicon: Lexicon,
  position: TurnPosition,
  template: Game["template"],
  maxMs = SEARCH_LIMITS.maxMs,
) {
  if (!position.rack) return [];
  return solvePosition(
    lexicon,
    { ...position, rack: position.rack },
    template,
    { maxMs },
  );
}

export function reviewOpportunity(
  moves: Move[],
  played: TrackedMove,
  template: Game["template"],
  playedTiles: number,
) {
  const best = moves[0];
  const bingo = !isBingo(template, playedTiles)
    ? moves.find((move) => isBingo(template, move.tiles.length))
    : undefined;
  const gap = Math.max(0, (best?.score ?? 0) - played.score);
  return { best, bingo, gap };
}

export function reviewReplyRisk(
  lexicon: Lexicon,
  position: TurnPosition,
  template: Game["template"],
  played: Move,
  alternative: Move,
) {
  const rack = position.rack!;
  const bagSize = Math.max(
    0,
    unseenTiles({ board: position.board, rack }, template).total -
      template.rackSize,
  );
  if (!bagSize) return;
  const result = analyzeMoves(
    lexicon,
    {
      board: position.board,
      rack,
      template,
      candidates: [played, alternative],
      bagSize,
      trials: 24,
      seed: 8017,
    },
    new Set(),
    undefined,
    900,
  );
  const [actual, other] = result.forecasts;
  if (result.trials < 12 || actual.bigAvailable - other.bigAvailable < 0.25)
    return;
  return {
    actual: actual.bigAvailable,
    alternative: other.bigAvailable,
    word: alternative.word,
    trials: result.trials,
  };
}

export type ReviewSummary = {
  checked: number;
  total: number;
  opportunities: (ReturnType<typeof reviewOpportunity> & {
    index: number;
    word: string;
    score: number;
    replyRisk?: ReturnType<typeof reviewReplyRisk>;
  })[];
};
