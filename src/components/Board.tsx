import { Fragment, useRef, type CSSProperties } from "react";
import { ArrowDown, ArrowRight, Star } from "lucide-react";
import {
  type Board as BoardState,
  type BoardTemplate,
  type Move,
  coordinate,
  tileScore,
} from "../../shared/model";
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
}) {
  const touch = useRef<{
    index: number;
    x: number;
    y: number;
    repeat: boolean;
  } | null>(null);
  const canceledTap = useRef(false);
  const n = template.size,
    placed = new Map(preview?.tiles.map((t) => [t.index, t.letter]) || []);
  return (
    <div className={`board-wrap ${compact ? "compact" : ""}`}>
      <div
        className={`board-grid ${paint ? "paint-board" : ""} ${placed.size ? "has-move-preview" : ""}`}
        style={{ "--size": n } as CSSProperties}
        aria-label={`${template.name} board`}
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
                bonus = template.premiums[i];
              return (
                <button
                  type="button"
                  key={i}
                  data-cell={i}
                  tabIndex={compact ? -1 : undefined}
                  className={`square ${bonus.toLowerCase()} ${tile ? "occupied" : ""} ${ghost ? "ghost" : ""} ${archiveEdit ? "archive-edit" : ""} ${selected === i ? "selected" : ""} ${tile && tile === tile.toLowerCase() ? "blank" : ""} ${selected === i && pendingBlank ? "pending-blank" : ""}${highlight === i ? " defense-square" : ""}`}
                  aria-label={`${coordinate(i, n)}${tile ? `: ${tile.toUpperCase()}${tile === tile.toLowerCase() ? " blank" : ""}` : bonus ? `: ${bonus}` : ": empty"}${i === template.start ? ", start" : ""}${archiveEdit ? ", edited after archiving" : ""}`}
                  aria-pressed={selected === i}
                  onPointerDown={(e) => {
                    canceledTap.current = false;
                    touch.current = null;
                    // Keep the current input focused on desktop. Touch waits
                    // for click, after the browser finishes its focus handling.
                    if (
                      keepInputFocus &&
                      e.pointerType !== "touch" &&
                      e.isPrimary !== false
                    )
                      e.preventDefault();
                    if (
                      keepInputFocus &&
                      e.pointerType === "touch" &&
                      e.isPrimary !== false
                    )
                      touch.current = {
                        index: i,
                        x: e.clientX,
                        y: e.clientY,
                        repeat: selected === i,
                      };
                  }}
                  onPointerMove={(e) => {
                    if (
                      touch.current &&
                      Math.hypot(
                        e.clientX - touch.current.x,
                        e.clientY - touch.current.y,
                      ) > 10
                    ) {
                      touch.current = null;
                      canceledTap.current = true;
                    }
                  }}
                  onPointerCancel={() => {
                    touch.current = null;
                    canceledTap.current = true;
                  }}
                  onMouseDown={(e) => {
                    if (keepInputFocus) e.preventDefault();
                  }}
                  onKeyDown={() => {
                    touch.current = null;
                    canceledTap.current = false;
                  }}
                  onClick={(e) => {
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
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
