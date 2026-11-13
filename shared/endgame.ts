import { type Board, type BoardTemplate, type Move, tileScore } from "./model";
import { SearchLimitError } from "./solver";

export interface EndgameLine {
  spread: number;
  line: (Move | null)[];
}

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
  search: (board: Board, rack: string) => Move[],
  place: (board: Board, move: Move) => Board,
): EndgameLine {
  const value = (rack: string) => rackPoints(rack, template.rules);
  const cache = new Map<string, EndgameLine>();
  let states = 0;
  function turn(
    position: Board,
    own: string,
    other: string,
    scoreless: number,
  ): EndgameLine {
    if (scoreless >= 6) return { spread: value(other) - value(own), line: [] };
    const key = `${position.join(".")}|${own}|${other}|${scoreless}`;
    const cached = cache.get(key);
    if (cached) return cached;
    if (++states > 1_500) throw new SearchLimitError();
    let best: EndgameLine = { spread: -Infinity, line: [] };
    for (const move of [...search(position, own), null]) {
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
  return {
    spread: candidate.score - result.spread,
    line: [candidate, ...result.line],
  };
}
