import type { GameScoreSummary } from "../../shared/game-scoring";

const status = {
  archived: "Archived game",
  playing: "Game in progress",
  tie: "Tie game",
  win: "You won",
  loss: "You lost",
};

export function describeGameScore(score: GameScoreSummary) {
  return `Your score ${score.you}, opponent score ${score.opponent}. ${status[score.outcome]}.`;
}

export default function GameScoreBadge({
  score,
  prominent = false,
}: {
  score: GameScoreSummary | null;
  prominent?: boolean;
}) {
  if (!score) return null;
  return (
    <span
      className={
        prominent ? "game-title-score game-scoreboard" : "game-title-score"
      }
      role="group"
      aria-label="Tracked score"
      aria-description={status[score.outcome]}
      title={status[score.outcome]}
      data-outcome={score.outcome}
    >
      <span aria-label="Your score">{score.you}</span>
      <span aria-hidden="true">–</span>
      <span aria-label="Opponent score">{score.opponent}</span>
    </span>
  );
}
