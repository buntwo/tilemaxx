import { playTrackedMove, scorePlacement } from "./game-scoring";
import { type Board, type Game, type Move, type Placement } from "./model";
import { rackLetters } from "./rack-entry";
import { unseenTiles } from "./tile-pool";

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
  let placement: Move | undefined;
  const scored = tiles.length > 0 &&
    scorePlacement(game.board, board, game.template, tiles.length === 1 ? direction : undefined);
  if (scored) {
    const [main, ...crosses] = scored.words;
    const start = main.cells[0];
    placement = {
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
  return { board, tiles, missing, placement };
}

export type OwnPlayRackCorrection = {
  before: string;
  move: Move;
  unseen: number;
};

export function prepareOwnPlayRackCorrection(
  game: Game,
  placement: Move,
  leave: string,
): OwnPlayRackCorrection | { error: string } {
  const after = leave.toUpperCase().replace(/\s/g, "");
  if (!/^[A-Z?]*$/.test(after))
    return { error: "Enter letters or ? for a blank." };
  const capacity = game.template.rackSize - placement.tiles.length;
  if (after.length > capacity) {
    return {
      error: capacity ? `Enter at most ${capacity} tiles.` : "This play leaves an empty rack.",
    };
  }

  const spent = placement.tiles.map(({ letter }) =>
    letter === letter.toUpperCase() ? letter : "?",
  ).join("");
  const before = spent + after;
  const pool = unseenTiles({ board: game.board, rack: before }, game.template);
  if (pool.excess.length) {
    const symbols = pool.excess.map(({ symbol }) => symbol === "?" ? "blank" : symbol);
    return { error: `Tile count exceeded for ${symbols.join(", ")}.` };
  }
  return { before, move: { ...placement, leave: after }, unseen: pool.total };
}

export function playOwnMoveWithRackCorrection(
  game: Game,
  correction: OwnPlayRackCorrection,
  confirmedBagSize?: number,
) {
  const bagSize = Math.max(
    correction.unseen - game.template.rackSize,
    Math.min(correction.unseen, confirmedBagSize ?? 0),
  );
  const { rack, excludedRackSlots, requiredRackSlots } = game;
  const corrected = {
    ...game,
    rack: correction.before,
    excludedRackSlots: undefined,
    requiredRackSlots: undefined,
  };
  const next = playTrackedMove(corrected, correction.move, bagSize, false);
  // Turn review keeps the reconstructed rack. Undo restores what the user had
  // entered before confirming the play and its rack correction together.
  const previous = next.past.at(-1)!;
  return {
    game: {
      ...next,
      past: [...next.past.slice(0, -1), { ...previous, rack, excludedRackSlots, requiredRackSlots }],
    },
    bagSize,
  };
}

export function missingRackLabel(missing: ReadonlyMap<number, string>) {
  const counts = new Map<string, number>();
  for (const [, letter] of [...missing].sort(([left], [right]) => left - right))
    counts.set(letter, (counts.get(letter) ?? 0) + 1);
  return [...counts].map(([letter, count]) =>
    count === 1 ? letter : `${letter} ×${count}`,
  ).join(", ");
}
