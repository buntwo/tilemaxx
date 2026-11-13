import type { BoardOddsResult, RackOdds } from "./bingo-odds";
import type { Move } from "./model";
import { leaveValue } from "./move-analysis";
import { shortlistMoves } from "./move-shortlist";

export const MOVE_HEAD_SIZE = 30;
export const MOVE_PAGE_SIZE = 64;
export const MOVE_CACHE_LIMIT = 8;
export type MoveSort =
  | "score"
  | "word"
  | "length"
  | "tiles"
  | "leave"
  | "blanks"
  | "equity"
  | "bingo-draw"
  | "board-bingo";

export interface MoveResults {
  searchId: number;
  total: number;
  head: Move[];
}

export interface MoveQuery {
  filter: string;
  sort: MoveSort;
  offset: number;
  rackOdds?: RackOdds;
  boardOdds?: BoardOddsResult;
}

export interface MovePage {
  offset: number;
  total: number;
  head: Move[];
  rows: Move[];
}

export type ShortlistOptions = Parameters<typeof shortlistMoves>[1];

const collator = new Intl.Collator();
const comparators: Partial<Record<MoveSort, (a: Move, b: Move) => number>> = {
  word: (a, b) => collator.compare(a.word, b.word) || b.score - a.score,
  length: (a, b) => b.word.length - a.word.length || b.score - a.score,
  tiles: (a, b) => b.tiles.length - a.tiles.length || b.score - a.score,
  leave: (a, b) => collator.compare(a.leave, b.leave) || b.score - a.score,
  blanks: (a, b) => a.blanks - b.blanks || b.score - a.score,
};

export class MoveResultIndex {
  private ordered?: { key: string; moves: readonly Move[] };

  constructor(private readonly moves: readonly Move[]) {}

  summary(searchId: number): MoveResults {
    return {
      searchId,
      total: this.moves.length,
      head: this.moves.slice(0, MOVE_HEAD_SIZE),
    };
  }

  shortlist(options: ShortlistOptions) {
    return shortlistMoves(this.moves, options);
  }

  page({ filter, sort, offset, rackOdds, boardOdds }: MoveQuery): MovePage {
    const word = filter.trim().toUpperCase();
    const byLeave = sort === "bingo-draw" ? rackOdds?.byLeave : undefined;
    const byMove = sort === "board-bingo" ? boardOdds?.byMove : undefined;
    const key = JSON.stringify([word, sort, byLeave, byMove]);
    if (this.ordered?.key !== key) {
      const matches = word
        ? this.moves.filter((move) => move.word.includes(word))
        : this.moves;
      let compare = comparators[sort];
      if (sort === "equity") {
        const values = new Map<string, number>();
        for (const move of matches)
          if (!values.has(move.leave))
            values.set(move.leave, leaveValue(move.leave));
        compare = (a, b) =>
          b.score + values.get(b.leave)! - a.score - values.get(a.leave)! ||
          b.score - a.score;
      } else if (byLeave) {
        compare = (a, b) =>
          (byLeave[b.leave] ?? -1) - (byLeave[a.leave] ?? -1) ||
          b.score - a.score;
      } else if (byMove) {
        compare = (a, b) =>
          (byMove[b.id]?.chance ?? -1) - (byMove[a.id]?.chance ?? -1) ||
          b.score - a.score;
      }
      this.ordered = {
        key,
        moves: compare ? [...matches].sort(compare) : matches,
      };
    }
    const { moves } = this.ordered;
    const start = Math.min(offset, Math.max(0, moves.length - MOVE_PAGE_SIZE));
    return {
      offset: start,
      total: moves.length,
      head: moves.slice(0, MOVE_HEAD_SIZE),
      rows: moves.slice(start, start + MOVE_PAGE_SIZE),
    };
  }
}
