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
        <strong>Unseen tiles</strong>
        <span className={excess.length ? "tile-pool-alert" : undefined}>
          {excess.length ? (
            <>
              <TriangleAlert size={16} aria-hidden="true" />
              Check tile counts
            </>
          ) : (
            total
          )}
        </span>
        <ChevronDown
          className="tile-pool-chevron"
          size={15}
          aria-hidden="true"
        />
        {!excess.length && (
          <span className="tile-pool-breakdown">
            Vowels {totals.vowel} · Consonants {totals.consonant} · Blanks{" "}
            {totals.blank}
          </span>
        )}
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
        {excess.length > 0 && (
          <p className="error" role="status">
            More tiles entered than this set contains:{" "}
            {excess
              .map(
                ({ symbol, excess: amount }) =>
                  `${symbol === "?" ? "blank" : symbol} × ${amount} extra`,
              )
              .join(", ")}
            . Check your board, rack, or starting counts.
          </p>
        )}
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
                  <span>{extra ? "!" : count}</span>
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
