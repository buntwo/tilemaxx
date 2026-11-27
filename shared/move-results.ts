import { isSimulatedStyle, type SimulatedStyle } from "./simulated-styles";
import type { BoardOddsResult, RackOdds } from "./bingo-odds";
import type { EndgameEstimate } from "./endgame-estimate";
import { isBingo, type BingoRules, type Move } from "./model";
import { leaveValue } from "./move-analysis";
import { shortlistMoves } from "./move-shortlist";
import { usesLearnerPolicy, type PlayerProfile, type ProfileUtility, type RankedProfileMove } from "./player-profiles";
import type { MasterUtility } from "./master-evaluation";
import type { PlayerExchangeAdvice } from "./player-exchange";
import type { RankedSoloMove, SoloStyleUtility } from "./solo-styles";
import type { HunterUtility, RankedHunterMove } from "./bingo-hunter";
import { compileMoveWordFilter } from "./move-word-filter";

export type MoveStyle = PlayerProfile | SimulatedStyle;
export type CalculationSpan = { start: number; end: number };

export const MOVE_HEAD_SIZE = 30;
export const MOVE_PAGE_SIZE = 64;
export const MOVE_CACHE_LIMIT = 8;
export type MoveSort =
  | "score"
  | "playing-style"
  | "reply-adjusted"
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
  // The best score with rack marks cleared. Null means the reference search timed out or hit a work limit.
  topScore: number | null;
  head: Move[];
}

export interface RequiredSquares {
  size: number;
  indices: readonly number[];
}

export interface MoveQuery {
  filter: string;
  profile?: MoveStyle;
  profileBagSize?: number;
  profileSeed?: number;
  profileSample?: number;
  profileScorelessTurns?: number;
  profileScoreSpread?: number;
  requiredSquares?: RequiredSquares;
  sort: MoveSort;
  reversed?: boolean;
  offset: number;
  locateMoveId?: string;
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

type ProfileQuery = Pick<MoveQuery, "profile" | "profileBagSize" | "profileSeed" | "profileSample" | "profileScorelessTurns" | "profileScoreSpread">;

export function styleScorelessTurns(
  profile: MoveStyle | undefined,
  bagSize: number,
  scorelessTurns: number | undefined,
) {
  if (usesLearnerPolicy(profile) || (profile === "strong" && bagSize === 0))
    return scorelessTurns;
}

export function profileQueryKey({
  profile,
  profileBagSize = 0,
  profileSeed = 0,
  profileSample = 0,
  profileScorelessTurns,
  profileScoreSpread,
}: ProfileQuery) {
  return JSON.stringify([profile, profileBagSize, profileSeed, profileSample, profileScorelessTurns, profileScoreSpread]);
}

type RankedMove = RankedProfileMove | RankedHunterMove | RankedSoloMove | { move: Move; utility: MasterUtility };
export type MoveUtility = (ProfileUtility | HunterUtility | MasterUtility | SoloStyleUtility) & { rank: number };
type StyleExchange = { rack: string; advice?: PlayerExchangeAdvice };

export interface MovePage {
  offset: number;
  total: number;
  bingoCount: number;
  head: Move[];
  rows: Move[];
  scoreRanks: Record<string, number>;
  profileHead?: Move[];
  profileTiming?: CalculationSpan;
  styleChoice?: { move?: Move; exchange?: StyleExchange };
  utilities?: Record<string, MoveUtility>;
  endgame?: Record<string, EndgameEstimate>;
  exactEndgameCount?: number;
  locatedIndex?: number;
  error?: string;
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
    "playing-style",
    "reply-adjusted",
    "equity",
    "endgame",
    "length",
    "tiles",
    "bingo-draw",
    "board-bingo",
  ].includes(sort);
}

export function replyAdjustedPoints(move: Move, delta: number | undefined) {
  return delta === undefined ? undefined : move.score - delta;
}

