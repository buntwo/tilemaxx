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
  builtin?: boolean;
}
// Lowercase letters are assigned blanks (zero points); empty cells are ''.
export type Board = string[];
export interface Position {
  board: Board;
  rack: string;
}
export interface HistoryEntry extends Position {
  label: string;
  score?: number;
  at: string;
}
export interface Game extends Position {
  id: string;
  profileId: string;
  name: string;
  template: BoardTemplate;
  dictionaryId: string;
  past: HistoryEntry[];
  future: HistoryEntry[];
  revision: number;
  updatedAt: string;
  archived: boolean;
}
export interface Profile {
  id: string;
  name: string;
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
export const coordinate = (index: number, size: number) =>
  `${String.fromCharCode(65 + (index % size))}${Math.floor(index / size) + 1}`;
export const emptyBoard = (size: number): Board => Array(size * size).fill("");
export function remember(
  game: Game,
  label: string,
  score?: number,
): Pick<Game, "past" | "future"> {
  return {
    past: [
      ...game.past,
      {
        board: [...game.board],
        rack: game.rack,
        label,
        score,
        at: new Date().toISOString(),
      },
    ].slice(-100),
    future: [],
  };
}
export function applyMove(game: Game, move: Move): Game {
  const board = [...game.board];
  for (const tile of move.tiles) {
    if (board[tile.index])
      throw new Error("The board changed. Find moves again.");
    board[tile.index] = tile.letter;
  }
  return {
    ...game,
    ...remember(game, move.word, move.score),
    board,
    rack: move.leave,
  };
}
export function undo(game: Game): Game {
  const step = game.past.at(-1);
  if (!step) return game;
  return {
    ...game,
    board: step.board,
    rack: step.rack,
    past: game.past.slice(0, -1),
    future: [
      ...game.future,
      {
        board: game.board,
        rack: game.rack,
        label: step.label,
        score: step.score,
        at: step.at,
      },
    ],
  };
}
export function redo(game: Game): Game {
  const step = game.future.at(-1);
  if (!step) return game;
  return {
    ...game,
    board: step.board,
    rack: step.rack,
    past: [
      ...game.past,
      {
        board: game.board,
        rack: game.rack,
        label: step.label,
        score: step.score,
        at: step.at,
      },
    ],
    future: game.future.slice(0, -1),
  };
}
