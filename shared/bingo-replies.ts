import type { Board, Move } from "./model";
import { sampleTiles } from "./move-analysis";
import {
  SEARCH_LIMITS,
  SearchLimitError,
  type createSolverFactory,
} from "./solver";

export type BingoDeal = { opponent: string; bag: string; weight?: number };

export function sampleBingoDeals(
  pool: string[],
  opponentSize: number,
  draw: number,
  count: number,
  random: () => number,
): BingoDeal[] {
  return Array.from({ length: count }, () => {
    const order = sampleTiles(pool, opponentSize + draw, random);
    return {
      opponent: [...order.slice(0, opponentSize)].sort().join(""),
      bag: order.slice(opponentSize),
    };
  });
}

type Solver = ReturnType<ReturnType<typeof createSolverFactory>>;

export function createBingoReplySearch<T>(
  factory: ReturnType<typeof createSolverFactory>,
  board: Board,
  rankLeave: boolean,
  check: (
    solver: Solver,
    rack: string,
    limits: { maxMs: number },
    board: Board,
    reply: Move | null,
  ) => T,
) {
  const baseline = factory(board);
  const replies = new Map<string, Move | null>();
  const followups = new Map<
    string | null,
    { board: Board; solver: Solver; racks: Map<string, T> }
  >();

  function limits(deadline: number) {
    const maxMs = Math.min(SEARCH_LIMITS.maxMs, deadline - performance.now());
    if (maxMs <= 0) throw new SearchLimitError("time");
    return { maxMs };
  }

  return {
    reply(opponent: string, deadline: number) {
      if (!opponent) return null;
      if (!replies.has(opponent))
        replies.set(
          opponent,
          baseline.bestReply(opponent, rankLeave, limits(deadline)),
        );
      return replies.get(opponent) ?? null;
    },
    followUp(reply: Move | null, rack: string, deadline: number) {
      const key = reply?.id ?? null;
      const cached = followups.get(key);
      if (cached) followups.delete(key);
      const next = cached?.board ?? (reply ? factory.place(board, reply) : board);
      const after = cached ?? {
        board: next,
        solver: reply ? factory(next) : baseline,
        racks: new Map<string, T>(),
      };
      followups.set(key, after);
      if (followups.size > 32) followups.delete(followups.keys().next().value!);
      const result = after.racks.get(rack);
      if (result !== undefined) return result;
      const outcome = check(after.solver, rack, limits(deadline), after.board, reply);
      after.racks.set(rack, outcome);
      return outcome;
    },
  };
}
