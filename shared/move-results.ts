import type { BoardOddsResult, RackOdds } from "./bingo-odds";
import type { EndgameEstimate } from "./endgame-estimate";
import { isBingo, type BingoRules, type Move } from "./model";
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
  | "endgame"
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
  bingoCount: number;
  head: Move[];
}

export interface RequiredSquares {
  size: number;
  indices: readonly number[];
}

export interface MoveQuery {
  filter: string;
  requiredSquares?: RequiredSquares;
  sort: MoveSort;
  reversed?: boolean;
  offset: number;
  rackOdds?: RackOdds;
  boardOdds?: BoardOddsResult;
  replyDeltas?: Record<string, number>;
  endgameId?: number;
  exactEndgameSpreads?: Record<string, number>;
}

export interface EndgameRanking {
  id: number;
  checked: number;
  head: Move[];
}

export interface MovePage {
  offset: number;
  total: number;
  bingoCount: number;
  head: Move[];
  rows: Move[];
  endgame?: Record<string, EndgameEstimate>;
}

export function coversRequiredSquares(
  move: Move,
  { size, indices }: RequiredSquares,
) {
  const across = move.direction === "across";
  const line = across ? move.row : move.col;
  const start = across ? move.col : move.row;
  return indices.every((index) => {
    const row = Math.floor(index / size);
    const col = index % size;
    const position = across ? col : row;
    return (
      (across ? row : col) === line &&
      position >= start &&
      position < start + move.word.length
    );
  });
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
    "endgame",
    "length",
    "tiles",
    "bingo-draw",
    "board-bingo",
  ].includes(sort);
}

export function moveComparator(
  {
    sort,
    reversed,
    rackOdds,
    boardOdds,
    replyDeltas,
    exactEndgameSpreads,
  }: Omit<MoveQuery, "filter" | "offset" | "requiredSquares">,
  endgames?: ReadonlyMap<string, EndgameEstimate>,
) {
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
      endgame: (move) =>
        exactEndgameSpreads?.[move.id] ?? endgames?.get(move.id)?.spread,
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
  private ordered?: { key: string; moves: readonly Move[]; bingoCount: number };
  private endgame?: { id: number; estimates: Map<string, EndgameEstimate> };
  private readonly bingoCount: number;

  constructor(
    readonly moves: readonly Move[],
    private readonly bingoRules: BingoRules,
  ) {
    this.bingoCount = this.countBingos(moves);
  }

  private countBingos(moves: readonly Move[]) {
    let bingoCount = 0;
    for (const move of moves) {
      if (isBingo(this.bingoRules, move.tiles.length)) bingoCount++;
    }
    return bingoCount;
  }

  summary(searchId: number): MoveResults {
    return {
      searchId,
      total: this.moves.length,
      bingoCount: this.bingoCount,
      head: this.moves.slice(0, MOVE_HEAD_SIZE),
    };
  }

  shortlist(options: ShortlistOptions) {
    return shortlistMoves(this.moves, options);
  }

  setEndgame(
    id: number,
    estimates: Map<string, EndgameEstimate>,
  ): EndgameRanking {
    this.endgame = { id, estimates };
    this.ordered = undefined;
    const head = this.page({
      filter: "",
      sort: "endgame",
      offset: 0,
      endgameId: id,
    }).head;
    return { id, checked: estimates.size, head };
  }

  page({
    filter,
    requiredSquares,
    offset,
    endgameId,
    ...order
  }: MoveQuery): MovePage {
    const word = filter.trim().toUpperCase();
    const estimates =
      this.endgame?.id === endgameId ? this.endgame?.estimates : undefined;
    const key = JSON.stringify([word, requiredSquares, order, endgameId]);
    if (this.ordered?.key !== key) {
      const matches =
        word || requiredSquares?.indices.length
          ? this.moves.filter(
              (move) =>
                move.word.includes(word) &&
                (!requiredSquares ||
                  coversRequiredSquares(move, requiredSquares)),
            )
          : this.moves;
      const compare =
        order.sort === "score" && !order.reversed
          ? undefined
          : moveComparator(order, estimates);
      this.ordered = {
        key,
        moves: compare ? [...matches].sort(compare) : matches,
        bingoCount:
          matches === this.moves ? this.bingoCount : this.countBingos(matches),
      };
    }
    const { moves, bingoCount } = this.ordered;
    const start = Math.min(offset, Math.max(0, moves.length - MOVE_PAGE_SIZE));
    const rows = moves.slice(start, start + MOVE_PAGE_SIZE);
    return {
      offset: start,
      total: moves.length,
      bingoCount,
      head: moves.slice(0, MOVE_HEAD_SIZE),
      rows,
      endgame:
        estimates &&
        Object.fromEntries(
          rows.flatMap(({ id }) => {
            const estimate = estimates.get(id);
            return estimate ? [[id, estimate]] : [];
          }),
        ),
    };
  }
}
