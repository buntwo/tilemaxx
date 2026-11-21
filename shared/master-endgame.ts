import {
  EndgameSearchLimitError,
  searchEmptyBagCandidate,
  validEndgameStreak,
} from "./endgame";
import type { HunterPosition } from "./bingo-hunter";
import type { MasterAction } from "./master-evaluation";
import {
  SEARCH_LIMITS,
  SearchLimitError,
  type createSolverFactory,
} from "./solver";

export function masterEndgame(
  factory: ReturnType<typeof createSolverFactory>,
  position: HunterPosition,
  action: MasterAction,
  opponent: string,
  deadline: number,
  positionLimit: number,
) {
  const { board, template, scorelessTurns } = position;
  if (
    !validEndgameStreak(template.rules, scorelessTurns) ||
    deadline <= performance.now()
  )
    return undefined;
  try {
    const line = searchEmptyBagCandidate(
      board,
      action.move,
      action.leave,
      opponent,
      template,
      position,
      (next, rack, end) => {
        const maxMs = Math.min(SEARCH_LIMITS.maxMs, end - performance.now());
        if (maxMs <= 0) throw new SearchLimitError("time");
        return rack.length === 1
          ? factory.singleMoves(next, rack)
          : factory(next).solve(rack, { maxMs }, { unsorted: true });
      },
      factory.place,
      { timeLimitMs: Math.max(0, deadline - performance.now()), positionLimit },
    );
    return line?.spread;
  } catch (error) {
    if (!(error instanceof EndgameSearchLimitError)) throw error;
    return undefined;
  }
}
