import type { GameScoreSummary } from "../../shared/game-scoring";
import { scoreTone, signedPoints } from "../score-tone";

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
  showMargin = false,
}: {
  score: GameScoreSummary | null;
  prominent?: boolean;
  showMargin?: boolean;
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
      : showMargin && margin
        ? `${status[score.outcome]}. ${Math.abs(margin)}-point ${margin > 0 ? "lead" : "deficit"}.`
        : status[score.outcome];
  const marginTone =
    score.outcome === "playing" ? scoreTone(margin) : undefined;
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
      <span className="game-score-totals">
        <span aria-label="Your score">{score.you}</span>
        <span aria-hidden="true">–</span>
        <span aria-label="Opponent score">{score.opponent}</span>
      </span>
      {showMargin && (
        <span
          className={`game-score-delta${marginTone ? ` ${marginTone}` : ""}`}
          aria-hidden="true"
        >
          {signedPoints(margin)}
        </span>
      )}
    </span>
  );
}
