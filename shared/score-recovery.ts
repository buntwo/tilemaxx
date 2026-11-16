import type { scorePlacement } from "./game-scoring";
import {
  BOARD_EDIT_LABELS,
  type Board,
  type BoardTemplate,
  type Game,
  type HistoryEntry,
  type Player,
  type TrackedMove,
  type TurnPosition,
} from "./model";

type ScorePlacement = typeof scorePlacement;

export const REBUILT_SCORES = "Rebuilt scores";
export const IMPORTED_SCREENSHOT = "Imported screenshot";
export const IMPORTED_LAYOUT = "Imported board layout";
export const CLEARED_BOARD = "Cleared board and rack";

export const boardEditLabels = new Set<string>(
  Object.values(BOARD_EDIT_LABELS),
);

export function historyPremiums(game: Game) {
  let premiums = game.template.premiums;
  return game.past
    .map((entry) => entry.premiums)
    .reverse()
    .map((previous) => {
      premiums = previous ?? premiums;
      return premiums;
    })
    .reverse();
}

export function retainsTiles(before: Board, after: Board) {
  return before.every((tile, index) => !tile || tile === after[index]);
}

export type PendingOpponentTurn = {
  base: Board;
  board: Board;
  play: NonNullable<ReturnType<ScorePlacement>>;
};

export type PendingOpponentTurns =
  | []
  | [PendingOpponentTurn]
  | [PendingOpponentTurn, PendingOpponentTurn & { split: number }];

export function splitOpponentTurns(
  scorePlacement: ScorePlacement,
  base: Board,
  board: Board,
  template: BoardTemplate,
  past: HistoryEntry[],
  start = 0,
): PendingOpponentTurns {
  for (let i = start; i < past.length; i++) {
    const after = past[i + 1]?.board ?? board;
    if (past[i].board.some((tile, cell) => tile && tile !== after[cell]))
      return [];
  }
  let turns: PendingOpponentTurns = [];
  for (let split = start + 1; split < past.length; split++) {
    const between = past[split].board;
    const first = scorePlacement(base, between, template);
    if (!first) continue;
    const second = scorePlacement(between, board, template);
    if (!second) continue;
    if (turns.length) return [];
    turns = [
      { base, board: between, play: first },
      { base: between, board, play: second, split },
    ];
  }
  return turns;
}

