import { useMemo, useRef, useState, useEffect } from "react";
import {
  ArrowDownWideNarrow,
  ArrowRight,
  Search,
  Sparkles,
  X,
  LoaderCircle,
  Trophy,
  ChartNoAxesCombined,
} from "lucide-react";
import { type Game, type Move, coordinate } from "../../shared/model";
import { ANALYSIS_LIMIT, leaveValue } from "../../shared/move-analysis";
import { type BoardOddsResult, type RackOdds } from "../../shared/bingo-odds";
import MoveAnalysis from "./MoveAnalysis";
import BingoOddsControls from "./BingoOddsControls";

function formatOdds(chance: number, exact: boolean) {
  const value =
    chance > 0 && chance < 0.005
      ? "<1%"
      : chance < 1 && chance > 0.995
        ? ">99%"
        : `${Math.round(chance * 100)}%`;
  return exact ? value : `≈${value}`;
}

export default function Results({
  moves,
  busy,
  elapsed,
  error,
  size,
  rackSize,
  bingoBonus,
  preview,
  onPreview,
  onPlay,
  onSolve,
  hasRack,
  analysisGame,
  analysisKey,
  rackOdds,
  rackOddsPending,
  boardOdds,
  boardOddsProgress,
  boardOddsError,
  onBoardOdds,
  onCancelBoardOdds,
}: {
  moves: Move[] | null;
  busy: string;
  elapsed: number;
  error: string;
  size: number;
  rackSize: number;
  bingoBonus: number;
  preview: Move | null;
  onPreview: (m: Move | null) => void;
  onPlay: (m: Move) => void;
  onSolve: () => void;
  hasRack: boolean;
  analysisGame?: Game;
  analysisKey?: string;
  rackOdds?: RackOdds;
  rackOddsPending?: boolean;
  boardOdds?: BoardOddsResult;
  boardOddsProgress?: { checked: number; total: number };
  boardOddsError?: string;
  onBoardOdds?: (moves: Move[], bagSize: number) => void;
  onCancelBoardOdds?: () => void;
}) {
  const [filter, setFilter] = useState(""),
    [sort, setSort] = useState("score"),
    [scroll, setScroll] = useState(0),
    [locked, setLocked] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null),
    pointer = useRef("mouse");
  const [analyzing, setAnalyzing] = useState(false);
  const [candidates, setCandidates] = useState<Move[]>([]);
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
    if (sort === "equity") {
      const values = new Map<string, number>();
      for (const move of list)
        values.set(move.id, move.score + leaveValue(move.leave));
      list.sort(
        (a, b) => values.get(b.id)! - values.get(a.id)! || b.score - a.score,
      );
    }
    if (sort === "bingo-draw") {
      list.sort(
        (a, b) =>
          (rackOdds?.byLeave[b.leave] ?? -1) -
            (rackOdds?.byLeave[a.leave] ?? -1) || b.score - a.score,
      );
    }
    if (sort === "board-bingo") {
      list.sort(
        (a, b) =>
          (boardOdds?.byMove[b.id]?.chance ?? -1) -
            (boardOdds?.byMove[a.id]?.chance ?? -1) || b.score - a.score,
      );
    }
    return list;
  }, [moves, filter, sort, rackOdds, boardOdds]);
  useEffect(() => {
    setAnalyzing(false);
    setCandidates([]);
    setSort((current) => (current === "board-bingo" ? "score" : current));
  }, [moves]);
  function toggleCandidate(move: Move) {
    setCandidates((current) =>
      current.some((candidate) => candidate.id === move.id)
        ? current.filter((candidate) => candidate.id !== move.id)
        : current.length < ANALYSIS_LIMIT
          ? [...current, move]
          : current,
    );
  }
  useEffect(() => {
    setScroll(0);
    if (scroller.current) scroller.current.scrollTop = 0;
    setLocked(null);
  }, [moves, filter, sort]);
  const start = Math.max(0, Math.floor(scroll / 58) - 5),
    visible = results.slice(start, start + 30);
  return (
    <section
      className={`results-panel panel ${analysisGame || rackOdds ? "with-bingo-odds" : ""}`}
    >
      <header className="results-title">
        <div className="heading-with-icon">
          <Sparkles size={19} />
          <h2>Possible moves</h2>
        </div>
        {moves && (
          <span className="count-badge">{moves.length.toLocaleString()}</span>
        )}
        {analysisGame && !!moves?.length && !busy && !error && (
          <button
            type="button"
            className="button secondary analysis-toggle"
            aria-expanded={analyzing}
            onClick={() => {
              if (!analyzing)
                setCandidates([preview ?? results[0] ?? moves[0]]);
              setLocked(null);
              onPreview(null);
              setAnalyzing(!analyzing);
            }}
          >
            <ChartNoAxesCombined size={15} />{" "}
            {analyzing ? "Close analysis" : "Analyze"}
          </button>
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
            <option value="equity">Score + leave</option>
            <option value="word">A–Z</option>
            <option value="length">Word length</option>
            <option value="tiles">Tiles used</option>
            <option value="leave">Rack leave A–Z</option>
            <option value="bingo-draw" disabled={!rackOdds || !!rackOdds.error}>
              Bingo draw %
            </option>
            {(!!boardOdds?.checked || sort === "board-bingo") && (
              <option value="board-bingo">Bingo after play %</option>
            )}
            <option value="blanks">Fewest blanks</option>
          </select>
        </label>
      </div>
      {!busy &&
        !error &&
        !!moves?.length &&
        analysisGame &&
        onBoardOdds &&
        onCancelBoardOdds && (
          <BingoOddsControls
            key={analysisKey}
            game={analysisGame}
            moves={results}
            rackOdds={rackOdds}
            rackOddsPending={rackOddsPending}
            boardOdds={boardOdds}
            progress={boardOddsProgress}
            error={boardOddsError}
            onCheck={onBoardOdds}
            onCancel={onCancelBoardOdds}
          />
        )}
      {analyzing && analysisGame && !busy && (
        <MoveAnalysis
          key={analysisKey}
          game={analysisGame}
          candidates={candidates}
          onRemove={toggleCandidate}
        />
      )}
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
          <div className="result-legend" aria-label="Move letter colors">
            <span className="result-letter played">New tiles</span>
            <span className="result-letter existing">On board</span>
            <span className="result-letter assigned-blank">Blank</span>
          </div>
          <div className="result-columns">
            <span>WORD</span>
            <span>POSITION</span>
            <span className="result-leave">
              LEAVE
              {(analysisGame || rackOdds) && (
                <span title="Chance the refilled rack spells a full-length word">
                  BINGO DRAW %
                </span>
              )}
            </span>
            <span>PTS</span>
          </div>
          <div
            className="result-scroll"
            ref={scroller}
            onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
            aria-label="Suggested moves"
          >
            <div style={{ height: results.length * 58, position: "relative" }}>
              {visible.map((m, offset) => {
                const bingo = m.tiles.length === rackSize;
                const rackChance = rackOdds?.byLeave[m.leave];
                const rackPercent =
                  rackChance === undefined
                    ? undefined
                    : formatOdds(rackChance, !!rackOdds?.exact);
                const boardChance = boardOdds?.byMove[m.id];
                const boardPercent =
                  boardChance &&
                  formatOdds(boardChance.chance, boardChance.exact);
                const placed = new Map(m.tiles.map((t) => [t.index, t.letter]));
                const selected =
                  analyzing &&
                  candidates.some((candidate) => candidate.id === m.id);
                return (
                  <button
                    key={m.id}
                    className={`result-row ${bingo ? "bingo" : ""} ${preview?.id === m.id || selected ? "active" : ""}`}
                    aria-pressed={analyzing ? selected : undefined}
                    disabled={
                      analyzing &&
                      !selected &&
                      candidates.length >= ANALYSIS_LIMIT
                    }
                    style={{ top: (start + offset) * 58 }}
                    aria-label={`${m.word}, ${m.score} points, ${coordinate(m.row * size + m.col, size)} ${m.direction}, ${m.tiles.length} tiles${bingo ? `, bingo, ${bingoBonus}-point bonus included` : ""}${rackPercent ? `, bingo draw ${rackPercent}` : ""}${boardPercent ? `, bingo after your play ${boardPercent}` : ""}`}
                    onPointerDown={(e) => {
                      pointer.current = e.pointerType;
                    }}
                    onPointerEnter={(e) => {
                      if (
                        !analyzing &&
                        e.pointerType === "mouse" &&
                        matchMedia("(min-width:651px)").matches
                      )
                        onPreview(m);
                    }}
                    onPointerLeave={(e) => {
                      if (e.pointerType === "mouse" && !locked) onPreview(null);
                    }}
                    onFocus={() => {
                      if (!analyzing) onPreview(m);
                    }}
                    onClick={(e) => {
                      if (analyzing) {
                        toggleCandidate(m);
                        return;
                      }
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
                      <span className="result-letters" aria-hidden="true">
                        {[...m.word].map((letter, i) => {
                          const index =
                            m.row * size +
                            m.col +
                            i * (m.direction === "across" ? 1 : size);
                          const tile = placed.get(index);
                          const blank = tile && tile === tile.toLowerCase();
                          return (
                            <span
                              key={i}
                              className={`result-letter ${tile ? "played" : "existing"} ${blank ? "assigned-blank" : ""}`}
                              title={
                                tile
                                  ? blank
                                    ? "Play a blank"
                                    : "Play from rack"
                                  : "Already on board"
                              }
                            >
                              {letter}
                            </span>
                          );
                        })}
                      </span>
                      <small>
                        {bingo && (
                          <span
                            className="bingo-badge"
                            title={`All ${rackSize} tiles · +${bingoBonus} bonus included in score`}
                          >
                            <Trophy size={10} aria-hidden="true" />
                            BINGO
                          </span>
                        )}
                        {m.tiles.length} tile{m.tiles.length !== 1 ? "s" : ""}
                        {m.blanks
                          ? ` · ${m.blanks} blank${m.blanks > 1 ? "s" : ""}`
                          : ""}
                        {m.crosses.length
                          ? ` · +${m.crosses.length} cross`
                          : ""}
                      </small>
                    </span>
                    <span className="result-coordinate">
                      {coordinate(m.row * size + m.col, size)}
                      <span>{m.direction === "across" ? "→" : "↓"}</span>
                    </span>
                    <span className="result-leave">
                      <span>{m.leave || "—"}</span>
                      {(analysisGame || rackOdds) && (
                        <strong
                          className="result-draw-odds"
                          title="Chance the refilled rack spells a full-length word"
                        >
                          {rackPercent ?? (rackOddsPending ? "…" : "—")}
                        </strong>
                      )}
                      {boardPercent && (
                        <span
                          className="result-board-odds"
                          title="Chance of a legal bingo before the opponent replies"
                        >
                          After play {boardPercent}
                        </span>
                      )}
                    </span>
                    <strong className="result-score">{m.score}</strong>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
      <footer className="results-foot">
        {analyzing ? (
          <span>Choose up to three moves to analyze</span>
        ) : (
          <>
            <span className="desktop-hint">
              Hover to preview · click to play
            </span>
            <span className="mobile-hint">
              Tap to preview · tap again to play
            </span>
          </>
        )}
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
              {preview.tiles.length === rackSize
                ? ` · Bingo! +${bingoBonus} bonus included`
                : ""}
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
