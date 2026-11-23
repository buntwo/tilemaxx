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
    undefined,
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
    bingo: isBingo(template, alternative.tiles.length),
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

export type ReviewJob = { position: TurnPosition; move: TrackedMove; index: number };

export async function reviewGame(
  turns: readonly ReviewJob[],
  layout: Game["template"],
  dictionary: (id: string) => Lexicon | Promise<Lexicon>,
  solo = false,
  progress: (completed: number, total: number) => void = () => {},
): Promise<ReviewSummary> {
  const opportunities: ReviewSummary["opportunities"] = [];
  let checked = 0;
  const deadline = performance.now() + 10000;
  let defensiveChecks = 0;
  for (const [i, turn] of turns.entries()) {
    const template = turn.position.premiums
      ? { ...layout, premiums: turn.position.premiums }
      : layout;
    if (performance.now() >= deadline) break;
    try {
      const lexicon = await dictionary(turn.position.dictionaryId);
      const moves = reviewTurn(
        lexicon,
        turn.position,
        template,
        Math.min(450, Math.max(1, deadline - performance.now())),
      );
      checked++;
      const opportunity = reviewOpportunity(
        moves,
        turn.move,
        template,
        turn.position.tiles.length,
      );
      const id = turn.position.tiles
        .map(({ index, letter }) => `${index}:${letter}`)
        .sort()
        .join(",");
      const played = moves.find((move) => move.id === id);
      const alternative = moves.find(
        (move) => move.id !== id && move.score >= turn.move.score - 5,
      );
      let replyRisk;
      if (
        !solo &&
        played &&
        alternative &&
        defensiveChecks < 5 &&
        deadline - performance.now() > 1000
      ) {
        defensiveChecks++;
        try {
          replyRisk = reviewReplyRisk(
            lexicon,
            turn.position,
            template,
            played,
            alternative,
          );
        } catch {
          /* An unavailable forecast does not invalidate the score comparison. */
        }
      }
      if (opportunity.gap >= 8 || opportunity.bingo || replyRisk)
        opportunities.push({
          ...opportunity,
          index: turn.index,
          word: turn.move.word,
          score: turn.move.score,
          replyRisk,
        });
    } catch {
      // One incomplete turn should not invalidate the other opportunities.
    }
    progress(i + 1, turns.length);
  }
  opportunities.sort(
    (a, b) =>
      Number(!!b.bingo) - Number(!!a.bingo) ||
      b.gap - a.gap ||
      Number(!!b.replyRisk) - Number(!!a.replyRisk),
  );
  return { checked, total: turns.length, opportunities: opportunities.slice(0, 3) };
}
