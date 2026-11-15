import { type Board, type BoardTemplate, type Move, tileScore } from "./model";
import { SEARCH_LIMITS, SearchLimitError } from "./solver";

export interface EndgameLine {
  spread: number;
  line: (Move | null)[];
}

export class EndgameSearchLimitError extends Error {}

export const DEFAULT_ENDGAME_POSITION_LIMIT = 1_500;

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
  const cache = new Map<string, EndgameLine>();
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
  function turn(
    position: Board,
    own: string,
    other: string,
    scoreless: number,
  ): EndgameLine {
    if (scoreless >= 6) return { spread: value(other) - value(own), line: [] };
    checkTime();
    const key = `${position.join(".")}|${own}|${other}|${scoreless}`;
    const cached = cache.get(key);
    if (cached) return cached;
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
    let best: EndgameLine = { spread: -Infinity, line: [] };
    for (const move of [...moves, null]) {
      if (move && !move.leave) {
        const spread = move.score + 2 * value(other);
        if (spread > best.spread) best = { spread, line: [move] };
        continue;
      }
      const score = move?.score ?? 0;
      const response = turn(
        move ? place(position, move) : position,
        other,
        move?.leave ?? own,
        score ? 0 : scoreless + 1,
      );
      const spread = score - response.spread;
      if (spread > best.spread)
        best = { spread, line: [move, ...response.line] };
    }
    cache.set(key, best);
    return best;
  }
  if (!candidate.leave)
    return { spread: candidate.score + 2 * value(opponent), line: [candidate] };
  const result = turn(
    place(board, candidate),
    [...opponent].sort().join(""),
    candidate.leave,
    candidate.score ? 0 : priorScoreless + 1,
  );
  checkTime();
  return {
    spread: candidate.score - result.spread,
    line: [candidate, ...result.line],
  };
}
