import { rackAfterMove } from "./rack-entry";

export type Premium = "" | "DL" | "TL" | "QL" | "DW" | "TW" | "QW";
export type Rules = "scrabble" | "wwf";
export interface BoardTemplate {
  id: string;
  name: string;
  size: number;
  premiums: Premium[];
  start: number;
  rackSize: number;
  bingo: number;
  rules: Rules;
  tileCounts?: Record<string, number>;
  builtin?: boolean;
}
// Lowercase letters are assigned blanks (zero points); empty cells are ''.
export type Board = string[];
export interface Position {
  board: Board;
  // A–Z are letters, ? is a blank, and . preserves an empty slot.
  rack: string;
  excludedRackSlots?: number[];
}
export type Player = "you" | "opponent";
export interface TrackedMove {
  player: Player;
  word: string;
  score: number;
  bingo?: boolean;
  at: string;
  review?: TurnPosition;
}
export interface TurnPosition {
  board: Board;
  rack?: string;
  excludedRackSlots?: number[];
  dictionaryId: string;
  tiles: Placement[];
  direction?: Move["direction"];
}
export interface PlayerScore {
  points: number;
  moves: number;
  best: number;
  bingos: number;
}
export interface GameScoring {
  you: PlayerScore;
  opponent: PlayerScore;
  pendingBase?: Board;
  imported?: boolean;
}
export interface HistoryEntry extends Position {
  label: string;
  score?: number;
  bingo?: boolean;
  player?: Player;
  scoring?: GameScoring;
  // Only score-log edits need to snapshot the whole log for undo and redo.
  trackedMoves?: TrackedMove[];
  review?: TurnPosition;
  at: string;
}
export interface Game extends Position {
  id: string;
  profileId: string;
  name: string;
  platform?: string;
  startedOn?: string;
  notes?: string;
  trackScores?: boolean;
  scoring?: GameScoring;
  template: BoardTemplate;
  trackedMoves?: TrackedMove[];
  dictionaryId: string;
  past: HistoryEntry[];
  future: HistoryEntry[];
  revision: number;
  updatedAt: string;
  archived: boolean;
  archivedBoard?: Board;
  archivedState?: ArchiveState;
}
export type ArchiveState = Pick<
  Game,
  | "rack"
  | "excludedRackSlots"
  | "scoring"
  | "trackScores"
  | "trackedMoves"
  | "past"
  | "future"
>;

export function archiveGame(game: Game): Game {
  const {
    rack,
    excludedRackSlots,
    scoring,
    trackScores,
    trackedMoves,
    past,
    future,
  } = game;
  return {
    ...game,
    archived: true,
    archivedBoard: game.board,
    archivedState: {
      rack,
      excludedRackSlots,
      scoring,
      trackScores,
      trackedMoves,
      past,
      future,
    },
  };
}

export function restoreArchivedGame(game: Game): Game {
  if (!game.archived || !game.archivedBoard) return game;
  if (!game.archivedState) {
    if (game.board.every((tile, i) => tile === game.archivedBoard?.[i]))
      return game;
    return {
      ...game,
      ...remember(game, "Restored archived board"),
      board: game.archivedBoard,
      scoring: game.scoring
        ? { ...game.scoring, pendingBase: undefined }
        : undefined,
    };
  }
  const {
    rack,
    excludedRackSlots,
    scoring,
    trackScores,
    trackedMoves,
    past,
    future,
  } = game.archivedState;
  return {
    ...game,
    board: game.archivedBoard,
    rack,
    excludedRackSlots,
    scoring,
    trackScores,
    trackedMoves,
    past,
    future,
  };
}
export const MAX_GAME_NOTES = 2000;
export interface Profile {
  id: string;
  name: string;
  gameOrder?: string[];
}

export function orderGames(games: Game[], order: readonly string[] = []) {
  const byId = new Map(games.map((game) => [game.id, game]));
  const ordered: Game[] = [];
  for (const id of order) {
    const game = byId.get(id);
    if (game) {
      ordered.push(game);
      byId.delete(id);
    }
  }
  return ordered.concat([...byId.values()]);
}
export interface Dictionary {
  id: string;
  name: string;
  count: number;
  description: string;
  builtin: boolean;
}
export interface AppState {
  profiles: Profile[];
  games: Game[];
  templates: BoardTemplate[];
  dictionaries: Dictionary[];
}
export interface Placement {
  index: number;
  letter: string;
}
export interface Move {
  id: string;
  word: string;
  row: number;
  col: number;
  direction: "across" | "down";
  score: number;
  tiles: Placement[];
  leave: string;
  blanks: number;
  crosses: string[];
}
export const SCORES: Record<Rules, Record<string, number>> = {
  scrabble: Object.fromEntries(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
      .split("")
      .map((c, i) => [
        c,
        [
          1, 3, 3, 2, 1, 4, 2, 4, 1, 8, 5, 1, 3, 1, 1, 3, 10, 1, 1, 1, 1, 4, 4,
          8, 4, 10,
        ][i],
      ]),
  ),
  wwf: Object.fromEntries(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
      .split("")
      .map((c, i) => [
        c,
        [
          1, 4, 4, 2, 1, 4, 3, 3, 1, 10, 5, 2, 4, 2, 1, 4, 10, 1, 1, 1, 2, 5, 4,
          8, 3, 10,
        ][i],
      ]),
  ),
};
export const tileScore = (letter: string, rules: Rules) =>
  letter && letter === letter.toUpperCase() ? (SCORES[rules][letter] ?? 0) : 0;
