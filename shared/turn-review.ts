import { scorePlacement } from "./game-scoring";
import {
  trackedMoveHistory,
  type Game,
  type Move,
  type TrackedMove,
  type TurnPosition,
} from "./model";
import type { Lexicon } from "./lexicon";
import { solvePosition, SEARCH_LIMITS } from "./solver";
import { analyzeMoves } from "./move-analysis";
import { unseenTiles } from "./tile-pool";

export function reviewTurns(game: Game) {
  const used = new Set<number>();
  return trackedMoveHistory(game).map((move, index) => {
    const snapshot = move.review;
    if (snapshot && (move.player === "opponent" || snapshot.excludedRackSlots))
      return { move, index, position: snapshot };
    const pastIndex = game.past.findIndex(
      (entry, i) =>
        !used.has(i) &&
        entry.at === move.at &&
        entry.player === move.player &&
        entry.label === move.word &&
        entry.score === move.score &&
        (!snapshot ||
          (entry.rack === snapshot.rack &&
            entry.board.every((tile, cell) => tile === snapshot.board[cell]))),
    );
    if (pastIndex < 0) return { move, index, position: snapshot };
    used.add(pastIndex);
    const entry = game.past[pastIndex];
    if (snapshot) {
      // Older snapshots can recover held slots from their original undo entry.
      const position = entry.excludedRackSlots
        ? { ...snapshot, excludedRackSlots: entry.excludedRackSlots }
        : snapshot;
      return { move, index, position };
    }
    const before =
      move.player === "you" ? entry.board : entry.scoring?.pendingBase;
    if (!before) return { move, index };
    const after =
      move.player === "opponent"
        ? entry.board
        : (game.past[pastIndex + 1]?.board ?? game.board);
    const breakdown = scorePlacement(before, after, game.template);
    if (
      !breakdown ||
      breakdown.score !== move.score ||
      !breakdown.words.some((word) => word.word === move.word)
    )
      return { move, index };
    const position: TurnPosition = {
      board: before.map((tile, i) => (tile ? after[i] : "")),
      rack: move.player === "you" ? entry.rack : undefined,
      excludedRackSlots:
        move.player === "you" ? entry.excludedRackSlots : undefined,
      dictionaryId: game.dictionaryId,
      tiles: after.flatMap((letter, i) =>
        letter && !before[i] ? [{ index: i, letter }] : [],
      ),
    };
    return { move, index, position };
  });
}

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
  const bingo =
    playedTiles !== template.rackSize
      ? moves.find((move) => move.tiles.length === template.rackSize)
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
