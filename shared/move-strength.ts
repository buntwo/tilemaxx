import { scorePlacement } from "./game-scoring";
import type { Lexicon } from "./lexicon";
import type { BoardTemplate, TrackedMove, TurnPosition } from "./model";
import { rackLetters, rackSlotsForMove } from "./rack-entry";
import { prepareSolver, SearchLimitError } from "./solver";
import { endgameOpponentRack, unseenTiles } from "./tile-pool";

export type MoveStrengthTurn = Pick<TrackedMove, "player" | "word" | "score"> & {
  number: number;
  position: TurnPosition;
  rackOut?: boolean;
};
export type MoveStrength = { best: number; percent: number; assumedEmptyBag?: true };
export type MoveStrengthResult = Partial<Record<number, MoveStrength>>;

function comparisonRack({ player, position, rackOut }: MoveStrengthTurn, template: BoardTemplate) {
  const { board, observerRack } = position;
  const exactOpponent = player === "opponent" && observerRack !== undefined
    ? endgameOpponentRack(unseenTiles({ board, rack: observerRack }, template), template.rackSize)
    : undefined;
  const rack = rackLetters(position.rack ?? exactOpponent ?? "");
  if (!rack || rack.length > template.rackSize) return;
  const unseen = unseenTiles({ board, rack }, template);
  if (unseen.excess.length || !rackSlotsForMove({ board, rack }, position.tiles)) return;
  const assumedEmptyBag = player === "you" && rack.length < template.rackSize && unseen.total > 0 && !rackOut;
  if (assumedEmptyBag && endgameOpponentRack(unseen, template.rackSize) === undefined) return;
  return { rack, assumedEmptyBag };
}

export function analyzeMoveStrength(
  lexicon: Lexicon,
  turns: readonly MoveStrengthTurn[],
  layout: BoardTemplate,
  maxMs = 10_000,
): MoveStrengthResult {
  const results: MoveStrengthResult = {};
  const deadline = performance.now() + maxMs;
  for (const turn of turns) {
    if (performance.now() >= deadline) break;
    const { board, tiles, premiums, direction } = turn.position;
    if (board.length !== layout.size ** 2 || !tiles.length ||
        tiles.some(({ index }) => !Number.isInteger(index) || index < 0 || index >= board.length || board[index]))
      continue;
    const template = premiums?.length === board.length ? { ...layout, premiums } : layout;
    const comparison = comparisonRack(turn, template);
    if (!comparison) continue;
    const after = board.slice();
    for (const { index, letter } of tiles) after[index] = letter;
    const play = scorePlacement(board, after, template, direction);
    if (play?.score !== turn.score || !play.words.some(({ word }) => word === turn.word) ||
        !play.words.every(({ word }) => lexicon.has(word)))
      continue;
    try {
      const best = prepareSolver(lexicon, board, template).bestScore(comparison.rack, {
        maxMs: Math.min(500, Math.max(1, deadline - performance.now())),
      });
      if (!best || best < turn.score) continue;
      const percent = turn.score === best
        ? 100
        : Math.min(99.9, Math.round(1000 * turn.score / best) / 10);
      results[turn.number] = {
        best,
        percent,
        ...(comparison.assumedEmptyBag && { assumedEmptyBag: true }),
      };
    } catch (error) {
      if (!(error instanceof SearchLimitError)) throw error;
      // A timed-out search does not establish a maximum score.
    }
  }
  return results;
}
