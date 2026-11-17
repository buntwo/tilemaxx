import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import { Flag, Minus, Trophy } from "lucide-react";
import type { GameFinish } from "../useGameFinish";
import MoveWord from "./MoveWord";
import "./board-finish.css";

const flecks = Array.from({ length: 16 }, (_, index) => {
  const angle = index * 2.39996;
  const radius = 13 + ((index * 17) % 31);
  return {
    "--fleck-x": `${Math.cos(angle) * radius}cqw`,
    "--fleck-y": `${Math.sin(angle) * radius - 4}cqw`,
    "--fleck-turn": `${(index % 2 ? -1 : 1) * (85 + index * 27)}deg`,
    "--fleck-size": `${4 + (index % 4)}px`,
    "--fleck-delay": `${(index % 4) * 23}ms`,
  } as CSSProperties;
});

const results = {
  win: { Icon: Trophy, label: "You win!", margin: "Won by" },
  loss: { Icon: Flag, label: "You lose", margin: "Lost by" },
  tie: { Icon: Minus, label: "Tie game", margin: "" },
};

export default function BoardFinishOverlay({
  finish,
  onDismiss,
}: {
  finish: GameFinish;
  onDismiss: () => void;
}) {
  const { outcome, out, opponent, scores, square, size, move } = finish;
  const { Icon, label, margin } = results[outcome];
  const overlay = useRef<HTMLDivElement>(null);
  const dismissButton = useRef<HTMLButtonElement>(null);
  const dismiss = useCallback(() => {
    if (document.activeElement === dismissButton.current)
      overlay.current?.parentElement
        ?.querySelector<HTMLButtonElement>(`[data-cell="${square}"]`)
        ?.focus({ preventScroll: true });
    onDismiss();
  }, [onDismiss, square]);
  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) dismiss();
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [dismiss]);

  return (
    <div
      ref={overlay}
      className="board-finish"
      data-outcome={outcome}
      style={
        {
          "--finish-x": `${(((square % size) + 1.5) / (size + 1)) * 100}%`,
          "--finish-y": `${((Math.floor(square / size) + 1.5) / (size + 1)) * 100}%`,
        } as CSSProperties
      }
    >
      <div className="board-finish-effects" aria-hidden="true">
        {outcome !== "tie" && <div className="board-finish-wave" />}
        {outcome === "win" &&
          flecks.map((style, index) => (
            <span key={index} className="board-finish-fleck" style={style} />
          ))}
      </div>
      <div className="board-finish-card">
        <div className="board-finish-emblem">
          <Icon size={19} aria-hidden="true" />
        </div>
        <div className="board-finish-result" role="status">
          <h2>{label}</h2>
          <div className="board-finish-score">
            <div data-winner={outcome === "win" || undefined}>
              <span>You</span>
              <strong>{scores.you}</strong>
            </div>
            <span aria-hidden="true">–</span>
            <div data-winner={outcome === "loss" || undefined}>
              <span title={opponent}>{opponent}</span>
              <strong>{scores.opponent}</strong>
            </div>
          </div>
          {margin && (
            <div className="board-finish-margin">
              {margin} {Math.abs(scores.you - scores.opponent)}
            </div>
          )}
        </div>
        {out && (
          <div className="board-finish-note">
            {out === "you" ? "You" : opponent} went out
            {move && (
              <>
                {" "}
                · <MoveWord word={move.word} bingo={move.bingo} /> +{move.score}
              </>
            )}
          </div>
        )}
        <button
          ref={dismissButton}
          type="button"
          className="button secondary"
          onClick={dismiss}
        >
          View board
        </button>
      </div>
    </div>
  );
}
