import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Flag, Minus, Trophy } from "lucide-react";
import type { GameFinish } from "../useGameFinish";
import MoveWord from "./MoveWord";
import "./board-finish.css";

function randomFlecks(): CSSProperties[] {
  const count = 16;
  const sector = (2 * Math.PI) / count;
  const rotation = Math.random() * 2 * Math.PI;
  return Array.from({ length: count }, (_, index) => {
    const angle = rotation + (index + Math.random()) * sector;
    const radius = 22 + Math.random() * 21;
    return {
      "--fleck-x": `${Math.cos(angle) * radius}cqw`,
      "--fleck-y": `${Math.sin(angle) * radius}cqw`,
      "--fleck-turn": `${Math.random() * 900 - 450}deg`,
      "--fleck-size": `${4 + Math.floor(Math.random() * 4)}px`,
      "--fleck-delay": `${Math.random() * 70}ms`,
    } as CSSProperties;
  });
}

const results = {
  win: { Icon: Trophy, label: "You win!", margin: "Won by" },
  loss: { Icon: Flag, label: "You lose", margin: "Lost by" },
  tie: { Icon: Minus, label: "Tie game", margin: "" },
};

export default function BoardFinishOverlay({
  finish,
  onDismiss,
  onArchive,
}: {
  finish: GameFinish;
  onDismiss: () => void;
  onArchive?: () => void;
}) {
  const { outcome, out, opponent, scores, square, size, move } = finish;
  const { Icon, label, margin } = results[outcome];
  const [flecks] = useState(() => (outcome === "win" ? randomFlecks() : []));
  const overlay = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (outcome !== "win") return;
    const result = overlay.current;
    const grid = result?.parentElement;
    const first = grid?.querySelector('[data-cell="0"]');
    const last = grid?.querySelector(`[data-cell="${size * size - 1}"]`);
    if (!result || !grid || !first || !last) return;

    const center = () => {
      const bounds = result.getBoundingClientRect();
      const topLeft = first.getBoundingClientRect();
      const bottomRight = last.getBoundingClientRect();
      result.style.setProperty(
        "--finish-x",
        `${(topLeft.left + bottomRight.right) / 2 - bounds.left}px`,
      );
      result.style.setProperty(
        "--finish-y",
        `${(topLeft.top + bottomRight.bottom) / 2 - bounds.top}px`,
      );
    };
    center();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(center);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [outcome, size]);

  const close = useCallback((action: () => void) => {
    const focusedSquare =
      overlay.current?.contains(document.activeElement)
        ? overlay.current.parentElement?.querySelector<HTMLButtonElement>(
            `[data-cell="${square}"]`,
          )
        : undefined;
    action();
    // The square becomes focusable after the overlay closes.
    if (focusedSquare)
      requestAnimationFrame(() => focusedSquare.focus({ preventScroll: true }));
  }, [square]);
  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) close(onDismiss);
    }
    function outside(event: MouseEvent) {
      const target = event.target;
      if (
        target instanceof Element &&
        !overlay.current?.contains(target) &&
        !target.closest(".game-score-replay")
      )
        onDismiss();
    }
    document.addEventListener("keydown", escape);
    document.addEventListener("click", outside, true);
    return () => {
      document.removeEventListener("keydown", escape);
      document.removeEventListener("click", outside, true);
    };
  }, [close, onDismiss]);

  return (
    <div
      ref={overlay}
      className="board-finish"
      data-outcome={outcome}
      style={
        outcome === "loss"
          ? ({
              "--finish-x": `${(((square % size) + 1.5) / (size + 1)) * 100}%`,
              "--finish-y": `${((Math.floor(square / size) + 1.5) / (size + 1)) * 100}%`,
            } as CSSProperties)
          : undefined
      }
    >
      <button
        type="button"
        className="board-finish-backdrop"
        aria-label="Dismiss result"
        onClick={() => close(onDismiss)}
      />
      <div className="board-finish-effects" aria-hidden="true">
        {outcome !== "tie" && <div className="board-finish-wave" />}
        {flecks.map((style, index) => (
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
            <div>
              <span>You</span>
              <strong className="board-finish-your-total">{scores.you}</strong>
            </div>
            <span className="game-score-separator" aria-hidden="true">
              –
            </span>
            <div>
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
        {onArchive && (
          <button
            type="button"
            className="button secondary"
            onClick={() => close(onArchive)}
          >
            Archive game
          </button>
        )}
      </div>
    </div>
  );
}
