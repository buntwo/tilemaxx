import type { GameScoreSummary } from "../../shared/game-scoring";
import type { Player } from "../../shared/model";
import { scoreTone, signedPoints } from "../score-tone";

const status = {
  archived: "Archived game",
  playing: "Game in progress",
  tie: "Tie game",
  win: "You won",
  loss: "You lost",
};

// Equally spaced dots keep the small waiting ring symmetric in every browser.
const ringDots = Array.from({ length: 8 }, (_, index) => {
  const angle = (index * Math.PI) / 4;
  return {
    left: `${50 + Math.cos(angle) * 41}%`,
    top: `${50 + Math.sin(angle) * 41}%`,
  };
});

function TurnMarker({ player, turn }: { player: Player; turn: Player }) {
  const active = player === turn;
  return (
    <span
      className="game-score-turn-marker"
      data-player={player}
      data-status={active ? "turn" : "waiting"}
      aria-hidden="true"
    >
      {!active &&
        ringDots.map((style, index) => <span key={index} style={style} />)}
    </span>
  );
}

export function describeGameScore(score: GameScoreSummary) {
  return `Your score ${score.you}, opponent score ${score.opponent}. ${status[score.outcome]}.`;
}

export default function GameScoreBadge({
  score,
  turn,
  prominent = false,
  inHeader = false,
  showNoScore = false,
  onReplay,
}: {
  score: GameScoreSummary | null;
  turn?: Player;
  prominent?: boolean;
  inHeader?: boolean;
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
      : inHeader && margin
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
      className={[badgeClass, !inHeader && tone, onReplay && "game-score-replay"]
        .filter(Boolean)
        .join(" ")}
      type={onReplay ? "button" : undefined}
      role={onReplay ? undefined : "group"}
      aria-label={onReplay ? "Replay finish animation" : "Tracked score"}
      aria-description={onReplay ? describeGameScore(score) : badgeDescription}
      title={onReplay ? "Replay finish animation" : badgeDescription}
      data-outcome={score.outcome}
      data-turn={currentTurn}
      onClick={onReplay}
    >
      <span className="game-score-totals">
        {currentTurn && <TurnMarker player="you" turn={currentTurn} />}
        <span
          className={`game-score-player${inHeader && tone ? ` ${tone}` : ""}`}
          aria-label="Your score"
        >
          {score.you}
        </span>
        <span className="game-score-separator" aria-hidden="true">
          –
        </span>
        <span className="game-score-player" aria-label="Opponent score">
          {score.opponent}
        </span>
        {currentTurn && <TurnMarker player="opponent" turn={currentTurn} />}
      </span>
      {inHeader && (
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
