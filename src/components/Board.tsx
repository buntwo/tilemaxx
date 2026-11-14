import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ArrowDown, ArrowRight, Star } from "lucide-react";
import type { boardWordsAt } from "../../shared/game-scoring";
import {
  type Board as BoardState,
  type BoardTemplate,
  type Move,
  coordinate,
  tileScore,
} from "../../shared/model";

const WORD_SCORE_HOLD_MS = 450;

export default function Board({
  template,
  board,
  archivedBoard,
  preview,
  selected,
  onSelect,
  paint,
  compact = false,
  entryDirection,
  pendingBlank = false,
  keepInputFocus = false,
  uncertain,
  highlight,
  cellOverlay,
  wordScores,
}: {
  template: BoardTemplate;
  board: BoardState;
  archivedBoard?: BoardState;
  preview?: Pick<Move, "tiles"> | null;
  selected?: number | null;
  onSelect?: (index: number, repeatTap?: boolean) => void;
  paint?: boolean;
  compact?: boolean;
  entryDirection?: "across" | "down";
  pendingBlank?: boolean;
  keepInputFocus?: boolean;
  uncertain?: ReadonlySet<number>;
  highlight?: number;
  cellOverlay?: (
    index: number,
  ) => { style: CSSProperties; label: string } | undefined;
  wordScores?: (index: number) => ReturnType<typeof boardWordsAt>;
}) {
  const touch = useRef<{
    index: number;
    x: number;
    y: number;
    repeat: boolean;
  } | null>(null);
  const canceledTap = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [hoveredTile, setHoveredTile] = useState<number | null>(null);
  const [pressedTile, setPressedTile] = useState<number | null>(null);
  const scoreTile = hoveredTile ?? pressedTile;
  useEffect(() => () => clearTimeout(holdTimer.current), []);
  useEffect(() => {
    if (pressedTile === null) return;
    const dismiss = () => setPressedTile(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", escape);
    };
  }, [pressedTile]);
  const words = useMemo(
    () => (scoreTile === null ? undefined : wordScores?.(scoreTile)),
    [scoreTile, wordScores],
  );
  const wordTiles = new Set(words?.flatMap(({ cells }) => cells));
  const n = template.size,
    placed = new Map(preview?.tiles.map((t) => [t.index, t.letter]) || []);
  return (
    <div className={`board-wrap ${compact ? "compact" : ""}`}>
      <div
        className={`board-grid ${paint ? "paint-board" : ""} ${placed.size ? "has-move-preview" : ""}${wordScores ? " with-word-scores" : ""}`}
        style={{ "--size": n } as CSSProperties}
        aria-label={`${template.name} board`}
        onPointerOver={
          wordScores &&
          ((event) => {
            if (
              event.pointerType !== "mouse" ||
              !(event.target instanceof Element)
            )
              return;
            const index = event.target
              .closest("button[data-cell]")
              ?.getAttribute("data-cell");
            // Keep the last tile active in the gap between squares.
            if (index != null)
              setHoveredTile(board[Number(index)] ? Number(index) : null);
          })
        }
        onPointerLeave={wordScores && (() => setHoveredTile(null))}
      >
        <span className="axis corner" />
        {Array.from({ length: n }, (_, c) => (
          <span className="axis" key={`col-${c}`}>
            {String.fromCharCode(65 + c)}
          </span>
        ))}
        {Array.from({ length: n }, (_, r) => (
          <Fragment key={r}>
            <span className="axis">{r + 1}</span>
            {Array.from({ length: n }, (_, c) => {
              const i = r * n + c,
                tile = board[i] || placed.get(i) || "",
                ghost = !board[i] && placed.has(i),
                archiveEdit = Boolean(
                  archivedBoard && board[i] && board[i] !== archivedBoard[i],
                ),
                bonus = template.premiums[i],
                overlay = cellOverlay?.(i);
              return (
                <button
                  type="button"
                  key={i}
                  data-cell={i}
                  tabIndex={compact && !overlay ? -1 : undefined}
                  className={`square ${bonus.toLowerCase()} ${tile ? "occupied" : ""} ${ghost ? "ghost" : ""} ${archiveEdit ? "archive-edit" : ""} ${selected === i ? "selected" : ""} ${tile && tile === tile.toLowerCase() ? "blank" : ""} ${selected === i && pendingBlank ? "pending-blank" : ""}${highlight === i ? " defense-square" : ""}${wordTiles.has(i) ? " word-hover" : ""}`}
                  aria-label={`${coordinate(i, n)}${tile ? `: ${tile.toUpperCase()}${tile === tile.toLowerCase() ? " blank" : ""}` : bonus ? `: ${bonus}` : ": empty"}${i === template.start ? ", start" : ""}${archiveEdit ? ", edited after archiving" : ""}${overlay ? `, ${overlay.label}` : ""}`}
                  aria-pressed={
                    cellOverlay
                      ? overlay
                        ? highlight === i
                        : undefined
                      : selected === i
                  }
                  onPointerDown={(e) => {
                    if (e.isPrimary === false) return;
                    clearTimeout(holdTimer.current);
                    canceledTap.current = false;
                    touch.current = null;
                    // Keep the current input focused on desktop. Touch waits
                    // for click, after the browser finishes its focus handling.
                    if (keepInputFocus && e.pointerType !== "touch")
                      e.preventDefault();
                    if (keepInputFocus && e.pointerType === "touch") {
                      touch.current = {
                        index: i,
                        x: e.clientX,
                        y: e.clientY,
                        repeat: selected === i,
                      };
                      if (wordScores) {
                        setHoveredTile(null);
                        if (board[i]) {
                          holdTimer.current = setTimeout(() => {
                            canceledTap.current = true;
                            setPressedTile(i);
                          }, WORD_SCORE_HOLD_MS);
                        }
                      }
                    }
                  }}
                  onPointerMove={(e) => {
                    if (
                      e.isPrimary !== false &&
                      touch.current &&
                      Math.hypot(
                        e.clientX - touch.current.x,
                        e.clientY - touch.current.y,
                      ) > 10
                    ) {
                      clearTimeout(holdTimer.current);
                      setPressedTile(null);
                      touch.current = null;
                      canceledTap.current = true;
                    }
                  }}
                  onPointerUp={(e) => {
                    if (e.isPrimary !== false) clearTimeout(holdTimer.current);
                  }}
                  onPointerCancel={(e) => {
                    if (e.isPrimary === false) return;
                    clearTimeout(holdTimer.current);
                    setPressedTile(null);
                    touch.current = null;
                    canceledTap.current = true;
                  }}
                  onContextMenu={
                    wordScores && board[i]
                      ? (e) => {
                          if (touch.current?.index === i) e.preventDefault();
                        }
                      : undefined
                  }
                  onMouseDown={(e) => {
                    if (keepInputFocus) e.preventDefault();
                  }}
                  onKeyDown={() => {
                    clearTimeout(holdTimer.current);
                    touch.current = null;
                    canceledTap.current = false;
                  }}
                  onClick={(e) => {
                    clearTimeout(holdTimer.current);
                    const tap = touch.current;
                    touch.current = null;
                    if (canceledTap.current) {
                      canceledTap.current = false;
                      return;
                    }
                    if (keepInputFocus) e.preventDefault();
                    // Do not focus on pointerup: Safari may move focus again
                    // before click. Remember the pre-blur selection instead.
                    onSelect?.(i, tap?.index === i ? tap.repeat : undefined);
                  }}
                  onPointerEnter={(e) => {
                    if (paint && e.buttons === 1) onSelect?.(i);
                  }}
                >
                  {overlay && (
                    <span
                      className="board-cell-overlay"
                      style={overlay.style}
                      aria-hidden="true"
                    />
                  )}
                  {uncertain?.has(i) && (
                    <span
                      className="uncertain-tile"
                      aria-label="Check this square"
                    />
                  )}
                  {selected === i && entryDirection && (
                    <span className="entry-arrow" aria-hidden="true">
                      {entryDirection === "across" ? (
                        <ArrowRight />
                      ) : (
                        <ArrowDown />
                      )}
                    </span>
                  )}
                  {tile ? (
                    <>
                      <span className="tile-letter">{tile.toUpperCase()}</span>
                      <span className="tile-points">
                        {tileScore(tile, template.rules)}
                      </span>
                    </>
                  ) : i === template.start ? (
                    <>
                      <Star
                        className="center-star"
                        size={15}
                        fill="currentColor"
                      />
                      <span className="start-bonus">{bonus}</span>
                    </>
                  ) : bonus ? (
                    <span className="premium-label">{bonus}</span>
                  ) : null}
                  {words
                    ?.filter(({ cells }) => cells.at(-1) === i)
                    .map((word) => (
                      <span
                        key={word.direction}
                        className={`board-word-score ${word.direction}`}
                        aria-label={`${word.word} ${word.direction}, ${word.score} ${word.fromPlay ? "points" : "face-value points"}`}
                      >
                        {word.score}
                      </span>
                    ))}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
