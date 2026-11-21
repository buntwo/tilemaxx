import { scorePlacement } from "./game-scoring";
import { type Board, type Game, type Move, type Placement } from "./model";
import { rackLetters } from "./rack-entry";

export function prepareOwnPlay(game: Game, draft: Board, direction: Move["direction"]) {
  const tiles = draft.flatMap((letter, index) =>
    letter && !game.board[index] ? [{ index, letter }] : [],
  );
  const remaining = [...rackLetters(game.rack)];
  const missing = new Map<number, string>();
  const needsBlank: Placement[] = [];

  function useTile(letter: string) {
    const slot = remaining.indexOf(letter);
    if (slot === -1) return false;
    remaining.splice(slot, 1);
    return true;
  }

  for (const tile of tiles) {
    if (tile.letter === tile.letter.toLowerCase()) {
      if (!useTile("?")) missing.set(tile.index, "blank");
    } else if (!useTile(tile.letter)) {
      needsBlank.push(tile);
    }
  }
  for (const tile of needsBlank) {
    if (useTile("?")) tile.letter = tile.letter.toLowerCase();
    else missing.set(tile.index, tile.letter);
  }

  const board = [...game.board];
  for (const tile of tiles) board[tile.index] = tile.letter;
  let move: Move | undefined;
  const scored = tiles.length > 0 && !missing.size &&
    scorePlacement(game.board, board, game.template, tiles.length === 1 ? direction : undefined);
  if (scored) {
    const [main, ...crosses] = scored.words;
    const start = main.cells[0];
    move = {
      id: `own-${start}-${main.direction}-${scored.word}`,
      word: scored.word,
      row: Math.floor(start / game.template.size),
      col: start % game.template.size,
      direction: main.direction,
      score: scored.score,
      tiles,
      leave: remaining.join(""),
      blanks: tiles.filter(({ letter }) => letter === letter.toLowerCase()).length,
      crosses: crosses.map(({ word }) => word),
    };
  }
  return { board, tiles, missing, move };
}

export function missingRackLabel(missing: ReadonlyMap<number, string>) {
  const counts = new Map<string, number>();
  for (const [, letter] of [...missing].sort(([left], [right]) => left - right))
    counts.set(letter, (counts.get(letter) ?? 0) + 1);
  return [...counts].map(([letter, count]) =>
    count === 1 ? letter : `${letter} ×${count}`,
  ).join(", ");
}
