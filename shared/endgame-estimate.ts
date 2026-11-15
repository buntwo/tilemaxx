import { rackPoints, SCRABBLE_SCORELESS_TURN_LIMIT } from "./endgame";
import type { Lexicon } from "./lexicon";
import type { Board, Move } from "./model";
import { placeTiles } from "./move-analysis";
import { replyPosition, type ReplyPosition } from "./reply-analysis";
import { prepareSolver, SearchLimitError, SEARCH_LIMITS } from "./solver";

export interface EndgameEstimate {
  spread: number;
  exact: boolean;
  reply?: { word: string; score: number; goesOut: boolean };
}

const REPLY_LOOKAHEAD = 3;

/** Rank plays by examining all immediate replies and selected counterplays. */
export function prepareEndgameEstimate(
  lexicon: Lexicon,
  position: ReplyPosition,
) {
  const { board, template, scorelessTurns } = position;
  const { bagSize, pool } = replyPosition(position);
  if (bagSize || template.rules !== "scrabble")
    throw new Error("Endgame estimates require an empty Scrabble bag.");
  const opponent = pool.join("");
  const points = new Map<string, number>();
  function value(rack: string) {
    const cached = points.get(rack);
    if (cached !== undefined) return cached;
    const score = rackPoints(rack, template.rules);
    points.set(rack, score);
    return score;
  }

  const opponentPoints = value(opponent);
  function search(board: Board, rack: string, deadline: number) {
    const solver = prepareSolver(lexicon, board, template);
    const maxMs = Math.min(SEARCH_LIMITS.maxMs, deadline - performance.now());
    if (maxMs <= 0) throw new SearchLimitError("time");
    return solver.solve(rack, { maxMs }, { unsorted: true });
  }
  return (candidate: Move, deadline: number): EndgameEstimate => {
    if (!candidate.leave)
      return { spread: candidate.score + 2 * opponentPoints, exact: true };
    const yourPoints = value(candidate.leave);
    const afterPlay = candidate.score ? 0 : scorelessTurns + 1;
    if (afterPlay === SCRABBLE_SCORELESS_TURN_LIMIT)
      return {
        spread: candidate.score + opponentPoints - yourPoints,
        exact: true,
      };

    const position = placeTiles(board, candidate);
    const replies = search(position, opponent, deadline);
    let worst = -Infinity;
    let worstReply: Move | null = null;
    function consider(spread: number, move: Move | null) {
      if (spread > worst) {
        worst = spread;
        worstReply = move;
      }
    }
    const options: { move: Move | null; upper: number; leavePoints: number }[] =
      [];
    for (const move of [...replies, null]) {
      const score = move?.score ?? 0;
      if (move && !move.leave) {
        consider(score + 2 * yourPoints, move);
        continue;
      }
      const leavePoints = move ? value(move.leave) : opponentPoints;
      // Passing on our next turn guarantees this upper bound within the
      // estimate, since the horizon values both racks at their point totals.
      const upper = score + yourPoints - leavePoints;
      if (!score && afterPlay + 1 === SCRABBLE_SCORELESS_TURN_LIMIT)
        consider(upper, move);
      else options.push({ move, upper, leavePoints });
    }

    options.sort((a, b) => b.upper - a.upper);
    for (const { move, upper, leavePoints } of options.slice(
      0,
      REPLY_LOOKAHEAD,
    )) {
      if (upper <= worst) break;
      let bestResponse = leavePoints - yourPoints; // Pass.
      const replyBoard = move ? placeTiles(position, move) : position;
      for (const counter of search(replyBoard, candidate.leave, deadline)) {
        const score =
          counter.score +
          (counter.leave
            ? leavePoints - value(counter.leave)
            : 2 * leavePoints);
        bestResponse = Math.max(bestResponse, score);
      }
      consider((move?.score ?? 0) - bestResponse, move);
    }
    function describe(move: Move | null) {
      return move
        ? { word: move.word, score: move.score, goesOut: !move.leave }
        : undefined;
    }
    return {
      spread: candidate.score - worst,
      exact: options.length === 0,
      reply: describe(worstReply),
    };
  };
}
