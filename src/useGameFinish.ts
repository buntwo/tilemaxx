import { useCallback, useEffect, useState } from "react";
import { summarizeGameScore } from "../shared/game-scoring";
import {
  trackedMoveHistory,
  type Game,
  type GameOutcome,
  type GameScoring,
  type Player,
  type TrackedMove,
} from "../shared/model";

export type GameFinish = {
  outcome: GameOutcome;
  scores: Record<Player, number>;
  opponent: string;
  out: Player;
  square: number;
  size: number;
  move?: TrackedMove;
};

type PendingFinish = GameFinish & {
  gameId: string;
  end: NonNullable<GameScoring["end"]>;
};

export function useGameFinish(
  game: Game | undefined,
  waitingForTiles: boolean,
) {
  const [pending, setPending] = useState<PendingFinish>();
  const current =
    game &&
    !game.archived &&
    pending?.gameId === game.id &&
    pending.end === game.scoring?.end
      ? pending
      : undefined;
  useEffect(() => {
    if (pending && !current) setPending(undefined);
  }, [current, pending]);

  const queue = useCallback((previous: Game | undefined, next: Game) => {
    const end = next.scoring?.end;
    if (
      !previous ||
      previous.scoring?.end ||
      next.archived ||
      !end ||
      !("out" in end)
    )
      return false;
    const score = summarizeGameScore(next);
    if (!score || score.outcome === "playing" || score.outcome === "archived")
      return false;
    const last = trackedMoveHistory(next).at(-1);
    const move = last?.player === end.out ? last : undefined;
    setPending({
      gameId: next.id,
      end,
      outcome: score.outcome,
      scores: { you: score.you, opponent: score.opponent },
      opponent: next.name,
      out: end.out,
      size: next.template.size,
      square: move?.review?.tiles.at(-1)?.index ?? next.template.start,
      move,
    });
    return true;
  }, []);

  const dismiss = useCallback(() => setPending(undefined), []);
  return { result: waitingForTiles ? undefined : current, queue, dismiss };
}
