import {
  EndgameSearchLimitError,
  solveEmptyBag,
  validEndgameStreak,
} from "./endgame";
import type { Lexicon } from "./lexicon";
import type { Board, BoardTemplate, Move } from "./model";
import { createSolverFactory, SearchLimitError } from "./solver";
import type { unseenTiles } from "./tile-pool";

export const PROFILE_ENDGAME_TILES = 7;
const MAX_SHORTLIST = 5;
const BUDGET_MS = 8;
const POSITIONS_PER_MOVE = 96;

/** A short known-rack search for the Strong profile, after static screening. */
export function createProfileEndgame(
  lexicon: Lexicon,
  template: BoardTemplate,
) {
  const prepare = createSolverFactory(lexicon, template, true);
  // Analyze often revisits one board and rack with different vocabulary rolls.
  const cache = new WeakMap<Board, Map<string, number | null>>();
  return (
    board: Board,
    pool: ReturnType<typeof unseenTiles>,
    scorelessTurns: number,
    moves: readonly Move[],
  ): number[] | undefined => {
    if (
      template.rules === "crossplay" ||
      moves.length < 2 ||
      moves.length > MAX_SHORTLIST ||
      moves.every((move) => !move.leave) ||
      !validEndgameStreak(template.rules, scorelessTurns)
    )
      return;
    const opponent = pool.tiles
      .map(({ symbol, count }) => symbol.repeat(count))
      .join("");
    let values = cache.get(board);
    if (!values) {
      values = new Map();
      cache.set(board, values);
    }
    const deadline = performance.now() + BUDGET_MS;
    const spreads: number[] = [];
    for (const move of moves) {
      const key = JSON.stringify([
        opponent,
        scorelessTurns,
        move.id,
        move.leave,
      ]);
      let spread = values.get(key);
      if (spread === undefined) {
        if (performance.now() >= deadline) return;
        try {
          spread = solveEmptyBag(
            board,
            move,
            opponent,
            template,
            { scorelessTurns },
            (next, letters, until) => {
              const remaining = until - performance.now();
              if (remaining <= 0) throw new SearchLimitError("time");
              if (letters.length === 1)
                return prepare.singleMoves(next, letters);
              return prepare(next).solve(
                letters,
                { maxMs: remaining },
                { unsorted: true },
              );
            },
            prepare.place,
            {
              timeLimitMs: deadline - performance.now(),
              positionLimit: POSITIONS_PER_MOVE,
            },
          ).spread;
        } catch (error) {
          if (!(error instanceof EndgameSearchLimitError)) throw error;
          // Cache deterministic work limits. A time limit can depend on load.
          if (error.reason === "positions" && values.size < 128)
            values.set(key, null);
          return;
        }
        if (values.size < 128) values.set(key, spread);
      }
      if (spread === null) return;
      spreads.push(spread);
    }
    return spreads;
  };
}
