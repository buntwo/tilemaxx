import {
  createEndgamePositionKeys,
  type EndgamePositionKey,
} from "./endgame-position";
import { createEndgameTable, type EndgameTableEntry } from "./endgame-table";
import type { Board, BoardTemplate, Move } from "./model";
import {
  rackPoints,
  endgameStreaks,
  nextEndgameStreak,
  finishEndgameLine,
  type EndgameLine,
} from "./endgame";
import { SearchLimitError } from "./solver";

type Flag = EndgameTableEntry["flag"];
type Entry = EndgameTableEntry;
type Result = { value: number; proved: boolean };
type Search = (board: Board, rack: string, deadline: number) => Move[];
class SliceLimit extends Error {
  constructor(readonly reason: "time" | "work") {
    super(reason);
  }
}
export const ENDGAME_TABLE_LIMIT = 250_000;
/** Search future score differences only, so entries can be reused across root
 * moves. Horizon estimates guide ordering but never certify an exact line.
 * Only completed branches enter the bounded table; interrupts preserve it.
 */
export function createEndgameSession(
  template: BoardTemplate,
  search: Search,
  place: (b: Board, m: Move) => Board,
  tableLimit = ENDGAME_TABLE_LIMIT,
) {
  const rule = endgameStreaks[template.rules];
  if (!rule) throw new Error("These rules use a fixed final round.");
  if (
    !Number.isInteger(tableLimit) ||
    tableLimit < 1 ||
    tableLimit > ENDGAME_TABLE_LIMIT
  )
    throw new Error("Invalid endgame table size.");
  const positions = createEndgamePositionKeys(template.size ** 2, place);
  place = positions.place;
  const table = createEndgameTable(tableLimit);
  const points = new Map<string, number>();
  const value = (r: string) => {
    let p = points.get(r);
    if (p === undefined) {
      p = rackPoints(r, template.rules);
      points.set(r, p);
    }
    return p;
  };
  const stats = {
    nodes: 0,
    generated: 0,
    hits: 0,
    cutoffs: 0,
    evals: 0,
    passPrunes: 0,
    outPrunes: 0,
    researches: 0,
    evictions: 0,
  };
  let deadline = 0;
  let totalNodesLimit = Infinity;
  const check = () => {
    if (performance.now() >= deadline) throw new SliceLimit("time");
    if (stats.nodes >= totalNodesLimit) throw new SliceLimit("work");
  };
  const key = positions.key;
  const save = (k: EndgamePositionKey, e: Entry) => {
    table.set(k, e);
    stats.evictions = table.evictions;
  };
  const find = (b: Board, r: string) => {
    check();
    stats.generated++;
    return search(b, r, deadline);
  };
  function turn(
    b: Board,
    own: string,
    other: string,
    streak: number,
    depth: number,
    alpha: number,
    beta: number,
  ): Result {
    check();
    stats.nodes++;
    if (streak >= rule!.limit)
      return { value: value(other) - value(own), proved: true };
    const k = key(b, own, other, streak),
      cached = table.get(k);
    const alphaOrig = alpha,
      betaOrig = beta;
    let proved = true;
    if (cached && (cached.proved || cached.depth === depth)) {
      stats.hits++;
      if (cached.flag === "exact")
        return { value: cached.value, proved: cached.proved };
      if (
        (cached.flag === "lower" && cached.value >= beta) ||
        (cached.flag === "upper" && cached.value <= alpha)
      )
        return { value: cached.value, proved: cached.proved };
      if (cached.flag === "lower") alpha = Math.max(alpha, cached.value);
      else beta = Math.min(beta, cached.value);
      proved = proved && cached.proved;
    }
    if (depth <= 0) {
      stats.evals++;
      return { value: value(other) - value(own), proved: false };
    }
    const outBonus = 2 * value(other);
    const moves = find(b, own);
    const priority = (m: Move) => m.score + 5 * m.tiles.length;
    let ordered: (Move | null)[] = [...moves].sort(
      (a, b) =>
        Number(!b.leave) - Number(!a.leave) || priority(b) - priority(a),
    );
    {
      let found = false;
      ordered = ordered.filter((m) => {
        if (!m!.leave) {
          if (found) {
            stats.outPrunes++;
            return false;
          }
          found = true;
        }
        return true;
      });
    }
    ordered.push(null);
    if (cached?.best !== undefined) {
      const index = ordered.findIndex((m) => m?.id === cached.best?.id);
      if (index > 0) ordered.unshift(ordered.splice(index, 1)[0]);
    }
    // If passing immediately ends the game, try its exact value early.
    if (streak + 1 >= rule!.limit) {
      const index = ordered.indexOf(null);
      if (index > 0) ordered.unshift(ordered.splice(index, 1)[0]);
    }
    let best = -Infinity,
      bestMove: Move | null | undefined,
      first = true;
    for (const m of ordered) {
      if (m === null && streak + 2 >= rule!.limit) {
        const upper = value(other) - value(own);
        if (upper <= alpha) {
          stats.passPrunes++;
          best = Math.max(best, upper);
          continue;
        }
      }
      const score = m?.score ?? 0;
      let result: Result;
      if (m && !m.leave) result = { value: score + outBonus, proved: true };
      else {
        const board = m ? place(b, m) : b,
          leave = m?.leave ?? own,
          next = nextEndgameStreak(rule!, streak, m);
        const child = (low: number, high: number) =>
          turn(board, other, leave, next, depth - 1, score - high, score - low);
        let r: Result;
        if (!first && Number.isFinite(alpha) && beta > alpha + 1) {
          r = child(alpha, alpha + 1);
          const v = score - r.value;
          if (v > alpha && v < beta) {
            stats.researches++;
            r = child(alpha, beta);
          }
        } else r = child(alpha, beta);
        result = { value: score - r.value, proved: r.proved };
      }
      first = false;
      proved = proved && result.proved;
      if (result.value > best) {
        best = result.value;
        bestMove = m;
      }
      if (result.value >= beta) {
        stats.cutoffs++;
        save(k, { value: result.value, flag: "lower", depth, proved, best: m });
        return { value: result.value, proved };
      }
      alpha = Math.max(alpha, result.value);
    }
    const flag: Flag =
      best <= alphaOrig ? "upper" : best >= betaOrig ? "lower" : "exact";
    save(k, { value: best, flag, depth, proved, best: bestMove });
    return { value: best, proved };
  }
  function materialize(
    b: Board,
    own: string,
    other: string,
    streak: number,
    depth: number,
    expected: number,
  ): (Move | null)[] {
    check();
    if (streak >= rule!.limit) return [];
    const cached = table.get(key(b, own, other, streak));
    const moves: (Move | null)[] = [...find(b, own), null];
    if (cached?.best !== undefined) {
      const i = moves.findIndex((m) => m?.id === cached.best?.id);
      if (i > 0) moves.unshift(moves.splice(i, 1)[0]);
    }
    for (const m of moves) {
      if (m && !m.leave) {
        if (m.score + 2 * value(other) === expected) return [m];
        continue;
      }
      const score = m?.score ?? 0,
        next = nextEndgameStreak(rule!, streak, m),
        board = m ? place(b, m) : b;
      const child = turn(
        board,
        other,
        m?.leave ?? own,
        next,
        depth - 1,
        -Infinity,
        Infinity,
      );
      if (child.proved && score - child.value === expected)
        return [
          m,
          ...materialize(
            board,
            other,
            m?.leave ?? own,
            next,
            depth - 1,
            child.value,
          ),
        ];
    }
    throw new Error("Could not reconstruct an exact optimal continuation");
  }
  const finish = (
    candidate: Move,
    opponent: string,
    spread: number,
    continuation: (Move | null)[],
  ) => {
    const line = finishEndgameLine(
      candidate,
      candidate.leave,
      opponent,
      template,
      spread,
      continuation,
    );
    if (line.points.you - line.points.opponent !== line.spread)
      throw new Error("The optimal line disagrees with its proved score.");
    return line;
  };
  return {
    stats,
    get cachedPositions() {
      return table.size;
    },
    run(
      board: Board,
      candidate: Move,
      opponent: string,
      scoreless: number,
      timeMs: number,
      nodeLimit = Infinity,
    ) {
      deadline = performance.now() + timeMs;
      totalNodesLimit = stats.nodes + nodeLimit;
      const iterations: {
        depth: number;
        ms: number;
        spread: number;
        proved: boolean;
        nodes: number;
      }[] = [];
      const started = performance.now();
      if (!candidate.leave)
        return {
          line: finish(
            candidate,
            opponent,
            candidate.score + 2 * value(opponent),
            [],
          ),
          iterations,
        };
      const after = place(board, candidate),
        own = [...opponent].sort().join(""),
        other = candidate.leave,
        streak = nextEndgameStreak(rule!, scoreless, candidate);
      // Every placement consumes a tile; at most limit-1 passes can precede it.
      const maxDepth = (own.length + other.length + 1) * rule!.limit;
      let guess = 0;
      try {
        const depths = [1, 2, 3, maxDepth].filter(
          (depth, i, all) => depth <= maxDepth && all.indexOf(depth) === i,
        );
        for (const depth of depths) {
          const before = stats.nodes;
          let low = -Infinity,
            high = Infinity,
            window = 8;
          if (depth > 1) {
            low = guess - window;
            high = guess + window;
          }
          let result: Result;
          while (true) {
            result = turn(after, own, other, streak, depth, low, high);
            if (result.value > low && result.value < high) break;
            window *= 2;
            if (result.value <= low)
              low = window > 1024 ? -Infinity : result.value - window;
            else high = window > 1024 ? Infinity : result.value + window;
            stats.researches++;
          }
          guess = result.value;
          iterations.push({
            depth,
            ms: performance.now() - started,
            spread: candidate.score - result.value,
            proved: result.proved,
            nodes: stats.nodes - before,
          });
          if (result.proved) {
            const continuation = materialize(
              after,
              own,
              other,
              streak,
              depth,
              result.value,
            );
            return {
              line: finish(
                candidate,
                opponent,
                candidate.score - result.value,
                continuation,
              ),
              iterations,
            };
          }
        }
      } catch (e) {
        if (!(e instanceof SliceLimit) && !(e instanceof SearchLimitError))
          throw e;
        return {
          iterations,
          limited: true,
          reason: e instanceof SliceLimit ? e.reason : (e.reason ?? "time"),
        };
      }
      throw new Error("Maximum depth exceeded");
    },
  };
}
