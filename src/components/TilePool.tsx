import { useState } from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";
import type { unseenTiles } from "../../shared/tile-pool";

export default function TilePool({
  pool,
  solo,
  rackUnknown,
  id,
  open,
  hideWhenClosed = false,
  onOpenChange,
}: {
  pool: ReturnType<typeof unseenTiles>;
  solo?: boolean;
  rackUnknown?: boolean;
  id: string;
  open: boolean;
  hideWhenClosed?: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [filter, setFilter] = useState("all");
  const { tiles, totals, total, excess } = pool;
  const visible = tiles.filter((tile) => {
    switch (filter) {
      case "remaining":
        return tile.count > 0;
      case "vowel":
      case "consonant":
        return tile.kind === filter;
      case "high":
        return tile.score >= 5;
      default:
        return true;
    }
  });

  return (
    <details
      className="tile-pool"
      hidden={hideWhenClosed && !open}
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
    >
      <summary>
        <span className="tile-pool-summary-counts">
          <strong>
            <span className="tile-pool-count">{total}</span> unseen{" "}
            {total === 1 ? "tile" : "tiles"}
          </strong>
          <span className="tile-pool-breakdown">
            {([
              ["vowel", "vow."],
              ["consonant", "cons."],
              ["blank"],
            ] as const).map(([kind, short]) => {
              const count = totals[kind];
              const label = `${count} ${kind}${count === 1 ? "" : "s"}`;
              const overdrawn = excess.some((tile) => tile.kind === kind);
              return (
                <span key={kind}>
                  {" · "}
                  <span
                    className={overdrawn ? "tile-pool-category-alert" : undefined}
                    aria-label={overdrawn ? `${label}, count exceeded` : undefined}
                  >
                    {short ? (
                      <>
                        <span className="tile-pool-full-count">{label}</span>
                        <abbr className="tile-pool-compact-count" title={label}>
                          {count} {short}
                        </abbr>
                      </>
                    ) : label}
                  </span>
                </span>
              );
            })}
          </span>
        </span>
        {!!excess.length && (
          <span className="tile-pool-alert">
            <TriangleAlert size={16} aria-hidden="true" />
            Check tile counts
          </span>
        )}
        <ChevronDown
          className="tile-pool-chevron"
          size={15}
          aria-hidden="true"
        />
      </summary>
      <div className="tile-pool-content" id={id}>
        <div className="tile-pool-controls">
          <p>{rackUnknown
            ? "Your rack wasn’t recorded. These counts include any tiles it held."
            : solo
              ? "Unseen tiles are the tiles remaining in the bag."
              : "Includes tiles in the bag and on other players’ racks."}</p>
          <select
            aria-label="Filter unseen tiles"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All letters</option>
            <option value="remaining">Remaining only</option>
            <option value="vowel">Vowels</option>
            <option value="consonant">Consonants</option>
            <option value="high">High value (5+)</option>
          </select>
        </div>
        {visible.length ? (
          <>
            <div className="tile-pool-key" aria-label="Unseen count colors">
              <span className="count-low">1–2</span>
              <span className="count-mid">3–5</span>
              <span className="count-high">6+</span>
            </div>
            <ul className="tile-pool-grid" aria-label="Unseen tile counts">
              {visible.map(({ symbol, count, kind, excess: extra }) => (
                <li
                  key={symbol}
                  className={`tile-pool-tile ${extra ? "overdrawn" : !count ? "exhausted" : count <= 2 ? "count-low" : count <= 5 ? "count-mid" : "count-high"}`}
                  aria-label={`${kind === "blank" ? "Blank" : symbol}: ${extra ? `${extra} extra` : `${count} unseen`}`}
                >
                  <strong>{symbol}</strong>
                  <span>{extra ? -extra : count}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="tile-pool-empty">No unseen tiles left.</p>
        )}
      </div>
    </details>
  );
}
