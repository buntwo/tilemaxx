import type {
  Board,
  Move,
  Placement,
  TrackedMove,
  TurnPosition,
} from "./model";

type Located = Pick<Move, "row" | "col" | "direction">;
export type NotationMove = Pick<Move, "word"> & {
  tiles: readonly Placement[];
  row?: number;
  col?: number;
  start?: number;
  direction?: Move["direction"];
};

/** A move's first square and direction. Individual square addresses stay A1-style. */
export function moveLocation(move: Located) {
  const column = String.fromCharCode(65 + move.col);
  return move.direction === "across"
    ? `${move.row + 1}${column}`
    : `${column}${move.row + 1}`;
}

export type NotationLetter = {
  letter: string;
  existing: boolean;
  blank: boolean;
};

export function moveLetters(
  move: NotationMove,
  size?: number,
  board?: Board,
): NotationLetter[] {
  if (!move.tiles)
    return [...move.word].map((letter) => ({
      letter,
      existing: false,
      blank: letter === letter.toLowerCase(),
    }));
  const placed = new Map(move.tiles.map((tile) => [tile.index, tile.letter]));
  const start =
    move.start ??
    (size !== undefined && move.row !== undefined && move.col !== undefined
      ? move.row * size + move.col
      : undefined);
  const located =
    start !== undefined && size !== undefined && move.direction !== undefined;
  const ordered =
    !located && move.tiles.length === move.word.length
      ? [...move.tiles].sort((a, b) => a.index - b.index)
      : undefined;
  return [...move.word].map((letter, offset) => {
    const index = located
      ? start + offset * (move.direction === "across" ? 1 : size)
      : undefined;
    const tile =
      index === undefined ? ordered?.[offset]?.letter : placed.get(index);
    const existing = located && tile === undefined;
    const value =
      tile ?? (index === undefined ? undefined : board?.[index]) ?? letter;
    const blank = value !== "" && value === value.toLowerCase();
    return {
      letter: blank ? letter.toLowerCase() : letter.toUpperCase(),
      existing,
      blank,
    };
  });
}

export function wordNotation(letters: readonly NotationLetter[]) {
  return letters
    .map(
      (tile, index) =>
        `${tile.existing && !letters[index - 1]?.existing ? "(" : ""}${tile.blank ? tile.letter.toLowerCase() : tile.letter.toUpperCase()}${tile.existing && !letters[index + 1]?.existing ? ")" : ""}`,
    )
    .join("");
}

export function moveNotation(move: NotationMove, size?: number, board?: Board) {
  return wordNotation(moveLetters(move, size, board));
}

/** Recover a recorded main word and its location from the saved placement. */
export function recordedMoveDetails(
  move: Pick<TrackedMove, "word" | "action" | "review">,
  position: Pick<TurnPosition, "board" | "tiles" | "direction"> | undefined,
  size: number,
): { notation: string; location?: string } {
  if (move.action) return { notation: trackedTurnLabel(move) };
  if (!position?.tiles.length) return { notation: move.word };
  const board = [...position.board];
  for (const tile of position.tiles) board[tile.index] = tile.letter;
  const first = position.tiles[0].index;
  const directions = position.direction
    ? [position.direction]
    : (["across", "down"] as const);
  for (const direction of directions) {
    const stride = direction === "across" ? 1 : size;
    let start = first;
    while (
      start >= stride &&
      (direction === "down" || start % size > 0) &&
      board[start - stride]
    )
      start -= stride;
    let word = "";
    for (
      let index = start;
      index < board.length && board[index];
      index += stride
    ) {
      if (
        direction === "across" &&
        Math.floor(index / size) !== Math.floor(start / size)
      )
        break;
      word += board[index];
    }
    if (word.toUpperCase() === move.word.toUpperCase()) {
      return {
        notation: moveNotation(
          { word, start, direction, tiles: position.tiles },
          size,
          position.board,
        ),
        location: moveLocation({
          row: Math.floor(start / size),
          col: start % size,
          direction,
        }),
      };
    }
  }
  return { notation: move.word };
}

export function trackedTurnLabel({ word, action, review }: Pick<TrackedMove, "word" | "action" | "review">) {
  if (!action) return word;
  if (action.kind === "pass") return "Pass";
  if ("slots" in action) {
    const tiles = action.slots.map((slot) => review?.rack?.[slot]).filter(Boolean);
    if (tiles.length === action.slots.length) return `Exchange ${tiles.join(" ")}`;
  }
  const count = "slots" in action ? action.slots.length : action.count;
  return count
    ? `Exchange · ${count} ${count === 1 ? "tile" : "tiles"}`
    : "Exchange · count unknown";
}

export function recordedMoveNotation(
  ...args: Parameters<typeof recordedMoveDetails>
) {
  return recordedMoveDetails(...args).notation;
}