export function recoverUntrackedMoves(
  scorePlacement: ScorePlacement,
  game: Game,
  saved: TrackedMove[],
  countedStart: number,
) {
  const { past } = game;
  const after = (index: number) => past[index + 1] ?? game;
  let reset = -1;
  let rebuilt = -1;
  for (const [i, entry] of past.entries()) {
    if (
      entry.label === CLEARED_BOARD ||
      entry.label === IMPORTED_LAYOUT ||
      (entry.label === IMPORTED_SCREENSHOT &&
        !retainsTiles(entry.board, after(i).board))
    ) {
      reset = i;
    }
    if (entry.label === REBUILT_SCORES) rebuilt = i;
  }
  const start = game.scoring?.historyStart ?? (reset >= 0 ? countedStart : 0);
  // A previous rebuild already consumed those edits. Subsequent undo leaves
  // that boundary and its log together, so enabling again is idempotent.
  const first = Math.max(reset, rebuilt) + 1;
  const premiums = historyPremiums(game);
  const moves = saved.slice(0, start);
  let anchor = start;
  let incomplete = game.scoring?.incomplete ?? false;
  const initialBoard = past[first]?.board ?? game.board;
  if (first === 0 || (first === reset + 1 && reset > rebuilt)) {
    const placed = new Map<number, Set<string>>();
    for (const move of saved.slice(start)) {
      for (const tile of move.review?.tiles ?? []) {
        const letters = placed.get(tile.index) ?? new Set<string>();
        letters.add(tile.letter);
        placed.set(tile.index, letters);
      }
    }
    incomplete ||= initialBoard.some(
      (tile, i) => !!tile && !placed.get(i)?.has(tile),
    );
  }

  // Legacy logs may contain an explicitly inserted move without a board
  // snapshot. Pair it once with a matching replayed play instead of adding it twice.
  const manual = new Map<TrackedMove, TurnPosition | undefined>(
    saved
      .slice(start)
      .filter(
        (move) =>
          !move.review &&
          !past.some(
            (entry) =>
              entry.player === move.player &&
              entry.at === move.at &&
              entry.label === move.word &&
              entry.score === move.score,
          ),
      )
      .map((move) => [move, undefined]),
  );
  function append(move: TrackedMove) {
    for (const [entry, position] of manual) {
      if (
        !position &&
        entry.player === move.player &&
        entry.word === move.word
      ) {
        manual.set(entry, move.review);
        return;
      }
    }
    moves.push(move);
  }

  function appendSaved(end = saved.length) {
    for (const move of saved.slice(anchor, end)) {
      const review = manual.get(move);
      moves.push(review ? { ...move, review } : move);
      manual.delete(move);
    }
    anchor = end;
  }

  let edits: HistoryEntry[] = [];
  function flushEdits(board: Board, template: BoardTemplate) {
    const [entry] = edits;
    if (!entry) return;
    const base = entry.scoring?.pendingBase ?? entry.board;
    const play = scorePlacement(base, board, template);
    if (play) {
      append(
        replayedMove(game, entry, "opponent", base, board, template, play),
      );
    } else {
      const [first, second] = splitOpponentTurns(
        scorePlacement,
        base,
        board,
        template,
        edits,
      );
      if (first && second) {
        append(
          replayedMove(
            game,
            entry,
            "opponent",
            first.base,
            first.board,
            template,
            first.play,
          ),
        );
        append(
          replayedMove(
            game,
            edits[second.split],
            "opponent",
            second.base,
            second.board,
            template,
            second.play,
          ),
        );
      } else {
        incomplete ||= board.some((tile, i) => !!tile && !base[i]);
      }
    }
    edits = [];
  }

  // Keep the recorded log as the authority for explicitly scored or corrected
  // moves. Its matching history entries anchor newly recovered plays in order.
  for (let i = first; i < past.length; i++) {
    const entry = past[i];
    const board = after(i).board;
    const template = { ...game.template, premiums: premiums[i] };
    if (boardEditLabels.has(entry.label)) {
      if (!entry.trackedMoves) edits.push(entry);
      continue;
    }
    if (
      entry.label === "Confirmed board correction" ||
      entry.player === "opponent"
    ) {
      edits = [];
    } else if (
      entry.score !== undefined ||
      entry.label === IMPORTED_SCREENSHOT ||
      entry.label === "Ended game"
    ) {
      flushEdits(entry.board, template);
    }
    if (entry.label === IMPORTED_SCREENSHOT) {
      incomplete ||= board.some((tile, i) => !!tile && !entry.board[i]);
    }
    if (entry.player) {
      const match = saved.findIndex(
        (move, index) =>
          index >= anchor &&
          move.at === entry.at &&
          move.player === entry.player &&
          move.word === entry.label &&
          move.score === entry.score,
      );
      const corrected =
        match < 0
          ? saved.findIndex(
              (move, index) =>
                index >= anchor &&
                move.at === entry.at &&
                (entry.review
                  ? move.review?.tiles.every(
                      (tile, i) => tile.index === entry.review?.tiles[i]?.index,
                    ) && move.review?.tiles.length === entry.review.tiles.length
                  : !move.review),
            )
          : match;
      if (corrected >= 0) appendSaved(corrected + 1);
    } else if (entry.score !== undefined && !entry.scoring?.end) {
      const play = scorePlacement(
        entry.board,
        board,
        template,
        entry.review?.direction,
      );
      if (play)
        append(
          replayedMove(game, entry, "you", entry.board, board, template, play),
        );
      else incomplete ||= board.some((tile, i) => !!tile && !entry.board[i]);
    }
  }
  flushEdits(game.board, game.template);
  appendSaved();

  return { moves, incomplete, start };
}

function replayedMove(
  game: Game,
  entry: HistoryEntry,
  player: Player,
  base: Board,
  board: Board,
  template: BoardTemplate,
  play: NonNullable<ReturnType<ScorePlacement>>,
): TrackedMove {
  return {
    player,
    word: play.words.some(({ word }) => word === entry.label)
      ? entry.label
      : play.word,
    score: play.score,
    bingo: play.bingo,
    at: entry.at,
    review: {
      board: base.map((tile, i) => (tile ? board[i] : "")),
      ...(player === "you" && {
        rack: entry.rack,
        excludedRackSlots: entry.excludedRackSlots,
        ...(entry.requiredRackSlots?.length && {
          requiredRackSlots: entry.requiredRackSlots,
        }),
      }),
      dictionaryId: entry.review?.dictionaryId ?? game.dictionaryId,
      premiums: template.premiums,
      tiles: board.flatMap((letter, index) =>
        letter && !base[index] ? [{ index, letter }] : [],
      ),
      direction: entry.review?.direction ?? play.words[0].direction,
    },
  };
}
