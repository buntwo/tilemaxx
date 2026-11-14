import { useState } from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { type Game } from "../../shared/model";
import { unseenTiles } from "../../shared/tile-pool";

export default function TilePool({ game }: { game: Game }) {
  const [filter, setFilter] = useState("all");
  const { tiles, totals, total, excess } = unseenTiles(game, game.template);
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
    <details className="tile-pool">
      <summary>
        <strong>
          {total} unseen {total === 1 ? "tile" : "tiles"}
        </strong>
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
        <span className="tile-pool-breakdown">
          {(
            [
              ["vowel", "Vowels"],
              ["consonant", "Consonants"],
              ["blank", "Blanks"],
            ] as const
          ).map(([kind, label], i) => {
            const overdrawn = excess.some((tile) => tile.kind === kind);
            return (
              <span key={kind}>
                {i > 0 && " · "}
                <span
                  className={overdrawn ? "tile-pool-category-alert" : undefined}
                  aria-label={
                    overdrawn
                      ? `${label} ${totals[kind]}, count exceeded`
                      : undefined
                  }
                >
                  {label} {totals[kind]}
                </span>
              </span>
            );
          })}
        </span>
      </summary>
      <div className="tile-pool-content">
        <div className="tile-pool-controls">
          <p>Includes tiles in the bag and on other players’ racks.</p>
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
            <ul
              className={`tile-pool-grid ${filter === "remaining" ? "remaining" : ""}`}
              aria-label="Unseen tile counts"
            >
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
