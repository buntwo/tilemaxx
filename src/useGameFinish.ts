import { useCallback, useEffect, useState } from "react";
import {
  displayedGameScoring,
  summarizeGameScore,
  type GameScoreSummary,
} from "../shared/game-scoring";
import {
  trackedMoveHistory,
  type Game,
  type GameOutcome,
  type GameScoring,
  type Player,
  type TrackedMove,
} from "../shared/model";

export type GameFinish = {
  outcome: GameOutcome | "finished";
  scores: Record<Player, number>;
  opponent: string;
  out?: Player;
  square: number;
  size: number;
  move?: TrackedMove;
};

type FinishedScore = GameScoreSummary & Pick<GameFinish, "outcome">;
type FinishEnd = NonNullable<GameScoring["end"]>;

type PendingFinish = {
  gameId: string;
  archived: boolean;
  end: FinishEnd;
  result: GameFinish;
  animation: number;
};

function finished(score: GameScoreSummary | null): score is FinishedScore {
  return !!score && score.outcome !== "playing" && score.outcome !== "archived";
}

export function useGameFinish(
  game: Game | undefined,
  waitingForTiles: boolean,
) {
  const [pending, setPending] = useState<PendingFinish>();
  const scoring = game && displayedGameScoring(game);
  const score = game ? summarizeGameScore(game, scoring) : null;
  const end = scoring?.end;
  const current =
    game &&
    pending?.gameId === game.id &&
    pending.archived === game.archived &&
    pending.end === end
      ? pending
      : undefined;
  useEffect(() => {
    if (pending && !current) setPending(undefined);
  }, [current, pending]);

  const show = useCallback(
    (game: Game, end: FinishEnd, score: FinishedScore) => {
      const out = "out" in end ? end.out : undefined;
      const archive = game.archived ? game.archivedState : undefined;
      const history =
        archive?.scoring?.end === end ? { ...game, ...archive } : game;
      const last = out ? trackedMoveHistory(history).at(-1) : undefined;
      const move = last?.player === out ? last : undefined;
      setPending((previous) => ({
        gameId: game.id,
        archived: game.archived,
        end,
        animation: (previous?.animation ?? 0) + 1,
        result: {
          outcome: score.outcome,
          scores: { you: score.you, opponent: score.opponent },
          opponent: game.name,
          out,
          size: game.template.size,
          square: move?.review?.tiles.at(-1)?.index ?? game.template.start,
          move,
        },
      }));
    },
    [],
  );

  const queue = useCallback(
    (previous: Game | undefined, next: Game) => {
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
      if (!finished(score)) return false;
      show(next, end, score);
      return true;
    },
    [show],
  );

  const replay =
    game && end && finished(score) && !waitingForTiles
      ? () => show(game, end, score)
      : undefined;
  const dismiss = useCallback(() => setPending(undefined), []);
  return {
    score,
    current: waitingForTiles ? undefined : current,
    queue,
    replay,
    dismiss,
  };
}
