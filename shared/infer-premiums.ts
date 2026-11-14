import { scorePlacement } from "./game-scoring";
import {
  bingoPoints,
  emptyBoard,
  letterBonuses,
  tileScore,
  wordBonuses,
  type Board,
  type BoardTemplate,
  type Move,
  type Premium,
} from "./model";

export type OpeningTurn = {
  before: Board;
  after: Board;
  direction: Move["direction"];
  word: string;
  start: number;
  tiles: number[];
};

export function openingSequences(
  board: Board,
  template: BoardTemplate,
): OpeningTurn[][] {
  const { size, rackSize, start } = template;
  const total = board.filter(Boolean).length;
  if (!board[start] || total < 2 || total > 2 * rackSize) return [];
  const empty = emptyBoard(size);
  function turn(before: Board, after: Board): OpeningTurn | undefined {
    const scored = scorePlacement(before, after, template);
    if (!scored) return;
    const main = scored.words[0];
    return {
      before,
      after,
      direction: main.direction,
      word: main.word,
      start: main.cells[0],
      tiles: after.flatMap((tile, cell) =>
        tile && !before[cell] ? [cell] : [],
      ),
    };
  }
  const single = turn(empty, board);
  // A straight board can be a single opening or an opening with an extension.
  const sequences = single ? [[single]] : [];
  for (const step of [1, size]) {
    const sameLine = (i: number) =>
      i >= 0 &&
      i < board.length &&
      (step === size || Math.floor(i / size) === Math.floor(start / size));
    for (
      let first = start;
      sameLine(first) && board[first] && start - first < rackSize * step;
      first -= step
    ) {
      for (
        let last = start;
        sameLine(last) && board[last] && last - first < rackSize * step;
        last += step
      ) {
        const count = (last - first) / step + 1;
        if (count < 2 || count === total || total - count > rackSize) continue;
        const before = [...empty];
        for (let i = first; i <= last; i += step) before[i] = board[i];
        const opening = turn(empty, before);
        const reply = turn(before, board);
        if (opening && reply) sequences.push([opening, reply]);
      }
    }
  }
  return sequences;
}

const wordfeudPremiums: Premium[] = ["", "DL", "TL", "DW", "TW"];
export type PremiumInference = {
  matches: number;
  certain: [number, Premium][];
};

export function inferWordfeudPremiums(
  template: BoardTemplate,
  turns: readonly OpeningTurn[],
  squares: readonly (Premium | null)[],
  scores: readonly (number | null)[],
): PremiumInference {
  let matches = 1;
  const certain: [number, Premium][] = [];
  for (const [i, turn] of turns.entries()) {
    const target = scores[i];
    if (target == null) continue;
    const scored = scorePlacement(
      turn.before,
      turn.after,
      template,
      turn.direction,
    );
    if (!scored || turn.tiles.length > 7) return { matches: 0, certain: [] };
    const choices = turn.tiles.map((cell) => {
      const known = cell === template.start ? "" : squares[cell];
      return known == null ? wordfeudPremiums : [known];
    });
    const placed = new Map(turn.tiles.map((cell, slot) => [cell, slot]));
    const words = scored.words.map(({ cells }) =>
      cells.map((cell) => ({
        face: tileScore(turn.after[cell], template.rules),
        slot: placed.get(cell),
      })),
    );
    const bonus = bingoPoints(template, turn.tiles.length);
    const assignment: Premium[] = [];
    const common: (Premium | null)[] = [];
    let count = 0;
    function search(slot: number) {
      if (slot < choices.length) {
        for (const premium of choices[slot]) {
          assignment[slot] = premium;
          search(slot + 1);
        }
        return;
      }
      let score = bonus;
      for (const word of words) {
        let sum = 0,
          multiplier = 1;
        for (const { face, slot } of word) {
          const premium = slot === undefined ? "" : assignment[slot];
          sum += face * (letterBonuses[premium] ?? 1);
          multiplier *= wordBonuses[premium] ?? 1;
        }
        score += sum * multiplier;
        if (score > target!) return;
      }
      if (score !== target) return;
      for (const [j, premium] of assignment.entries()) {
        if (!count) common[j] = premium;
        else if (common[j] !== premium) common[j] = null;
      }
      count++;
    }
    search(0);
    if (!count) return { matches: 0, certain: [] };
    matches *= count;
    for (const [j, cell] of turn.tiles.entries()) {
      const premium = common[j];
      if (premium !== null && squares[cell] === null)
        certain.push([cell, premium]);
    }
  }
  return { matches, certain };
}
