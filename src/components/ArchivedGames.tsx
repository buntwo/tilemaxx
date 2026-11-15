import { useState } from "react";
import { ArrowLeft, ArrowRight, Pencil } from "lucide-react";
import { opponentNameMatches, type GameSummary } from "../../shared/game-index";
import { FullMoveHistoryIcon, GameMetadata } from "./GameDetails";
import GameScoreBadge, { describeGameScore } from "./GameScoreBadge";
import LayoutThumbnail from "./LayoutThumbnail";

export type ArchiveSort = "date" | "opponent";
const opponentOrder = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

export default function ArchivedGames({
  games,
  sort,
  onSort,
  onOpen,
  onEdit,
  onBack,
}: {
  games: GameSummary[];
  sort: ArchiveSort;
  onSort: (sort: ArchiveSort) => void;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const results = games
    .filter((game) => opponentNameMatches(game.name, query))
    .sort((a, b) => {
      const byDate = (b.startedOn ?? "").localeCompare(a.startedOn ?? "");
      const byOpponent = opponentOrder.compare(a.name, b.name);
      return sort === "date" ? byDate || byOpponent : byOpponent || byDate;
    });
  const total = games.length.toLocaleString();
  const count = query.trim()
    ? `${results.length.toLocaleString()} / ${total}`
    : total;

  return (
    <section className="archive-view" aria-labelledby="archive-heading">
      <div className="workspace-heading">
        <div className="archive-title">
          <h1 id="archive-heading">Archived games</h1>
          <output
            className="count-badge archive-count"
            aria-label="Archived game count"
          >
            {count}
          </output>
        </div>
        <button className="button secondary archive-back" onClick={onBack}>
          <ArrowLeft size={16} />
          Back to games
        </button>
      </div>
      <div className="panel archive-panel">
        {games.length ? (
          <>
            <div className="archive-controls">
              <input
                className="archive-filter"
                type="search"
                aria-label="Filter by opponent"
                placeholder="Filter by opponent"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
              <label className="archive-sort">
                Sort by
                <select
                  value={sort}
                  onChange={(e) =>
                    onSort(e.target.value === "opponent" ? "opponent" : "date")
                  }
                >
                  <option value="date">Date (newest first)</option>
                  <option value="opponent">Opponent (A–Z)</option>
                </select>
              </label>
            </div>
            {results.length ? (
              <ul className="archive-games">
                {results.map((game) => (
                  <li key={game.id}>
                    <button
                      className="archive-open"
                      aria-description={
                        game.score ? describeGameScore(game.score) : undefined
                      }
                      onClick={() => onOpen(game.id)}
                    >
                      <LayoutThumbnail
                        thumbnail={game.thumbnail}
                        platform={game.platform}
                      />
                      <span className="game-picker-label">
                        <strong>
                          {game.name}
                          {game.fullMoveHistory && <FullMoveHistoryIcon />}
                        </strong>
                        <small>
                          <GameMetadata game={game} />
                        </small>
                      </span>
                      {game.score && <GameScoreBadge score={game.score} />}
                      <ArrowRight className="archive-arrow" size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Edit game with ${game.name}`}
                      title="Edit game details"
                      onClick={() => onEdit(game.id)}
                    >
                      <Pencil size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted" role="status">
                No matching games.
              </p>
            )}
          </>
        ) : (
          <p className="muted">No archived games.</p>
        )}
      </div>
    </section>
  );
}
