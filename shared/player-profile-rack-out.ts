import { endgameStreaks, nextEndgameStreak, rackPoints } from "./endgame";
import type { Lexicon } from "./lexicon";
import type { Board, BoardTemplate, Move } from "./model";
import { createSolverFactory, SearchLimitError } from "./solver";

const BUDGET_MS = 20;

export function createProfileRackOut(lexicon: Lexicon, template: BoardTemplate) {
  const prepare = createSolverFactory(lexicon, template, true);
  const rule = endgameStreaks[template.rules];

  return (
    board: Board,
    opponent: string,
    moves: readonly Move[],
    knowsMove: (move: Move) => boolean,
    rackOut: number,
    leaveWeight: number,
    scoreSpread?: number,
    scorelessTurns?: number,
  ) => {
    const deadline = performance.now() + BUDGET_MS;
    try {
      return moves.map((move) => {
        if (!move.leave) {
          const value = move.score + rackOut;
          return { move, priority: scoreSpread === undefined ? 0 : Math.sign(scoreSpread + value), value };
        }
        const leave = rackPoints(move.leave, template.rules);
        if (rule && scorelessTurns !== undefined &&
            nextEndgameStreak(rule, scorelessTurns, move) >= rule.limit) {
          const value = move.score + rackOut / 2 - leave;
          return { move, priority: scoreSpread === undefined ? 0 : Math.sign(scoreSpread + value), value };
        }
        if (scoreSpread !== undefined) {
          const maxMs = deadline - performance.now();
          if (maxMs <= 0) throw new SearchLimitError("time");
          const after = prepare.place(board, move);
          const out = prepare(after)
            .solve(opponent, { maxMs }, { requiredTiles: opponent })
            .find(knowsMove);
          if (out) {
            const value = move.score - out.score - 2 * leave;
            if (scoreSpread + value < 0) return { move, priority: -1, value };
          }
        }
        return { move, priority: 0, value: move.score - leaveWeight * leave };
      }).sort((a, b) => b.priority - a.priority || b.value - a.value);
    } catch (error) {
      if (!(error instanceof SearchLimitError)) throw error;
      return undefined;
    }
  };
}
