import { ArrowLeft, ArrowRight, Pencil } from "lucide-react";
import type { GameSummary } from "../../shared/game-index";
import { GameMetadata } from "./GameDetails";
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
  const sorted = [...games].sort((a, b) => {
    const byDate = (b.startedOn ?? "").localeCompare(a.startedOn ?? "");
    const byOpponent = opponentOrder.compare(a.name, b.name);
    return sort === "date" ? byDate || byOpponent : byOpponent || byDate;
  });

  return (
    <section className="archive-view" aria-labelledby="archive-heading">
      <div className="workspace-heading">
        <h1 id="archive-heading">Archived games</h1>
        <button className="button secondary archive-back" onClick={onBack}>
          <ArrowLeft size={16} />
          Back to games
        </button>
      </div>
      <div className="panel archive-panel">
        {sorted.length ? (
          <>
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
            <ul className="archive-games">
              {sorted.map((game) => (
                <li key={game.id}>
                  <button
                    className="archive-open"
                    onClick={() => onOpen(game.id)}
                  >
                    <LayoutThumbnail thumbnail={game.thumbnail} />
                    <span className="game-picker-label">
                      <strong>{game.name}</strong>
                      <small>
                        <GameMetadata game={game} />
                      </small>
                    </span>
                    <ArrowRight size={16} />
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
          </>
        ) : (
          <p className="muted">No archived games.</p>
        )}
      </div>
    </section>
  );
}
