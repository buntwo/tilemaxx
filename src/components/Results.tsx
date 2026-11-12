import { useMemo, useRef, useState, useEffect } from "react";
import {
  ArrowDownWideNarrow,
  ArrowRight,
  Search,
  Sparkles,
  X,
  LoaderCircle,
} from "lucide-react";
import { type Move, coordinate } from "../../shared/model";

export default function Results({
  moves,
  busy,
  elapsed,
  error,
  size,
  preview,
  onPreview,
  onPlay,
  onSolve,
  hasRack,
}: {
  moves: Move[] | null;
  busy: string;
  elapsed: number;
  error: string;
  size: number;
  preview: Move | null;
  onPreview: (m: Move | null) => void;
  onPlay: (m: Move) => void;
  onSolve: () => void;
  hasRack: boolean;
}) {
  const [filter, setFilter] = useState(""),
    [sort, setSort] = useState("score"),
    [scroll, setScroll] = useState(0),
    [locked, setLocked] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null),
    pointer = useRef("mouse");
  const results = useMemo(() => {
    const list = (moves || []).filter((m) =>
      m.word.includes(filter.trim().toUpperCase()),
    );
    if (sort === "word")
      list.sort((a, b) => a.word.localeCompare(b.word) || b.score - a.score);
    if (sort === "length")
      list.sort((a, b) => b.word.length - a.word.length || b.score - a.score);
    if (sort === "tiles")
      list.sort((a, b) => b.tiles.length - a.tiles.length || b.score - a.score);
    if (sort === "leave")
      list.sort((a, b) => a.leave.localeCompare(b.leave) || b.score - a.score);
    if (sort === "blanks")
      list.sort((a, b) => a.blanks - b.blanks || b.score - a.score);
    return list;
  }, [moves, filter, sort]);
  useEffect(() => {
    setScroll(0);
    if (scroller.current) scroller.current.scrollTop = 0;
    setLocked(null);
  }, [moves, filter, sort]);
  const start = Math.max(0, Math.floor(scroll / 58) - 5),
    visible = results.slice(start, start + 30);
  return (
    <section className="results-panel panel">
      <header className="results-title">
        <div className="heading-with-icon">
          <Sparkles size={19} />
          <h2>Possible moves</h2>
        </div>
        {moves && (
          <span className="count-badge">{moves.length.toLocaleString()}</span>
        )}
      </header>
      <div className="result-filters">
        <div className="search-input">
          <Search size={16} />
          <input
            aria-label="Filter moves"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a word…"
          />
        </div>
        <label className="sort-select">
          <ArrowDownWideNarrow size={16} />
          <select
            aria-label="Sort moves"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="score">Score</option>
            <option value="word">A–Z</option>
            <option value="length">Word length</option>
            <option value="tiles">Tiles used</option>
            <option value="leave">Rack leave</option>
            <option value="blanks">Fewest blanks</option>
          </select>
        </label>
      </div>
      {busy ? (
        <div className="results-empty">
          <LoaderCircle className="spin" size={30} />
          <h3>{busy}</h3>
          <p>Your board stays ready while we look.</p>
          <button className="button secondary" onClick={onSolve}>
            Cancel search
          </button>
        </div>
      ) : error ? (
        <div className="results-empty">
          <h3>Couldn’t finish this search</h3>
          <p className="error" role="alert">
            {error}
          </p>
          <button className="button secondary" onClick={onSolve}>
            Try again
          </button>
        </div>
      ) : moves === null ? (
        <div className="results-empty">
          <div className="illustrated-tiles">
            <span>
              A<small>1</small>
            </span>
            <span>
              H<small>4</small>
            </span>
            <span>
              A<small>1</small>
            </span>
          </div>
          <h3>A good move starts here.</h3>
          <p>
            Enter the board and your rack.
            <br />
            We’ll find the possibilities.
          </p>
          <button
            className="button secondary"
            onClick={onSolve}
            disabled={!hasRack}
          >
            <Sparkles size={16} />
            Find moves
          </button>
        </div>
      ) : !results.length ? (
        <div className="results-empty">
          <Search size={30} />
          <h3>{filter ? "No matching words" : "No legal moves found"}</h3>
          <p>
            {filter
              ? "Try a different word or clear the filter."
              : "Check your rack and board, or try a different dictionary."}
          </p>
        </div>
      ) : (
        <>
          <div className="result-columns">
            <span>WORD</span>
            <span>POSITION</span>
            <span className="result-leave">LEAVE</span>
            <span>PTS</span>
          </div>
          <div
            className="result-scroll"
            ref={scroller}
            onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
            aria-label="Suggested moves"
          >
            <div style={{ height: results.length * 58, position: "relative" }}>
              {visible.map((m, offset) => (
                <button
                  key={m.id}
                  className={`result-row ${preview?.id === m.id ? "active" : ""}`}
                  style={{ top: (start + offset) * 58 }}
                  aria-label={`${m.word}, ${m.score} points, ${coordinate(m.row * size + m.col, size)} ${m.direction}, ${m.tiles.length} tiles`}
                  onPointerDown={(e) => {
                    pointer.current = e.pointerType;
                  }}
                  onPointerEnter={(e) => {
                    if (
                      e.pointerType === "mouse" &&
                      matchMedia("(min-width:651px)").matches
                    )
                      onPreview(m);
                  }}
                  onPointerLeave={(e) => {
                    if (e.pointerType === "mouse" && !locked) onPreview(null);
                  }}
                  onFocus={() => onPreview(m)}
                  onClick={(e) => {
                    if (
                      (pointer.current === "mouse" &&
                        e.detail > 0 &&
                        matchMedia("(min-width:651px) and (hover:hover)")
                          .matches) ||
                      locked === m.id
                    ) {
                      setLocked(null);
                      onPlay(m);
                    } else {
                      setLocked(m.id);
                      onPreview(m);
                    }
                  }}
                >
                  <span className="result-word">
                    {m.word}
                    <small>
                      {m.tiles.length} tile{m.tiles.length !== 1 ? "s" : ""}
                      {m.blanks
                        ? ` · ${m.blanks} blank${m.blanks > 1 ? "s" : ""}`
                        : ""}
                      {m.crosses.length ? ` · +${m.crosses.length} cross` : ""}
                    </small>
                  </span>
                  <span className="result-coordinate">
                    {coordinate(m.row * size + m.col, size)}
                    <span>{m.direction === "across" ? "→" : "↓"}</span>
                  </span>
                  <span className="result-leave">{m.leave || "—"}</span>
                  <strong className="result-score">{m.score}</strong>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      <footer className="results-foot">
        <span className="desktop-hint">Hover to preview · click to play</span>
        <span className="mobile-hint">Tap to preview · tap again to play</span>
        {moves && (
          <span>
            {elapsed < 1000
              ? `${Math.round(elapsed)} ms`
              : `${(elapsed / 1000).toFixed(2)} s`}
          </span>
        )}
      </footer>
      {preview && (
        <div className="preview-summary">
          <div>
            <strong>{preview.word}</strong>
            <span>
              {preview.score} points
              {preview.crosses.length
                ? ` · also ${preview.crosses.join(", ")}`
                : ""}
            </span>
          </div>
          <button
            className="button primary"
            onClick={() => {
              setLocked(null);
              onPlay(preview);
            }}
          >
            Play
            <ArrowRight size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="Dismiss preview"
            onClick={() => {
              setLocked(null);
              onPreview(null);
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </section>
  );
}