function isExactEndgame(
  move: Move,
  estimates?: ReadonlyMap<string, EndgameEstimate>,
  exactSpreads?: MoveQuery["exactEndgameSpreads"],
) {
  return exactSpreads?.[move.id] !== undefined || !!estimates?.get(move.id)?.exact;
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
  exactEndgamesFirst = true,
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
      "reply-adjusted": (move) => replyAdjustedPoints(move, replyDeltas?.[move.id]),
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
      if (sort === "endgame" && exactEndgamesFirst) {
        const exactOrder =
          Number(isExactEndgame(b, endgames, exactEndgameSpreads)) -
          Number(isExactEndgame(a, endgames, exactEndgameSpreads));
        if (exactOrder) return exactOrder;
      }
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
  private ordered?: {
    key: string;
    moves: readonly Move[];
    bingoCount: number;
    exactEndgameCount?: number;
  };
  private endgame?: { id: number; estimates: Map<string, EndgameEstimate> };
  private readonly bingoCount: number;
  private readonly scoreRanks = new Map<string, number>();
  private profileOrder?: {
    key: string;
    moves: readonly Move[];
    ranked: readonly RankedMove[];
    ranks: Map<string, number>;
    timing?: CalculationSpan;
    exchange?: StyleExchange;
  };

  private hunterOrders = new Map<SimulatedStyle, NonNullable<MoveResultIndex["profileOrder"]>>();

  constructor(
    readonly moves: readonly Move[],
    private readonly bingoRules: BingoRules,
  ) {
    // The solver supplies moves in descending score order with stable tiebreaks.
    let bingoCount = 0;
    for (const [index, move] of moves.entries()) {
      this.scoreRanks.set(move.id, index + 1);
      if (isBingo(this.bingoRules, move.tiles.length)) bingoCount++;
    }
    this.bingoCount = bingoCount;
  }

  private countBingos(moves: readonly Move[]) {
    let bingoCount = 0;
    for (const move of moves) {
      if (isBingo(this.bingoRules, move.tiles.length)) bingoCount++;
    }
    return bingoCount;
  }

  summary(
    searchId: number,
    topScore: number | null = this.moves[0]?.score ?? 0,
  ): MoveResults {
    return {
      searchId,
      total: this.moves.length,
      bingoCount: this.bingoCount,
      topScore,
      head: this.moves.slice(0, MOVE_HEAD_SIZE),
    };
  }

  shortlist(options: ShortlistOptions) {
    return shortlistMoves(this.moves, options);
  }

  hasProfile(query: MoveQuery) {
    const order = isSimulatedStyle(query.profile) ? this.hunterOrders.get(query.profile) : this.profileOrder;
    return order?.key === profileQueryKey(query);
  }

  setProfile(
    query: ProfileQuery,
    ranked: readonly RankedMove[],
    timing?: CalculationSpan,
    exchange?: StyleExchange,
  ) {
    const order = {
      key: profileQueryKey(query),
      moves: ranked.map(({ move }) => move),
      ranked,
      ranks: new Map(ranked.map(({ move }, index) => [move.id, index + 1])),
      timing,
      exchange,
    };
    if (isSimulatedStyle(query.profile)) this.hunterOrders.set(query.profile, order);
    else this.profileOrder = order;
    this.ordered = undefined;
  }

  setEndgame(
    id: number,
    estimates: Map<string, EndgameEstimate>,
  ): EndgameRanking {
    this.endgame = { id, estimates };
    this.ordered = undefined;
    // Background searches pick candidates by the initial swing.
    const head = [...this.moves]
      .sort(moveComparator({ sort: "endgame" }, estimates, false))
      .slice(0, MOVE_HEAD_SIZE);
    return { id, checked: estimates.size, head };
  }

  page({
    filter,
    profile,
    profileBagSize,
    profileSeed,
    profileSample,
    profileScorelessTurns,
    profileScoreSpread,
    requiredSquares,
    offset,
    locateMoveId,
    endgameId,
    ...order
  }: MoveQuery): MovePage {
    const word = filter.trim();
    const estimates =
      this.endgame?.id === endgameId ? this.endgame?.estimates : undefined;
    const profileOrder = isSimulatedStyle(profile) ? this.hunterOrders.get(profile) : this.profileOrder;
    const profileKey = profile
      ? profileQueryKey({ profile, profileBagSize, profileSeed, profileSample, profileScorelessTurns, profileScoreSpread })
      : undefined;
    const ranked = profileOrder?.key === profileKey ? profileOrder : undefined;
    const source = profile ? ranked?.moves ?? [] : this.moves;
    const key = JSON.stringify([word, profileKey, requiredSquares, order, endgameId]);
    if (this.ordered?.key !== key) {
      const { matches: matchesWord } = compileMoveWordFilter(word);
      const matches =
        word || requiredSquares?.indices.length
          ? source.filter(
              (move) =>
                matchesWord(move.word) &&
                (!requiredSquares ||
                  coversRequiredSquares(move, requiredSquares)),
            )
          : source;
      const compare =
        (!profile && order.sort === "score" && !order.reversed) || order.sort === "playing-style"
          ? undefined
          : moveComparator(order, estimates);
      const moves = compare ? [...matches].sort(compare) : matches;
      const firstEstimated =
        order.sort === "endgame"
          ? moves.findIndex(
              (move) => !isExactEndgame(move, estimates, order.exactEndgameSpreads),
            )
          : undefined;
      this.ordered = {
        key,
        moves,
        bingoCount:
          matches === this.moves ? this.bingoCount : this.countBingos(matches),
        exactEndgameCount: firstEstimated === -1 ? moves.length : firstEstimated,
      };
    }
    const { moves, bingoCount, exactEndgameCount } = this.ordered;
    const start = Math.min(offset, Math.max(0, moves.length - MOVE_PAGE_SIZE));
    const rows = moves.slice(start, start + MOVE_PAGE_SIZE);
    return {
      offset: start,
      total: moves.length,
      bingoCount,
      head: moves.slice(0, MOVE_HEAD_SIZE),
      profileHead: ranked?.moves.slice(0, MOVE_HEAD_SIZE),
      profileTiming: ranked?.timing,
      rows,
      scoreRanks: Object.fromEntries(
        rows.map(({ id }) => [id, this.scoreRanks.get(id)!]),
      ),
      styleChoice: ranked && !isSimulatedStyle(profile)
        ? { move: ranked.moves[0], exchange: ranked.exchange }
        : undefined,
      utilities: ranked && Object.fromEntries(rows.map(({ id }) => {
        const rank = ranked.ranks.get(id)!;
        return [id, { ...ranked.ranked[rank - 1].utility, rank }];
      })),
      exactEndgameCount,
      ...(locateMoveId !== undefined && {
        locatedIndex: moves.findIndex(({ id }) => id === locateMoveId),
      }),
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