export const letterBonuses: Partial<Record<Premium, number>> = {
  DL: 2,
  TL: 3,
  QL: 4,
};
export const wordBonuses: Partial<Record<Premium, number>> = {
  DW: 2,
  TW: 3,
  QW: 4,
};
export function localDate(date = new Date()) {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}
export const coordinate = (index: number, size: number) =>
  `${String.fromCharCode(65 + (index % size))}${Math.floor(index / size) + 1}`;
export const emptyBoard = (size: number): Board => Array(size * size).fill("");

function trackedMove(
  entry: HistoryEntry,
  after?: GameScoring,
): TrackedMove | undefined {
  const beforeScore =
    entry.player &&
    (entry.scoring?.[entry.player] ?? { moves: 0, points: 0, bingos: 0 });
  const afterScore = entry.player && after?.[entry.player];
  const bingo =
    entry.bingo ??
    (beforeScore &&
    afterScore &&
    afterScore.moves === beforeScore.moves + 1 &&
    afterScore.points === beforeScore.points + (entry.score ?? 0)
      ? afterScore.bingos > beforeScore.bingos
      : undefined);
  if (entry.player && entry.score !== undefined)
    return {
      player: entry.player,
      word: entry.label,
      score: entry.score,
      ...(bingo !== undefined && { bingo }),
      ...(entry.review && { review: entry.review }),
      at: entry.at,
    };
}

export function trackedMoveHistory(game: Game): TrackedMove[] {
  if (game.trackedMoves?.every((move) => move.bingo !== undefined))
    return game.trackedMoves;
  const recent = game.past.flatMap((entry, index) => {
    const after =
      index + 1 < game.past.length
        ? game.past[index + 1].scoring
        : game.scoring;
    const move = trackedMove(entry, after);
    return move ? [move] : [];
  });
  if (!game.trackedMoves) return recent;
  // The undo history holds the most recent moves, in the same order as the log.
  const offset = game.trackedMoves.length - recent.length;
  return game.trackedMoves.map((move, index) => {
    const saved = recent[index - offset];
    return move.bingo === undefined &&
      saved?.bingo !== undefined &&
      saved.at === move.at &&
      saved.player === move.player &&
      saved.word === move.word &&
      saved.score === move.score
      ? { ...move, bingo: saved.bingo }
      : move;
  });
}

export function remember(
  game: Game,
  label: string,
  score?: number,
  player?: Player,
  bingo?: boolean,
  review?: TurnPosition,
): Pick<Game, "past" | "future" | "trackedMoves"> {
  const entry: HistoryEntry = {
    board: [...game.board],
    rack: game.rack,
    excludedRackSlots: game.excludedRackSlots,
    label,
    score,
    player,
    bingo,
    review,
    scoring: game.scoring,
    at: new Date().toISOString(),
  };
  const move = trackedMove(entry);
  const moves = trackedMoveHistory(game);
  return {
    past: [...game.past, entry].slice(-100),
    future: [],
    trackedMoves: move ? [...moves, move] : moves,
  };
}
export function applyMove(game: Game, move: Move, player?: Player): Game {
  const board = [...game.board];
  for (const tile of move.tiles) {
    if (board[tile.index])
      throw new Error("The board changed. Find moves again.");
    board[tile.index] = tile.letter;
  }
  return {
    ...game,
    ...remember(
      game,
      move.word,
      move.score,
      player,
      player ? move.tiles.length === game.template.rackSize : undefined,
      player
        ? {
            board: game.board,
            rack: game.rack,
            excludedRackSlots: game.excludedRackSlots ?? [],
            dictionaryId: game.dictionaryId,
            tiles: move.tiles,
            direction: move.direction,
          }
        : undefined,
    ),
    board,
    rack: rackAfterMove(game, move.tiles, move.leave),
  };
}
export function undo(game: Game): Game {
  const step = game.past.at(-1);
  if (!step) return game;
  return {
    ...game,
    board: step.board,
    rack: step.rack,
    excludedRackSlots: step.excludedRackSlots,
    scoring: step.scoring,
    trackedMoves:
      step.trackedMoves ??
      (trackedMove(step)
        ? trackedMoveHistory(game).slice(0, -1)
        : game.trackedMoves),
    past: game.past.slice(0, -1),
    future: [
      ...game.future,
      {
        board: game.board,
        rack: game.rack,
        excludedRackSlots: game.excludedRackSlots,
        label: step.label,
        score: step.score,
        player: step.player,
        bingo: trackedMove(step, game.scoring)?.bingo,
        review: step.review,
        scoring: game.scoring,
        trackedMoves: step.trackedMoves && trackedMoveHistory(game),
        at: step.at,
      },
    ],
  };
}
export function redo(game: Game): Game {
  const step = game.future.at(-1);
  if (!step) return game;
  const move = trackedMove(step);
  return {
    ...game,
    board: step.board,
    rack: step.rack,
    excludedRackSlots: step.excludedRackSlots,
    scoring: step.scoring,
    trackedMoves:
      step.trackedMoves ??
      (move ? [...trackedMoveHistory(game), move] : game.trackedMoves),
    past: [
      ...game.past,
      {
        board: game.board,
        rack: game.rack,
        excludedRackSlots: game.excludedRackSlots,
        label: step.label,
        score: step.score,
        player: step.player,
        bingo: move?.bingo,
        review: step.review,
        scoring: game.scoring,
        trackedMoves: step.trackedMoves && trackedMoveHistory(game),
        at: step.at,
      },
    ],
    future: game.future.slice(0, -1),
  };
}
