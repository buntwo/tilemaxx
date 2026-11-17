import { RotateCcw } from "lucide-react";
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
  showNoScore = false,
  onReplay,
}: {
  score: GameScoreSummary | null;
  prominent?: boolean;
  showMargin?: boolean;
  showNoScore?: boolean;
  onReplay?: () => void;
}) {
  const badgeClass = prominent
    ? "game-title-score game-scoreboard"
    : "game-title-score";
  if (!score)
    return showNoScore ? (
      <span className={badgeClass} data-outcome="untracked">
        No score
      </span>
    ) : null;
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
  const Container = onReplay ? "button" : "span";
  return (
    <Container
      className={[badgeClass, tone, onReplay && "game-score-replay"]
        .filter(Boolean)
        .join(" ")}
      type={onReplay ? "button" : undefined}
      role={onReplay ? undefined : "group"}
      aria-label={onReplay ? "Replay finish animation" : "Tracked score"}
      aria-description={onReplay ? describeGameScore(score) : description}
      title={onReplay ? "Replay finish animation" : description}
      data-outcome={score.outcome}
      onClick={onReplay}
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
          {onReplay && <RotateCcw size={12} />}
        </span>
      )}
    </Container>
  );
}
