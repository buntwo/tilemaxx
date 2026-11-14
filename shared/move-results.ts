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
  | "position"
  | "reply"
  | "shortlist"
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
  reversed?: boolean;
  offset: number;
  rackOdds?: RackOdds;
  boardOdds?: BoardOddsResult;
  replyDeltas?: Record<string, number>;
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
  position: (a, b) =>
    a.col - b.col || a.row - b.row || a.direction.localeCompare(b.direction),
  score: (a, b) => b.score - a.score,
  word: (a, b) => collator.compare(a.word, b.word),
  length: (a, b) => b.word.length - a.word.length,
  tiles: (a, b) => b.tiles.length - a.tiles.length,
  leave: (a, b) => collator.compare(a.leave, b.leave),
  blanks: (a, b) => a.blanks - b.blanks,
};

export function defaultSortDescending(sort: MoveSort) {
  return [
    "score",
    "equity",
    "length",
    "tiles",
    "bingo-draw",
    "board-bingo",
  ].includes(sort);
}

export function moveComparator({
  sort,
  reversed,
  rackOdds,
  boardOdds,
  replyDeltas,
}: Omit<MoveQuery, "filter" | "offset">) {
  const order = reversed ? -1 : 1;
  if (sort === "shortlist") return undefined;
  const values = new Map<string, number>();
  const equity = (move: Move) => {
    let score = values.get(move.leave);
    if (score === undefined) {
      score = leaveValue(move.leave);
      values.set(move.leave, score);
    }
    return move.score + score;
  };
  const metrics: Partial<Record<MoveSort, (move: Move) => number | undefined>> =
    {
      equity,
      "bingo-draw": (move) => rackOdds?.byLeave[move.leave],
      "board-bingo": (move) => boardOdds?.byMove[move.id]?.chance,
      reply: (move) => replyDeltas?.[move.id],
    };
  const metric = metrics[sort];
  if (metric) {
    const direction = defaultSortDescending(sort) ? -order : order;
    return (a: Move, b: Move) => {
      const first = metric(a);
      const second = metric(b);
      if (first === undefined || second === undefined)
        return (
          Number(first === undefined) - Number(second === undefined) ||
          b.score - a.score
        );
      return direction * (first - second) || b.score - a.score;
    };
  }
  const compare = comparators[sort];
  return (
    compare &&
    ((a: Move, b: Move) => order * compare(a, b) || b.score - a.score)
  );
}

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

  page({ filter, offset, ...order }: MoveQuery): MovePage {
    const word = filter.trim().toUpperCase();
    const key = JSON.stringify([word, order]);
    if (this.ordered?.key !== key) {
      const matches = word
        ? this.moves.filter((move) => move.word.includes(word))
        : this.moves;
      const compare =
        order.sort === "score" && !order.reversed
          ? undefined
          : moveComparator(order);
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
