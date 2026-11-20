import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ArrowDown, ArrowRight, Star } from "lucide-react";
import type { DefinitionLanguage } from "../../shared/definitions";
import { boardWordsThrough, type boardWordsAt } from "../../shared/game-scoring";
import {
  type Board as BoardState,
  type BoardTemplate,
  type Move,
  type Player,
  coordinate,
  tileScore,
} from "../../shared/model";
import { BingoBadge } from "./MoveWord";
import BoardCoordinates, { type CoordinateSelection } from "./BoardCoordinates";
import { useDefinitionTooltip } from "./DefinitionTooltip";
import { canHoverWithMouse } from "../move-preview";

const TILE_HOLD_MS = 450;

export default function Board({
  template,
  board,
  archivedBoard,
  preview,
  previewPlayer = "you",
  selected,
  markedSquares,
  selectingSquares = false,
  disabled = false,
  onSelect,
  onTileHold,
  paint,
  compact = false,
  entryDirection,
  pendingBlank = false,
  keepInputFocus = false,
  uncertain,
  highlight,
  cellOverlay,
  coordinateSelection,
  overlay,
  wordScores,
  definitionLanguage,
  onDefinitionPick,
}: {
  template: BoardTemplate;
  board: BoardState;
  archivedBoard?: BoardState;
  preview?: Pick<Move, "tiles"> | null;
  previewPlayer?: Player;
  selected?: number | null;
  markedSquares?: ReadonlySet<number>;
  selectingSquares?: boolean;
  disabled?: boolean;
  onSelect?: (index: number, repeatTap?: boolean) => void;
  onTileHold?: (index: number) => void;
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
  coordinateSelection?: CoordinateSelection;
  overlay?: ReactNode;
  wordScores?: (index: number) => ReturnType<typeof boardWordsAt>;
  definitionLanguage?: DefinitionLanguage;
  onDefinitionPick?: () => void;
}) {
  const press = useRef<{
    index: number;
    pointerId: number;
    x: number;
    y: number;
    repeat?: boolean;
  } | null>(null);
  const canceledTap = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const holdAction = useRef(onTileHold);
  holdAction.current = onTileHold;
  const canHoldTile = !!onTileHold;
  const [hoveredTile, setHoveredTile] = useState<number | null>(null);
  const definitions = useDefinitionTooltip(definitionLanguage, board);
  const defining = !!onDefinitionPick;
  useEffect(() => () => clearTimeout(holdTimer.current), [board, canHoldTile]);
  function cancelPress(pointerId: number) {
    if (press.current?.pointerId !== pointerId) return;
    clearTimeout(holdTimer.current);
    press.current = null;
    canceledTap.current = true;
  }
  const words = useMemo(
    () => (hoveredTile === null ? undefined : wordScores?.(hoveredTile)),
    [hoveredTile, wordScores],
  );
  const wordTiles = new Set(words?.flatMap(({ cells }) => cells));
  const n = template.size,
    placed = new Map(preview?.tiles.map((t) => [t.index, t.letter]) || []);
  return (
    <div
      className={`board-wrap${compact ? " compact" : ""}${coordinateSelection ? " selecting-coordinate" : ""}`}
      style={{ "--size": n } as CSSProperties}
    >
      <div
        className={`board-grid ${paint ? "paint-board" : ""} ${placed.size ? "has-move-preview" : ""}`}
        aria-label={`${template.name} board`}
        data-preview-player={placed.size ? previewPlayer : undefined}
        data-defining={defining || undefined}
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
        onContextMenu={definitionLanguage && !defining ? (event) => {
          if (
            event.defaultPrevented ||
            (event.button !== 2 && !event.ctrlKey) ||
            ("pointerType" in event.nativeEvent && event.nativeEvent.pointerType === "touch") ||
            !canHoverWithMouse("mouse") ||
            !(event.target instanceof Element)
          ) return;
          const tile = event.target.closest<HTMLButtonElement>("button[data-cell]");
          if (!tile) return;
          const words = boardWordsThrough(board, n, Number(tile.dataset.cell));
          if (!words.length) return;
          event.preventDefault();
          definitions.open(tile, words);
        } : undefined}
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
                marked = markedSquares?.has(i),
                overlay = cellOverlay?.(i);
              return (
                <button
                  type="button"
                  key={i}
                  data-cell={i}
                  data-definition-open={definitions.anchor?.dataset.cell === String(i) || undefined}
                  disabled={disabled || (defining && !board[i])}
                  tabIndex={compact && !overlay ? -1 : undefined}
                  className={`square ${bonus.toLowerCase()} ${tile ? "occupied" : ""} ${ghost ? "ghost" : ""} ${archiveEdit ? "archive-edit" : ""} ${selected === i ? "selected" : ""} ${tile && tile === tile.toLowerCase() ? "blank" : ""} ${selected === i && pendingBlank ? "pending-blank" : ""}${highlight === i ? " defense-square" : ""}${wordTiles.has(i) ? " word-hover" : ""}${marked ? " move-filter-square" : ""}`}
                  aria-label={`${coordinate(i, n)}${tile ? `: ${tile.toUpperCase()}${tile === tile.toLowerCase() ? " blank" : ""}` : bonus ? `: ${bonus}` : ": empty"}${i === template.start ? ", start" : ""}${archiveEdit ? ", edited after archiving" : ""}${overlay ? `, ${overlay.label}` : ""}${marked && !selectingSquares ? ", required for move filter" : ""}`}
                  aria-pressed={
                    cellOverlay
                      ? overlay
                        ? highlight === i
                        : undefined
                      : selectingSquares
                        ? !!marked
                        : selected === i
                  }
                  onPointerDown={(e) => {
                    if (e.isPrimary === false || e.button !== 0) return;
                    clearTimeout(holdTimer.current);
                    canceledTap.current = false;
                    press.current = null;
                    const touch = e.pointerType === "touch";
                    const holdTile = canHoldTile && !!board[i];
                    // Keep the current input focused on desktop. Touch waits
                    // for click, after the browser finishes its focus handling.
                    if (keepInputFocus && !touch) e.preventDefault();
                    if (touch) setHoveredTile(null);
                    if ((keepInputFocus && touch) || holdTile) {
                      press.current = {
                        index: i,
                        pointerId: e.pointerId,
                        x: e.clientX,
                        y: e.clientY,
                        repeat: touch ? selected === i : undefined,
                      };
                    }
                    if (holdTile) {
                      holdTimer.current = setTimeout(() => {
                        canceledTap.current = true;
                        holdAction.current?.(i);
                      }, TILE_HOLD_MS);
                    }
                  }}
                  onPointerMove={(e) => {
                    const active = press.current;
                    if (
                      active &&
                      active.pointerId === e.pointerId &&
                      Math.hypot(e.clientX - active.x, e.clientY - active.y) > 10
                    ) cancelPress(e.pointerId);
                  }}
                  onPointerUp={(e) => {
                    if (press.current?.pointerId === e.pointerId)
                      clearTimeout(holdTimer.current);
                  }}
                  onPointerCancel={(e) => cancelPress(e.pointerId)}
                  onPointerLeave={(e) => {
                    if (e.pointerType !== "touch" && press.current?.index === i)
                      cancelPress(e.pointerId);
                  }}
                  onContextMenu={
                    canHoldTile && board[i]
                      ? (e) => {
                          if (press.current?.index === i && e.button !== 2 && !e.ctrlKey)
                            e.preventDefault();
                        }
                      : undefined
                  }
                  onMouseDown={(e) => {
                    if (keepInputFocus) e.preventDefault();
                  }}
                  onKeyDown={() => {
                    clearTimeout(holdTimer.current);
                    press.current = null;
                    canceledTap.current = false;
                  }}
                  onClick={(e) => {
                    clearTimeout(holdTimer.current);
                    const tap = press.current;
                    press.current = null;
                    if (keepInputFocus) e.preventDefault();
                    if (canceledTap.current) {
                      canceledTap.current = false;
                      return;
                    }
                    if (onDefinitionPick) {
                      const words = boardWordsThrough(board, n, i);
                      if (words.length) {
                        definitions.openSheet(e.currentTarget, words, `Words at ${coordinate(i, n)}`);
                        onDefinitionPick();
                      }
                      return;
                    }
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
                        className={`board-word-score ${word.direction}${word.bingo ? " bingo-word-score" : ""}`}
                        aria-label={`${word.word} ${word.direction}, ${word.score} ${word.fromPlay ? "points" : "face-value points"}${word.bingo ? ", bingo" : ""}`}
                      >
                        {word.bingo && <BingoBadge />}
                        {word.score}
                      </span>
                    ))}
                </button>
              );
            })}
          </Fragment>
        ))}
        {overlay}
      </div>
      {coordinateSelection && (
        <BoardCoordinates size={n} selection={coordinateSelection} />
      )}
      {definitions.popup}
    </div>
  );
}
