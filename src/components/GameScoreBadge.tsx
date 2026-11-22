import type { GameScoreSummary } from "../../shared/game-scoring";
import type { Player } from "../../shared/model";
import { scoreTone, signedPoints } from "../score-tone";

const status = {
  archived: "Archived game",
  playing: "Game in progress",
  finished: "Game complete",
  tie: "Tie game",
  win: "You won",
  loss: "You lost",
};

export function describeGameScore(score: GameScoreSummary) {
  if (score.solo) return `Your score ${score.you}. ${status[score.outcome]}.`;
  return `Your score ${score.you}, opponent score ${score.opponent}. ${status[score.outcome]}.`;
}

export default function GameScoreBadge({
  score,
  turn,
  prominent = false,
  showMargin = false,
  showNoScore = false,
  onReplay,
}: {
  score: GameScoreSummary | null;
  turn?: Player;
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
    score.solo
      ? describeGameScore(score)
      : score.outcome === "playing"
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
  const currentTurn = score.outcome === "playing" ? turn : undefined;
  const turnDescription =
    currentTurn === "you" ? "Your turn." : "Opponent’s turn.";
  const badgeDescription = currentTurn
    ? `${description}. ${turnDescription}`
    : description;
  const Container = onReplay ? "button" : "span";
  return (
    <Container
      className={[badgeClass, tone, onReplay && "game-score-replay"]
        .filter(Boolean)
        .join(" ")}
      type={onReplay ? "button" : undefined}
      role={onReplay ? undefined : "group"}
      aria-label={onReplay ? "Replay finish animation" : "Tracked score"}
      aria-description={onReplay ? describeGameScore(score) : badgeDescription}
      title={onReplay ? "Replay finish animation" : badgeDescription}
      data-outcome={score.outcome}
      data-turn={currentTurn}
      data-solo={score.solo}
      onClick={onReplay}
    >
      <span className="game-score-totals">
        {currentTurn && (
          <span
            className="game-score-turn-marker score-turn-chevron"
            data-player={currentTurn}
            aria-hidden="true"
          />
        )}
        <span className="game-score-player" aria-label="Your score">
          {score.you}
        </span>
        {!score.solo && (
          <>
            <span className="game-score-separator" aria-hidden="true">–</span>
            <span className="game-score-player" aria-label="Opponent score">
              {score.opponent}
            </span>
          </>
        )}
      </span>
      {showMargin && !score.solo && (
        <span
          className={`game-score-delta${marginTone ? ` ${marginTone}` : ""}`}
          aria-hidden="true"
        >
          {signedPoints(margin)}
        </span>
      )}
    </Container>
  );
}
