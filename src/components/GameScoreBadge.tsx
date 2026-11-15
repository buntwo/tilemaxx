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
  const margin = score.you - score.opponent;
  const tone =
    score.outcome === "win"
      ? "value-good"
      : score.outcome === "loss"
        ? "value-bad"
        : undefined;
  const description =
    score.outcome === "playing"
      ? margin > 0
        ? `You lead by ${margin}`
        : margin < 0
          ? `You trail by ${-margin}`
          : "Tied"
      : status[score.outcome];
  return (
    <span
      className={["game-title-score", prominent && "game-scoreboard", tone]
        .filter(Boolean)
        .join(" ")}
      role="group"
      aria-label="Tracked score"
      aria-description={description}
      title={description}
      data-outcome={score.outcome}
    >
      <span aria-label="Your score">{score.you}</span>
      <span aria-hidden="true">–</span>
      <span aria-label="Opponent score">{score.opponent}</span>
    </span>
  );
}
