import { Fragment, type CSSProperties } from "react";
import { Star } from "lucide-react";
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
  preview,
  selected,
  onSelect,
  paint,
  compact = false,
}: {
  template: BoardTemplate;
  board: BoardState;
  preview?: Move | null;
  selected?: number | null;
  onSelect?: (index: number) => void;
  paint?: boolean;
  compact?: boolean;
}) {
  const n = template.size,
    placed = new Map(preview?.tiles.map((t) => [t.index, t.letter]) || []);
  return (
    <div className={`board-wrap ${compact ? "compact" : ""}`}>
      <div
        className={`board-grid ${paint ? "paint-board" : ""}`}
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
                ghost = placed.has(i),
                bonus = template.premiums[i];
              return (
                <button
                  type="button"
                  key={i}
                  data-cell={i}
                  tabIndex={compact ? -1 : undefined}
                  className={`square ${bonus.toLowerCase()} ${tile ? "occupied" : ""} ${ghost ? "ghost" : ""} ${selected === i ? "selected" : ""} ${tile && tile === tile.toLowerCase() ? "blank" : ""}`}
                  aria-label={`${coordinate(i, n)}${tile ? `: ${tile.toUpperCase()}${tile === tile.toLowerCase() ? " blank" : ""}` : bonus ? `: ${bonus}` : ": empty"}${i === template.start ? ", start" : ""}`}
                  aria-pressed={selected === i}
                  onClick={() => onSelect?.(i)}
                  onPointerEnter={(e) => {
                    if (paint && e.buttons === 1) onSelect?.(i);
                  }}
                >
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
