import {
  type Board,
  type BoardTemplate,
  type Move,
  type Player,
  tileScore,
} from "./model";
import { SEARCH_LIMITS, SearchLimitError } from "./solver";

export interface EndgameLine {
  spread: number;
  line: (Move | null)[];
  points: Record<Player, number>;
}

type SearchResult =
  | (Pick<EndgameLine, "spread" | "line"> & { bound: "exact" })
  | { spread: number; bound: "upper" | "lower" };

export class EndgameSearchLimitError extends Error {}

export const DEFAULT_ENDGAME_POSITION_LIMIT = 1_500;
export const SCRABBLE_SCORELESS_TURN_LIMIT = 6;

export function rackPoints(rack: string, rules: BoardTemplate["rules"]) {
  return [...rack].reduce(
    (total, letter) => total + tileScore(letter, rules),
    0,
  );
}

/** Point differential with optimal play from both known racks and an empty bag. */
export function solveEmptyBag(
  board: Board,
  candidate: Move,
  opponent: string,
  template: BoardTemplate,
  priorScoreless: number,
  search: (board: Board, rack: string, deadline: number) => Move[],
  place: (board: Board, move: Move) => Board,
  {
    timeLimitMs,
    positionLimit = DEFAULT_ENDGAME_POSITION_LIMIT,
  }: {
    timeLimitMs: number;
    positionLimit?: number;
  },
): EndgameLine {
  const value = (rack: string) => rackPoints(rack, template.rules);
  const cache = new Map<string, SearchResult>();
  const start = performance.now();
  const deadline = start + timeLimitMs;
  let states = 0;
  function stop(limit: string): never {
    const elapsed = Math.round(performance.now() - start).toLocaleString();
    const positions = `${states.toLocaleString()} ${states === 1 ? "position" : "positions"}`;
    throw new EndgameSearchLimitError(
      `Endgame search reached ${limit} after visiting ${positions} (${elapsed} ms elapsed).`,
    );
  }
  function checkTime() {
    if (performance.now() >= deadline)
      stop(`its ${timeLimitMs.toLocaleString()} ms time limit`);
  }
  function finish(
    spread: number,
    continuation: EndgameLine["line"],
  ): EndgameLine {
    const line = [candidate, ...continuation];
    const points = { you: 0, opponent: 0 };
    const racks = { you: candidate.leave, opponent };
    for (const [turn, move] of line.entries()) {
      if (!move) continue;
      const player = turn % 2 ? "opponent" : "you";
      points[player] += move.score;
      racks[player] = move.leave;
    }
    const last = line.at(-1);
    if (last && !last.leave) {
      const transfer =
        line.length % 2 ? value(racks.opponent) : -value(racks.you);
      points.you += transfer;
      points.opponent -= transfer;
    } else {
      points.you -= value(racks.you);
      points.opponent -= value(racks.opponent);
    }
    return { spread, line, points };
  }
  function turn(
    position: Board,
    own: string,
    other: string,
    scoreless: number,
    alpha: number,
    beta: number,
  ): SearchResult {
    if (scoreless >= SCRABBLE_SCORELESS_TURN_LIMIT)
      return { bound: "exact", spread: value(other) - value(own), line: [] };
    checkTime();
    const key = `${position.join(".")}|${own}|${other}|${scoreless}`;
    const cached = cache.get(key);
    if (
      cached &&
      (cached.bound === "exact" ||
        (cached.bound === "upper" && cached.spread <= alpha) ||
        (cached.bound === "lower" && cached.spread >= beta))
    )
      return cached;
    if (states === positionLimit) stop("its position limit");
    states++;
    let moves: Move[];
    try {
      moves = search(position, own, deadline);
    } catch (error) {
      if (!(error instanceof SearchLimitError)) throw error;
      if (error.reason === "time") {
        checkTime();
        stop(
          `the ${SEARCH_LIMITS.maxMs.toLocaleString()} ms move-generation limit at a single position`,
        );
      }
      if (error.reason === "nodes")
        stop(
          `the move generator’s ${SEARCH_LIMITS.maxNodes.toLocaleString()}-node limit at a single position`,
        );
      if (error.reason === "moves")
        stop(
          `the move generator’s ${SEARCH_LIMITS.maxMoves.toLocaleString()}-move limit at a single position`,
        );
      stop("a move-generation limit at a single position");
    }
    const outBonus = 2 * value(other);
    const priority = (move: Move) => move.score + (move.leave ? 0 : outBonus);
    const ordered: (Move | null)[] = [...moves].sort(
      (a, b) => priority(b) - priority(a),
    );
    ordered.push(null);
    let bestSpread = -Infinity;
    let bestLine: EndgameLine["line"] | undefined;
    for (const move of ordered) {
      const score = move?.score ?? 0;
      const response =
        move && !move.leave
          ? undefined
          : turn(
              move ? place(position, move) : position,
              other,
              move?.leave ?? own,
              score ? 0 : scoreless + 1,
              score - beta,
              score - alpha,
            );
      const spread = response ? score - response.spread : score + outBonus;
      bestSpread = Math.max(bestSpread, spread);
      if (spread >= beta) {
        const result = { bound: "lower", spread } as const;
        cache.set(key, result);
        return result;
      }
      if (spread > alpha) {
        // Strictly inside the window, the response has an exact continuation.
        alpha = spread;
        bestLine = [
          move,
          ...(response?.bound === "exact" ? response.line : []),
        ];
      }
    }
    const result: SearchResult = bestLine
      ? { bound: "exact", spread: bestSpread, line: bestLine }
      : { bound: "upper", spread: bestSpread };
    cache.set(key, result);
    return result;
  }
  if (!candidate.leave)
    return finish(candidate.score + 2 * value(opponent), []);
  const result = turn(
    place(board, candidate),
    [...opponent].sort().join(""),
    candidate.leave,
    candidate.score ? 0 : priorScoreless + 1,
    -Infinity,
    Infinity,
  );
  checkTime();
  if (result.bound !== "exact")
    throw new Error(
      "A full-window endgame search must return an exact result.",
    );
  return finish(candidate.score - result.spread, result.line);
}
