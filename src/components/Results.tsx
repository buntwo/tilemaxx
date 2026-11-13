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
  Calculator,
} from "lucide-react";
import { type Game, type Move, coordinate } from "../../shared/model";
import { ANALYSIS_LIMIT, placeTiles } from "../../shared/move-analysis";
import { scorePlacement } from "../../shared/game-scoring";
import { type BoardOddsResult, type RackOdds } from "../../shared/bingo-odds";
import MoveAnalysis from "./MoveAnalysis";
import BingoOddsControls from "./BingoOddsControls";
import Modal from "./Modal";
import { ScoreBreakdownContent } from "./ScoreBreakdown";
import PremiumDefense, {
  blockedReplyPoints,
  defenseLabel,
} from "./PremiumDefense";
import type { DefenseResults, MoveDefense } from "../../shared/premium-defense";
import { useReplyAnalysis } from "../useReplyAnalysis";
import type { ShortlistEntry } from "../../shared/move-shortlist";
import type {
  MoveResults,
  MoveSort,
  ShortlistOptions,
} from "../../shared/move-results";
import {
  moveRowHeight,
  useMoveResults,
  type FetchMovePage,
} from "../useMoveResults";
import ReplyAnalysis, {
  ReplyCell,
  replyScoreTotals,
  ReplySettings,
  signedPoints,
} from "./ReplyAnalysis";

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
  results: resultSet,
  fetchPage,
  fetchShortlist,
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
  replyEnabled = !!analysisGame,
  rackOdds,
  rackOddsPending,
  defense,
  defenseProgress,
  boardOdds,
  boardOddsProgress,
  boardOddsError,
  onBoardOdds,
  onCancelBoardOdds,
}: {
  results: MoveResults | null;
  fetchPage: FetchMovePage;
  fetchShortlist: (
    searchId: number,
    options: ShortlistOptions,
  ) => Promise<ShortlistEntry[] | undefined>;
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
  replyEnabled?: boolean;
  rackOdds?: RackOdds;
  rackOddsPending?: boolean;
  defense?: DefenseResults;
  defenseProgress?: string;
  boardOdds?: BoardOddsResult;
  boardOddsProgress?: { checked: number; total: number };
  boardOddsError?: string;
  onBoardOdds?: (moves: Move[], bagSize: number) => void;
  onCancelBoardOdds?: () => void;
}) {
  const [filter, setFilter] = useState(""),
    [sort, setSort] = useState<MoveSort>("score"),
    [scroll, setScroll] = useState(0),
    [locked, setLocked] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null),
    pointer = useRef("mouse");
  const [analyzing, setAnalyzing] = useState(false);
  const [candidates, setCandidates] = useState<Move[]>([]);
  const [shortlistOnly, setShortlistOnly] = useState(false);
  const shortlistActive = shortlistOnly && !!analysisGame;
  const replyCandidates = resultSet?.head ?? null;
  const totalMoves = resultSet?.total ?? 0;
  const replyAnalysis = useReplyAnalysis(
    analysisGame,
    analysisKey,
    replyCandidates,
    replyEnabled && !busy && !error,
  );
  const targetIds = useMemo(
    () => new Set(replyAnalysis.target.map(({ id }) => id)),
    [replyAnalysis.target],
  );
  const [inspectedReply, setInspectedReply] = useState<{
    id: string;
    searchId: number;
  }>();
  const replyMove =
    inspectedReply?.searchId === resultSet?.searchId
      ? replyAnalysis.target.find(({ id }) => id === inspectedReply?.id)
      : undefined;
  const replyDetail = replyMove && replyAnalysis.results?.[replyMove.id];
  const shortlistReplies = replyAnalysis.pending
    ? undefined
    : replyAnalysis.results;
  const [shortlistResult, setShortlistResult] = useState<{
    searchId: number;
    entries: ShortlistEntry[];
  }>();
  const searchId = resultSet?.searchId;
  const endgame = replyAnalysis.bagSize === 0;
  const canShortlist = !!analysisGame && !busy && !error;
  useEffect(() => {
    if (!canShortlist || searchId === undefined) return;
    let current = true;
    const settle = (entries: ShortlistEntry[] = []) => {
      if (current) setShortlistResult({ searchId, entries });
    };
    void fetchShortlist(searchId, {
      rackOdds,
      boardOdds,
      defense,
      replies: shortlistReplies,
      endgame,
    }).then(settle, () => settle());
    return () => {
      current = false;
    };
  }, [
    canShortlist,
    searchId,
    fetchShortlist,
    rackOdds,
    boardOdds,
    defense,
    shortlistReplies,
    endgame,
  ]);
  const shortlist =
    shortlistResult && shortlistResult.searchId === searchId
      ? shortlistResult.entries
      : [];
  const shortlistById = useMemo(
    () => new Map(shortlist.map((entry) => [entry.move.id, entry])),
    [shortlist],
  );
  const replyScores =
    analysisGame && replyAnalysis.bagSize === 0
      ? replyScoreTotals(analysisGame)
      : undefined;
  const topScore = resultSet?.head[0]?.score ?? 0;
  const [inspected, setInspected] = useState<{ move: Move; key?: string }>();
  const [inspectedDefense, setInspectedDefense] = useState<{
    move: Move;
    risk: MoveDefense;
    key?: string;
  }>();
  const defenseDetail =
    inspectedDefense?.key === analysisKey ? inspectedDefense : undefined;
  const inspectedMove =
    inspected?.key === analysisKey ? inspected?.move : undefined;
  const breakdown =
    inspectedMove &&
    analysisGame &&
    scorePlacement(
      analysisGame.board,
      placeTiles(analysisGame.board, inspectedMove),
      analysisGame.template,
      inspectedMove.direction,
    );
  const filteredShortlist = shortlist
    .map(({ move }) => move)
    .filter((move) => move.word.includes(filter.trim().toUpperCase()));
  const page = useMoveResults(
    resultSet,
    {
      filter,
      sort,
      offset: shortlistActive
        ? 0
        : Math.max(0, Math.floor(scroll / moveRowHeight) - 5),
      rackOdds: sort === "bingo-draw" ? rackOdds : undefined,
      boardOdds: sort === "board-bingo" ? boardOdds : undefined,
    },
    fetchPage,
    !busy && !error,
  );
  const total = shortlistActive ? filteredShortlist.length : page.total;
  const start = shortlistActive ? 0 : page.start;
  const visible = shortlistActive ? filteredShortlist : page.visible;
  useEffect(() => {
    setAnalyzing(false);
    setCandidates([]);
    setSort((current) => (current === "board-bingo" ? "score" : current));
  }, [resultSet]);
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
  }, [resultSet, filter, sort, shortlistOnly]);
  return (
    <section
      className={`results-panel panel ${analysisGame || rackOdds ? "with-bingo-odds" : ""}`}
    >
      <header className="results-title">
        <div className="heading-with-icon">
          <Sparkles size={19} />
          <h2>Possible moves</h2>
        </div>
        {resultSet && (
          <span className="count-badge">{totalMoves.toLocaleString()}</span>
        )}
        {analysisGame && !!totalMoves && !busy && !error && (
          <button
            type="button"
            className="button secondary analysis-toggle"
            aria-expanded={analyzing}
            disabled={
              !analyzing &&
              (shortlistActive ? !total : page.pending || page.unavailable)
            }
            onClick={() => {
              if (!analyzing)
                setCandidates(
                  shortlistActive
                    ? filteredShortlist.slice(0, ANALYSIS_LIMIT)
                    : [preview ?? page.head[0] ?? resultSet!.head[0]],
                );
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
      {analysisGame && !!totalMoves && !busy && !error && (
        <div
          className="result-view-picker"
          role="group"
          aria-label="Move list view"
        >
          <button
            type="button"
            aria-pressed={!shortlistOnly}
            onClick={() => setShortlistOnly(false)}
          >
            All moves
          </button>
          <button
            type="button"
            aria-pressed={shortlistOnly}
            onClick={() => setShortlistOnly(true)}
          >
            Shortlist <span>{shortlist.length}</span>
          </button>
        </div>
      )}
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
        {!shortlistOnly && (
          <label className="sort-select">
            <ArrowDownWideNarrow size={16} />
            <select
              aria-label="Sort moves"
              value={sort}
              onChange={(e) => setSort(e.target.value as MoveSort)}
            >
              <option value="score">Score</option>
              <option value="equity">Score + leave</option>
              <option value="word">A–Z</option>
              <option value="length">Word length</option>
              <option value="tiles">Tiles used</option>
              <option value="leave">Rack leave A–Z</option>
              <option
                value="bingo-draw"
                disabled={!rackOdds || !!rackOdds.error}
              >
                Bingo draw %
              </option>
              {(!!boardOdds?.checked || sort === "board-bingo") && (
                <option value="board-bingo">Bingo after play %</option>
              )}
              <option value="blanks">Fewest blanks</option>
            </select>
          </label>
        )}
      </div>
      {!busy &&
        !error &&
        !!totalMoves &&
        analysisGame &&
        onBoardOdds &&
        onCancelBoardOdds && (
          <BingoOddsControls
            key={analysisKey}
            game={analysisGame}
            moves={page.head}
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
      ) : resultSet === null ? (
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
      ) : !shortlistActive && page.unavailable ? (
        <div className="results-empty">
          <p role="status">
            Move results are unavailable. Find moves again to reload them.
          </p>
          <button className="button secondary" onClick={onSolve}>
            Find moves
          </button>
        </div>
      ) : (
          shortlistActive
            ? shortlistResult?.searchId !== searchId
            : page.pending
        ) ? (
        <div className="results-empty" role="status">
          <LoaderCircle className="spin" size={24} />
          <p>Loading move list…</p>
        </div>
      ) : !total ? (
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
          {replyEnabled && analysisGame && (
            <div className="reply-controls" key={analysisKey}>
              <ReplySettings analysis={replyAnalysis} />
              {replyAnalysis.invalid && (
                <span>Check tile counts for reply analysis.</span>
              )}
              {replyAnalysis.error && (
                <span role="status">{replyAnalysis.error}</span>
              )}
              {!replyAnalysis.invalid && replyAnalysis.bagSize === 0 && (
                <span>
                  {replyAnalysis.bagAssumedEmpty
                    ? "Bag assumed empty"
                    : "Empty bag"}
                </span>
              )}
            </div>
          )}
          <div className="result-legend" aria-label="Move letter colors">
            <span className="result-letter played">New tiles</span>
            <span className="result-letter existing">On board</span>
            <span className="result-letter assigned-blank">Blank</span>
          </div>
          <div
            className={`result-columns${analysisGame ? " with-score-action" : ""}`}
          >
            <span>WORD</span>
            <span title="Position">POS</span>
            <span className="result-leave">
              LEAVE
              {(analysisGame || rackOdds) && (
                <span title="Chance the refilled rack spells a full-length word">
                  BINGO DRAW %
                </span>
              )}
            </span>
            <span
              className="result-points-heading"
              title="Score and points below the highest-scoring play"
            >
              PTS
            </span>
            {replyEnabled && analysisGame && (
              <span
                className="result-reply-heading"
                title="Reply score compared with the highest-scoring play. A standalone badge flags a premium-square opening or block."
              >
                Δ REPLY
              </span>
            )}
          </div>
          <div
            className={`result-scroll${shortlistActive ? " is-shortlist" : ""}`}
            ref={scroller}
            onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
            aria-label="Suggested moves"
          >
            <div
              style={{ height: total * moveRowHeight, position: "relative" }}
            >
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
                const risk = analysisGame && defense?.[m.id];
                const riskScore = risk?.opened?.after?.score;
                const blockedPoints = risk?.closed
                  ? blockedReplyPoints(risk.closed)
                  : undefined;
                const reply = replyAnalysis.results?.[m.id];
                const replyPending =
                  targetIds.has(m.id) &&
                  replyAnalysis.pending &&
                  !(m.id in (replyAnalysis.results ?? {}));
                const sacrifice = topScore - m.score;
                const short = shortlistOnly
                  ? shortlistById.get(m.id)
                  : undefined;
                const selected =
                  analyzing &&
                  candidates.some((candidate) => candidate.id === m.id);
                return (
                  <div
                    className={`result-slot${analysisGame ? " with-score-action" : ""}`}
                    key={m.id}
                    style={{ top: (start + offset) * moveRowHeight }}
                  >
                    <button
                      className={`result-row ${bingo ? "bingo" : ""} ${preview?.id === m.id || selected ? "active" : ""}`}
                      aria-pressed={analyzing ? selected : undefined}
                      disabled={
                        analyzing &&
                        !selected &&
                        candidates.length >= ANALYSIS_LIMIT
                      }
                      aria-label={`${m.word}, ${m.score} points, ${coordinate(m.row * size + m.col, size)} ${m.direction}, ${m.tiles.length} tiles${bingo ? `, bingo, ${bingoBonus}-point bonus included` : ""}${rackPercent ? `, bingo draw ${rackPercent}` : ""}${boardPercent ? `, bingo after your play ${boardPercent}` : ""}${sacrifice ? `, ${sacrifice} below top score` : ""}${short ? `, ${short.reason}${short.detail ? `, ${short.detail}` : ""}` : ""}`}
                      onPointerDown={(e) => {
                        pointer.current = e.pointerType;
                      }}
                      onPointerEnter={(e) => {
                        if (
                          !analyzing &&
                          !locked &&
                          e.pointerType === "mouse" &&
                          matchMedia("(min-width:651px)").matches
                        )
                          onPreview(m);
                      }}
                      onPointerLeave={(e) => {
                        if (e.pointerType === "mouse" && !locked)
                          onPreview(null);
                      }}
                      onFocus={() => {
                        if (!analyzing && !locked) onPreview(m);
                      }}
                      onContextMenu={(event) => {
                        if (analyzing) return;
                        event.preventDefault();
                        setLocked(m.id);
                        onPreview(m);
                      }}
                      onKeyDown={(event) => {
                        if (analyzing || event.key.toLowerCase() !== "p")
                          return;
                        event.preventDefault();
                        setLocked(m.id);
                        onPreview(m);
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
                      <span className="result-word result-stack">
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
                        <small title={short?.detail}>
                          {bingo && (
                            <span
                              className="bingo-badge"
                              title={`All ${rackSize} tiles · +${bingoBonus} bonus included in score`}
                            >
                              <Trophy size={10} aria-hidden="true" />
                              BINGO
                            </span>
                          )}
                          {short
                            ? `${short.reason}${short.detail ? ` · ${short.detail}` : ""}`
                            : `${m.tiles.length} tile${m.tiles.length !== 1 ? "s" : ""}`}
                          {!short && m.blanks
                            ? ` · ${m.blanks} blank${m.blanks > 1 ? "s" : ""}`
                            : ""}
                          {!short && m.crosses.length
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
                      <span className="result-score result-stack">
                        <strong>{m.score}</strong>
                        <small
                          className="result-score-delta"
                          data-loss={
                            sacrifice >= 6
                              ? "high"
                              : sacrifice >= 3
                                ? "mid"
                                : sacrifice
                                  ? "low"
                                  : "none"
                          }
                        >
                          {signedPoints(-sacrifice)}
                        </small>
                      </span>
                    </button>
                    {reply && analysisGame && (
                      <button
                        type="button"
                        className="result-defense-action result-reply-action icon-button"
                        onClick={() => {
                          if (searchId !== undefined)
                            setInspectedReply({ id: m.id, searchId });
                        }}
                      >
                        <span className="reply-sr-only">
                          Reply analysis for {m.word} at{" "}
                          {coordinate(m.row * size + m.col, size)} {m.direction}
                          .{" "}
                        </span>
                        <ReplyCell
                          move={m}
                          result={reply}
                          scores={replyScores}
                        />
                      </button>
                    )}
                    {analysisGame && (
                      <button
                        type="button"
                        className="result-score-action icon-button"
                        aria-label={`Score breakdown for ${m.word} at ${coordinate(m.row * size + m.col, size)} ${m.direction}`}
                        title="Score breakdown"
                        onClick={() =>
                          setInspected({ move: m, key: analysisKey })
                        }
                      >
                        <Calculator size={15} aria-hidden="true" />
                      </button>
                    )}
                    {replyPending && (
                      <span
                        className="result-defense-action result-reply-pending"
                        role="img"
                        aria-label={`Checking replies after ${m.word}`}
                      >
                        <LoaderCircle
                          size={14}
                          className="spin"
                          aria-hidden="true"
                        />
                      </span>
                    )}
                    {!reply && !replyPending && risk && (
                      <button
                        type="button"
                        className={`result-defense-action icon-button ${risk.opened ? "defense-warning" : "defense-covered"}`}
                        aria-label={`Reply risk for ${m.word} at ${coordinate(m.row * size + m.col, size)} ${m.direction}. ${defenseLabel(risk, size)}`}
                        title={defenseLabel(risk, size)}
                        onClick={() =>
                          setInspectedDefense({
                            move: m,
                            risk,
                            key: analysisKey,
                          })
                        }
                      >
                        <span
                          className="result-defense-badge"
                          aria-hidden="true"
                        >
                          {riskScore === undefined
                            ? `−${blockedPoints}`
                            : `↑${riskScore}`}
                        </span>
                      </button>
                    )}
                  </div>
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
              Hover to preview · right-click or P to pin · click to play
            </span>
            <span className="mobile-hint">
              Tap to preview · tap again to play
            </span>
          </>
        )}
        {replyAnalysis.pending ? (
          <span title="Checking opponent replies">
            Replies {Object.keys(replyAnalysis.results ?? {}).length}/
            {replyAnalysis.target.length}
          </span>
        ) : defenseProgress ? (
          <span title="Checking premium replies">Risk {defenseProgress}</span>
        ) : (
          resultSet && (
            <span>
              {elapsed < 1000
                ? `${Math.round(elapsed)} ms`
                : `${(elapsed / 1000).toFixed(2)} s`}
            </span>
          )
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
            {shortlistOnly && shortlistById.get(preview.id)?.detail && (
              <span>{shortlistById.get(preview.id)?.detail}</span>
            )}
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
      {inspectedMove && (
        <Modal
          title={`Score breakdown · ${inspectedMove.word}`}
          subtitle={`${coordinate(inspectedMove.row * size + inspectedMove.col, size)} ${inspectedMove.direction}`}
          onClose={() => setInspected(undefined)}
        >
          {breakdown ? (
            <ScoreBreakdownContent breakdown={breakdown} />
          ) : (
            <p>This position changed. Find moves again to check the score.</p>
          )}
        </Modal>
      )}
      {analysisGame && defenseDetail && (
        <PremiumDefense
          game={analysisGame}
          move={defenseDetail.move}
          defense={defense?.[defenseDetail.move.id] ?? defenseDetail.risk}
          onClose={() => setInspectedDefense(undefined)}
        />
      )}
      {analysisGame && replyMove && replyDetail && (
        <ReplyAnalysis
          game={analysisGame}
          move={replyMove}
          result={replyDetail}
          defense={defense?.[replyMove.id]}
          analysis={replyAnalysis}
          onClose={() => setInspectedReply(undefined)}
        />
      )}
    </section>
  );
}
