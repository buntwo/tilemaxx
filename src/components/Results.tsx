import {
  useId,
  useMemo,
  useRef,
  useState,
  useEffect,
  type ReactElement,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  Search,
  Sparkles,
  LoaderCircle,
  Trophy,
  ChartNoAxesCombined,
} from "lucide-react";
import {
  bingoPoints,
  isBingo,
  type BingoRules,
  type Game,
  type Move,
  coordinate,
} from "../../shared/model";
import {
  REPLY_REFINED_SAMPLES,
  REPLY_SAMPLES,
} from "../../shared/reply-analysis";
import { ANALYSIS_LIMIT } from "../../shared/move-analysis";
import { scoreTotalsAtPosition } from "../../shared/game-scoring";
import { type BoardOddsResult, type RackOdds } from "../../shared/bingo-odds";
import { finalMarginLabel, scoreTone, signedPoints } from "../score-tone";
import MoveAnalysis from "./MoveAnalysis";
import MoveWord, { BingoBadge } from "./MoveWord";
import BingoOddsControls from "./BingoOddsControls";
import CalculationIndicator from "./CalculationIndicator";
import { useGameCalculating } from "./GameCalculations";
import { useMoveScoreTooltip } from "./MoveScoreTooltip";
import PremiumDefense, {
  blockedReplyPoints,
  defenseLabel,
} from "./PremiumDefense";
import type { DefenseResults, MoveDefense } from "../../shared/premium-defense";
import type { useReplyAnalysis } from "../useReplyAnalysis";
import type { BoardOddsProgress } from "../useSolver";
import type { ShortlistEntry } from "../../shared/move-shortlist";
import {
  coversRequiredSquares,
  defaultSortDescending,
  moveComparator,
  type MoveResults,
  type MoveSort,
  type RequiredSquares,
  type ShortlistOptions,
} from "../../shared/move-results";
import {
  moveRowHeight,
  useMoveResults,
  type FetchMovePage,
} from "../useMoveResults";
import ReplyHeatmapDialog, {
  ReplyCell,
  ReplyPreview,
  ReplySettings,
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

function canHoverWithMouse(pointerType: string) {
  return pointerType === "mouse" && matchMedia("(any-hover: hover)").matches;
}

export default function Results({
  results: resultSet,
  exchangeAction,
  compact = false,
  collapsibleSearch = compact,
  fetchPage,
  fetchShortlist,
  busy,
  calculating = false,
  elapsed,
  error,
  size,
  bingoRules,
  preview,
  requiredSquares,
  squareFilterControl,
  onPreview,
  phoneLayout = false,
  onPlay,
  onSolve,
  onCancelSearch,
  hasRack,
  analysisGame,
  analysisKey,
  replyAnalysis,
  replyEnabled = !!analysisGame,
  rackOdds: calculatedRackOdds,
  rackOddsPending,
  defense,
  defenseProgress,
  boardOdds: checkedBoardOdds,
  boardOddsProgress,
  boardOddsError,
  onBoardOdds,
  onCancelBoardOdds,
}: {
  results: MoveResults | null;
  exchangeAction?: ReactElement | false;
  compact?: boolean;
  collapsibleSearch?: boolean;
  fetchPage: FetchMovePage;
  fetchShortlist: (
    searchId: number,
    options: ShortlistOptions,
  ) => Promise<ShortlistEntry[] | undefined>;
  busy: string;
  calculating?: boolean;
  elapsed: number;
  error: string;
  size: number;
  bingoRules: BingoRules;
  preview: Move | null;
  requiredSquares?: RequiredSquares;
  squareFilterControl?: ReactElement;
  onPreview: (m: Move | null, analysis?: boolean) => void;
  phoneLayout?: boolean;
  onPlay: (m: Move) => void;
  onSolve: (reload?: boolean) => void;
  onCancelSearch: () => void;
  hasRack: boolean;
  analysisGame?: Game;
  analysisKey?: string;
  replyAnalysis: ReturnType<typeof useReplyAnalysis>;
  replyEnabled?: boolean;
  rackOdds?: RackOdds;
  rackOddsPending?: boolean;
  defense?: DefenseResults;
  defenseProgress?: string;
  boardOdds?: BoardOddsResult;
  boardOddsProgress?: BoardOddsProgress;
  boardOddsError?: string;
  onBoardOdds?: (moves: Move[], bagSize: number) => void;
  onCancelBoardOdds?: () => void;
}) {
  const [filter, setFilter] = useState(""),
    [scroll, setScroll] = useState(0),
    [locked, setLocked] = useState<string | null>(null);
  const localCalculation = useGameCalculating();
  const scroller = useRef<HTMLDivElement>(null),
    pointer = useRef("mouse");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const filterInputId = useId();
  useEffect(() => {
    if (collapsibleSearch && searchOpen)
      searchInput.current?.focus({ preventScroll: true });
  }, [collapsibleSearch, searchOpen]);
  function closeSearch() {
    setSearchOpen(false);
    setFilter("");
    searchButton.current?.focus();
  }
  const [analyzing, setAnalyzing] = useState(false);
  const replyMetricId = useId();
  const [candidates, setCandidates] = useState<Move[]>([]);
  const [shortlistOnly, setShortlistOnly] = useState(false);
  const shortlistActive = shortlistOnly && !!analysisGame;
  const totalMoves = resultSet?.total ?? 0;
  const endgame = !!analysisGame && replyAnalysis.bagSize === 0;
  const rackOdds = endgame ? undefined : calculatedRackOdds;
  const boardOdds =
    !endgame && checkedBoardOdds?.bagSize === replyAnalysis.bagSize
      ? checkedBoardOdds
      : undefined;
  const targetIds = useMemo(
    () => new Set(replyAnalysis.target.map(({ id }) => id)),
    [replyAnalysis.target],
  );
  const [inspectedReply, setInspectedReply] = useState<{
    id: string;
    searchId: number;
  }>();
  const [heatmap, setHeatmap] = useState<{ id: string; searchId: number }>();
  const replyMove =
    (analyzing ? null : preview) ??
    (inspectedReply?.searchId === resultSet?.searchId
      ? replyAnalysis.target.find(({ id }) => id === inspectedReply?.id)
      : undefined);
  const replyDetail = replyMove && replyAnalysis.results?.[replyMove.id];
  const reserveReplySpace =
    compact && !analyzing && replyEnabled && replyAnalysis.bagSize > 0;
  const heatmapMove =
    heatmap?.searchId === resultSet?.searchId
      ? replyAnalysis.target.find(({ id }) => id === heatmap?.id)
      : undefined;
  const originalHeatmap =
    heatmapMove && replyAnalysis.results?.[heatmapMove.id];
  const heatmapDetail =
    heatmapMove &&
    replyAnalysis.detail?.key === `reply-detail:${heatmapMove.id}`
      ? replyAnalysis.detail
      : undefined;
  const heatmapResult = heatmapDetail?.result ?? originalHeatmap;
  function openHeatmap(move: Move) {
    if (resultSet === null) return;
    const detail =
      replyAnalysis.detail?.key === `reply-detail:${move.id}`
        ? replyAnalysis.detail
        : undefined;
    const result = detail?.result ?? replyAnalysis.results?.[move.id];
    if (result?.kind !== "distribution") return;
    setHeatmap({ id: move.id, searchId: resultSet.searchId });
    if (!result.heatmap)
      replyAnalysis.requestDetail(move, {
        kind: "reply-detail",
        samples:
          result.count >= REPLY_REFINED_SAMPLES
            ? REPLY_REFINED_SAMPLES
            : REPLY_SAMPLES,
        captureHeatmap: true,
      });
  }
  const replyDeltas = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(replyAnalysis.results ?? {}).flatMap(([id, reply]) =>
          reply?.difference == null ? [] : [[id, reply.difference]],
        ),
      ),
    [replyAnalysis.results],
  );
  const shortlistReplies = replyAnalysis.pending
    ? undefined
    : replyAnalysis.results;
  const [shortlistResult, setShortlistResult] = useState<{
    searchId: number;
    entries: ShortlistEntry[];
  }>();
  const searchId = resultSet?.searchId;
  const [ordering, setOrdering] = useState<{
    searchId?: number;
    sort: MoveSort;
    reversed: boolean;
  }>();
  const activeOrder = ordering?.searchId === searchId ? ordering : undefined;
  const ranking =
    replyEnabled && !shortlistActive ? replyAnalysis.ranking : undefined;
  const waitingForEndgame = replyEnabled && replyAnalysis.estimatingEndgame;
  const endgameRanked = !!ranking?.checked;
  const sort =
    activeOrder &&
    (activeOrder.sort !== "endgame" || endgameRanked) &&
    (!endgame || (activeOrder.sort !== "bingo-draw" && activeOrder.sort !== "board-bingo"))
      ? activeOrder.sort
      : endgameRanked ? "endgame" : "score";
  const reversed =
    (activeOrder?.sort === sort && activeOrder.reversed) || false;
  function setSort(sort: MoveSort, reversed = false) {
    setOrdering({ searchId, sort, reversed });
  }
  const estimateNotice = replyAnalysis.endgameEstimateUnavailable
    ? "Endgame estimates unavailable."
    : endgameRanked && ranking.checked < totalMoves
      ? `Estimated ${ranking.checked.toLocaleString()} of ${totalMoves.toLocaleString()} moves`
      : "";
  const canShortlist = !!analysisGame && !busy && !error;
  useEffect(() => {
    if (!canShortlist || searchId === undefined) return;
    let current = true;
    const settle = (entries: ShortlistEntry[] = []) => {
      if (current) setShortlistResult({ searchId, entries });
    };
    // Board checks add odds to the selected rows without changing the shortlist.
    void fetchShortlist(searchId, {
      rackOdds,
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
    analysisGame && endgame
      ? scoreTotalsAtPosition(analysisGame)
      : undefined;
  const topScore = resultSet?.head[0]?.score ?? 0;
  const scoreTooltip = useMoveScoreTooltip(analysisGame);
  const [inspectedDefense, setInspectedDefense] = useState<{
    move: Move;
    risk: MoveDefense;
    key?: string;
  }>();
  const defenseDetail =
    inspectedDefense?.key === analysisKey ? inspectedDefense : undefined;
  const filteredShortlist = shortlist
    .map(({ move }) => move)
    .filter(
      (move) =>
        move.word.includes(filter.trim().toUpperCase()) &&
        (!requiredSquares || coversRequiredSquares(move, requiredSquares)),
    )
    .sort(
      moveComparator({ sort, reversed, rackOdds, boardOdds, replyDeltas }) ??
        (() => 0),
    );
  const page = useMoveResults(
    resultSet,
    {
      filter,
      requiredSquares,
      sort: shortlistActive || sort === "shortlist" ? "score" : sort,
      reversed: !shortlistActive && reversed,
      offset: shortlistActive
        ? 0
        : Math.max(0, Math.floor(scroll / moveRowHeight) - 5),
      rackOdds: sort === "bingo-draw" ? rackOdds : undefined,
      boardOdds: sort === "board-bingo" ? boardOdds : undefined,
      replyDeltas: sort === "reply" ? replyDeltas : undefined,
      endgameId: endgameRanked ? ranking.id : undefined,
    },
    fetchPage,
    !busy && !error && !waitingForEndgame,
  );
  const total = shortlistActive ? filteredShortlist.length : page.total;
  const start = shortlistActive ? 0 : page.start;
  const visible = shortlistActive ? filteredShortlist : page.visible;
  const pagePending = shortlistActive
    ? shortlistResult?.searchId !== searchId
    : page.pending;
  const bingoCount = requiredSquares
    ? shortlistActive
      ? filteredShortlist.filter((move) => isBingo(bingoRules, move.tiles.length)).length
      : page.bingoCount
    : resultSet?.bingoCount ?? 0;
  const formattedBingoCount = bingoCount.toLocaleString();
  const bingoLabel = `${formattedBingoCount} ${bingoCount === 1 ? "bingo" : "bingos"}`;
  useEffect(() => {
    setAnalyzing(false);
    setCandidates([]);
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
    scoreTooltip.close();
  }, [resultSet, filter, requiredSquares, sort, reversed, shortlistOnly]);
  useEffect(() => {
    setInspectedReply(undefined);
    if (requiredSquares)
      setCandidates((current) => current.filter((move) => coversRequiredSquares(move, requiredSquares)));
  }, [requiredSquares]);
  useEffect(() => {
    if (phoneLayout && !preview) setLocked(null);
  }, [phoneLayout, preview]);
  function togglePin(move: Move) {
    setLocked((current) => (current === move.id ? null : move.id));
    onPreview(move);
  }
  function column(
    label: string,
    value: MoveSort,
    title: string,
    disabled = false,
  ) {
    const active = sort === value;
    const descending = defaultSortDescending(value) !== reversed;
    return (
      <button
        className="result-column-sort"
        type="button"
        onClick={() => setSort(value, active && !reversed)}
        aria-label={`Sort by ${title}`}
        aria-pressed={active}
        title={
          active
            ? `${title} (${descending ? "descending" : "ascending"})`
            : title
        }
        disabled={disabled}
      >
        {label}
        {active &&
          (descending ? (
            <ChevronDown size={9} aria-hidden="true" />
          ) : (
            <ChevronUp size={9} aria-hidden="true" />
          ))}
      </button>
    );
  }
  const hasBingoControls = !!(analysisGame && onBoardOdds && onCancelBoardOdds);
  const showFilters = !!resultSet && !!(totalMoves || requiredSquares) && !busy && !error;
  const viewPicker = analysisGame && (
    <div
      className="result-view-picker"
      role="group"
      aria-label="Move list view"
    >
      <button
        type="button"
        aria-pressed={!shortlistOnly}
        onClick={() => {
          setShortlistOnly(false);
          setSort("score");
        }}
      >
        All moves
      </button>
      <button
        type="button"
        aria-pressed={shortlistOnly}
        onClick={() => {
          setShortlistOnly(true);
          setSort("shortlist");
        }}
      >
        Shortlist <span>{requiredSquares ? filteredShortlist.length : shortlist.length}</span>
      </button>
    </div>
  );
  const searchField = (
    <div
      className="search-input"
      hidden={collapsibleSearch && !searchOpen && !filter}
    >
      <Search size={16} />
      <input
        id={filterInputId}
        ref={searchInput}
        aria-label="Filter moves"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Find a word…"
        onKeyDown={(event) => {
          if (collapsibleSearch && event.key === "Escape") {
            event.preventDefault();
            closeSearch();
          }
        }}
      />
    </div>
  );
  const searchToggle = (
    <button
      className="icon-button move-search-toggle"
      type="button"
      aria-label="Search possible moves"
      aria-expanded={searchOpen || !!filter}
      aria-controls={filterInputId}
      title="Search possible moves"
      ref={searchButton}
      onClick={() => {
        if (searchOpen || filter) closeSearch();
        else setSearchOpen(true);
      }}
    >
      <Search size={16} aria-hidden="true" />
    </button>
  );
  return (
    <section
      aria-label="Possible moves"
      className={`results-panel panel ${!endgame && (analysisGame || rackOdds) ? "with-bingo-odds" : ""}${reserveReplySpace ? " with-reply-preview" : ""}${analysisGame && (replyEnabled || defense) ? " with-reply-column" : ""}${endgameRanked ? " with-endgame-estimates" : ""}`}
    >
      <header
        className={`results-title${exchangeAction ? " has-exchange-advice" : ""}`}
      >
        <div className="heading-with-icon">
          <CalculationIndicator
            active={
              calculating ||
              localCalculation ||
              replyAnalysis.pending ||
              !!replyAnalysis.detail?.pending
            }
          />
          <h2>
            {endgame && !replyAnalysis.invalid
              ? "Possible moves - Endgame"
              : "Possible moves"}
          </h2>
        </div>
        {resultSet && (
          <div className="result-counts">
            {bingoCount > 0 && (
              <span
                className="count-badge result-bingo-count"
                role="img"
                aria-label={bingoLabel}
                title={bingoLabel}
              >
                <Trophy size={11} aria-hidden="true" />
                {formattedBingoCount}
              </span>
            )}
            <span className="count-badge" title={requiredSquares ? "Moves covering the selected squares" : undefined}>
              {requiredSquares && pagePending ? "…" : (requiredSquares ? total : totalMoves).toLocaleString()}
            </span>
          </div>
        )}
        {exchangeAction}
        {analysisGame && !!totalMoves && !busy && !error && (
          <button
            type="button"
            className="button secondary analysis-toggle"
            aria-expanded={analyzing}
            disabled={
              !analyzing &&
              (waitingForEndgame ||
                !total ||
                pagePending ||
                (!shortlistActive && page.unavailable))
            }
            onClick={() => {
              if (!analyzing)
                setCandidates(
                  shortlistActive
                    ? filteredShortlist.slice(0, ANALYSIS_LIMIT)
                    : [preview ?? page.head[0]],
                );
              setLocked(null);
              onPreview(null);
              setAnalyzing(!analyzing);
            }}
          >
            <ChartNoAxesCombined size={15} aria-hidden="true" />
            <span>{analyzing ? "Close analysis" : "Analyze"}</span>
          </button>
        )}
      </header>
      {showFilters && (!collapsibleSearch || !hasBingoControls || !totalMoves) && (
        <div className="result-filters">
          {viewPicker}
          {searchField}
          {squareFilterControl}
          {collapsibleSearch && searchToggle}
        </div>
      )}
      {!busy &&
        !error &&
        resultSet &&
        !!totalMoves &&
        analysisGame &&
        onBoardOdds &&
        onCancelBoardOdds && (
          <BingoOddsControls
            key={`bingo-odds:${analysisKey}`}
            game={analysisGame}
            searchId={resultSet.searchId}
            bagSize={replyAnalysis.bagSize}
            minimumBag={replyAnalysis.minimumBag}
            repliesPending={replyAnalysis.pending}
            invalid={replyAnalysis.invalid}
            moves={resultSet.head}
            manualMoves={
              phoneLayout
                ? undefined
                : shortlistActive
                  ? filteredShortlist
                  : page.head
            }
            settings={
              replyEnabled && <ReplySettings analysis={replyAnalysis} />
            }
            toolbarStart={collapsibleSearch && viewPicker}
            toolbarEnd={collapsibleSearch && <>{squareFilterControl}{searchToggle}</>}
            searchField={collapsibleSearch && searchField}
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
          key={`move-analysis:${analysisKey}`}
          game={analysisGame}
          candidates={candidates}
          onRemove={toggleCandidate}
          endgameSettings={replyAnalysis}
        />
      )}
      {busy ? (
        <div className="results-empty">
          <LoaderCircle className="spin" size={30} />
          <h3>{busy}</h3>
          <p>Your board stays ready while we look.</p>
          <button className="button secondary" onClick={onCancelSearch}>
            Cancel search
          </button>
        </div>
      ) : error ? (
        <div className="results-empty">
          <h3>Couldn’t finish this search</h3>
          <p className="error" role="alert">
            {error}
          </p>
          <button className="button secondary" onClick={() => onSolve()}>
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
            className="button primary"
            onClick={() => onSolve()}
            disabled={!hasRack}
          >
            <Sparkles size={16} />
            Find moves
          </button>
        </div>
      ) : waitingForEndgame ? (
        <div className="results-empty">
          <LoaderCircle className="spin" size={24} aria-hidden="true" />
          <h3 role="status">Estimating endgames…</h3>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              replyAnalysis.skipEndgameEstimate();
              setShortlistOnly(false);
              setSort("score");
            }}
          >
            Skip endgame analysis
          </button>
        </div>
      ) : !shortlistActive && page.unavailable ? (
        <div className="results-empty">
          <p role="status">
            Move results are unavailable. Find moves again to reload them.
          </p>
          <button className="button primary" onClick={() => onSolve(true)}>
            Find moves
          </button>
        </div>
      ) : pagePending ? (
        <div className="results-empty" role="status">
          <LoaderCircle className="spin" size={24} />
          <p>Loading move list…</p>
        </div>
      ) : !total ? (
        <div className="results-empty">
          <Search size={30} />
          <h3>{totalMoves ? "No matching words" : "No legal moves found"}</h3>
          <p>
            {!totalMoves
              ? "Check your rack and board, or try a different dictionary."
              : requiredSquares
                ? "Change the selected squares or clear the square filter."
                : filter
                  ? "Try a different word or clear the filter."
                  : "Try the All moves view."}
          </p>
        </div>
      ) : (
        <>
          {replyEnabled && (replyAnalysis.invalid || replyAnalysis.error) && (
            <div className="reply-controls" role="status">
              {replyAnalysis.error ?? "Check tile counts for reply analysis."}
            </div>
          )}
          {replyEnabled && estimateNotice && (
            <div className="reply-controls" role="status">{estimateNotice}</div>
          )}
          {replyEnabled && analysisGame && !onBoardOdds && (
            <div className="reply-controls">
              <ReplySettings analysis={replyAnalysis} />
            </div>
          )}
          <div className="result-columns">
            <div className="result-word-heading">
              {column("WORD", "word", "word")}
            </div>
            <div className="result-points-heading">
              {column("PTS", "score", "points")}
            </div>
            {analysisGame && (replyEnabled || defense) && (
              <div className="result-reply-heading">
                {endgameRanked
                  ? column("EST. SWING", "endgame", "estimated endgame swing")
                  : column(
                      "Δ REPLY",
                      "reply",
                      "reply change",
                      !Object.keys(replyDeltas).length,
                    )}
              </div>
            )}
            <div className="result-leave-heading">
              {!endgame && (analysisGame || rackOdds || boardOdds?.checked) ? (
                <details
                  className="result-leave-sort"
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget))
                      event.currentTarget.open = false;
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape" || !event.currentTarget.open)
                      return;
                    event.preventDefault();
                    event.currentTarget.open = false;
                    event.currentTarget.querySelector("summary")?.focus();
                  }}
                >
                  <summary
                    className="result-column-sort"
                    aria-label="Sort by leave or bingo odds"
                  >
                    {sort === "bingo-draw"
                      ? "DRAW %"
                      : sort === "board-bingo"
                        ? "AFTER %"
                        : "LEAVE"}
                    <ChevronDown size={9} aria-hidden="true" />
                  </summary>
                  <div
                    className="result-leave-sort-options"
                    onClick={(event) => {
                      const menu = event.currentTarget.closest("details");
                      if (
                        !(event.target instanceof Element) ||
                        !event.target.closest("button") ||
                        !menu
                      )
                        return;
                      menu.open = false;
                      menu.querySelector("summary")?.focus();
                    }}
                  >
                    {column("Rack leave", "leave", "rack leave")}
                    {column(
                      "Bingo draw %",
                      "bingo-draw",
                      "bingo draw odds",
                      !rackOdds || !!rackOdds.error,
                    )}
                    {column(
                      "Bingo after play %",
                      "board-bingo",
                      "bingo odds after play",
                      !boardOdds?.checked,
                    )}
                  </div>
                </details>
              ) : (
                column("LEAVE", "leave", "rack leave")
              )}
            </div>
            <div className="result-position-heading">
              {column("POS", "position", "position")}
            </div>
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
                const bingo = isBingo(bingoRules, m.tiles.length);
                const bingoBonus = bingoPoints(bingoRules, m.tiles.length);
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
                const estimate = page.endgame?.[m.id];
                const finalMargin = estimate && replyScores
                  ? replyScores.you - replyScores.opponent + estimate.spread
                  : undefined;
                const threat = estimate?.reply?.goesOut
                  ? estimate.reply
                  : undefined;
                const threatBingo =
                  !!threat &&
                  isBingo(bingoRules, replyAnalysis.opponentRack.length);
                const metricId =
                  (reply || endgameRanked) && analysisGame
                    ? `${replyMetricId}-${start + offset}`
                    : undefined;
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
                    className="result-slot"
                    key={m.id}
                    style={{ top: (start + offset) * moveRowHeight }}
                    onPointerEnter={(e) => {
                      if (locked || !canHoverWithMouse(e.pointerType)) return;
                      onPreview(m, analyzing);
                      if (!analyzing && searchId !== undefined && reply)
                        setInspectedReply({ id: m.id, searchId });
                    }}
                    onPointerLeave={(e) => {
                      if (!locked && canHoverWithMouse(e.pointerType))
                        onPreview(null);
                    }}
                  >
                    <button
                      className={`result-row${bingo ? " bingo" : ""}${preview?.id === m.id || selected ? " active" : ""}${locked === m.id ? " pinned" : ""}`}
                      aria-pressed={analyzing ? selected : undefined}
                      aria-describedby={metricId}
                      disabled={
                        analyzing &&
                        !selected &&
                        candidates.length >= ANALYSIS_LIMIT
                      }
                      aria-label={`${m.word}, ${m.score} points, ${coordinate(m.row * size + m.col, size)} ${m.direction}, ${m.tiles.length} tiles${bingo ? `, bingo, ${bingoBonus}-point bonus included` : ""}${rackPercent ? `, bingo draw ${rackPercent}` : ""}${boardPercent ? `, bingo after your play ${boardPercent}` : ""}${sacrifice ? `, ${sacrifice} below top score` : ""}${short ? `, ${short.reason}${short.detail ? `, ${short.detail}` : ""}` : ""}`}
                      onPointerDown={(e) => {
                        pointer.current = e.pointerType;
                      }}
                      onFocus={() => {
                        if (!locked) onPreview(m, analyzing);
                      }}
                      onContextMenu={(event) => {
                        if (analyzing) return;
                        event.preventDefault();
                        togglePin(m);
                      }}
                      onKeyDown={(event) => {
                        if (analyzing || event.key.toLowerCase() !== "p")
                          return;
                        event.preventDefault();
                        if (!event.repeat) togglePin(m);
                      }}
                      onClick={(e) => {
                        if (analyzing) {
                          toggleCandidate(m);
                          onPreview(m, true);
                          return;
                        }
                        if (
                          (e.detail > 0 && canHoverWithMouse(pointer.current)) ||
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
                        <small
                          className="result-word-detail"
                          title={short?.detail}
                        >
                          {bingo && (
                            <BingoBadge
                              full
                              title={`${m.tiles.length === bingoRules.rackSize ? "All " : ""}${m.tiles.length} tiles · +${bingoBonus} bonus included in score`}
                            />
                          )}
                          <span className="result-word-note">
                            {short
                              ? `${short.reason}${short.detail ? ` · ${short.detail}` : ""}`
                              : `${m.tiles.length} tile${m.tiles.length !== 1 ? "s" : ""}`}
                            {!short && m.blanks
                              ? ` · ${m.blanks} blank${m.blanks > 1 ? "s" : ""}`
                              : ""}
                            {!short && m.crosses.length
                              ? ` · +${m.crosses.length} cross`
                              : ""}
                          </span>
                        </small>
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
                      {endgameRanked ? (
                        <span className="result-reply-metric" id={metricId}>
                          {estimate ? (
                            <span
                              className="reply-cell endgame-estimate"
                              title={`${estimate.exact ? "Exact" : "Estimated"} endgame swing ${signedPoints(estimate.spread)}${threat ? `. Opponent can go out with ${threat.word} for ${threat.score} points.` : ""}`}
                            >
                              <strong
                                className={
                                  scoreTone(estimate.spread) ?? "reply-neutral"
                                }
                              >
                                {!estimate.exact && "≈"}
                                {signedPoints(estimate.spread)}
                                {threatBingo && finalMargin === undefined && (
                                  <BingoBadge className="endgame-threat-badge" />
                                )}
                              </strong>
                              {finalMargin !== undefined ? (
                                <small
                                  className={scoreTone(finalMargin) ?? "reply-neutral"}
                                  title={estimate.exact ? "Final margin" : "Estimated final margin"}
                                >
                                  {finalMarginLabel(finalMargin)}
                                </small>
                              ) : threat && (
                                <small
                                  className={
                                    threatBingo ? "bingo-move-word" : "value-bad"
                                  }
                                >
                                  {threat.word} out
                                </small>
                              )}
                            </span>
                          ) : (
                            <span
                              className="reply-neutral"
                              title="Endgame swing unavailable"
                            >
                              —
                            </span>
                          )}
                        </span>
                      ) : (
                        reply &&
                        analysisGame && (
                          <span className="result-reply-metric" id={metricId}>
                            <ReplyCell
                              move={m}
                              result={reply}
                              scores={replyScores}
                            />
                          </span>
                        )
                      )}
                      <span className="result-leave">
                        <span>{m.leave || "—"}</span>
                        {!endgame && (analysisGame || rackOdds) && (
                          <strong
                            className="result-draw-odds"
                            title="Chance the refilled rack spells a full-length word"
                          >
                            <span className="result-odds-label">Draw</span>{" "}
                            {rackPercent ?? (rackOddsPending ? "…" : "—")}
                          </strong>
                        )}
                        {boardChance && boardPercent && (
                          <span
                            className="result-board-odds"
                            title={
                              boardChance.samples
                                ? `Chance of a legal bingo before the opponent replies · ${boardChance.samples} sampled refills`
                                : "Chance of a legal bingo before the opponent replies"
                            }
                          >
                            <span className="result-odds-label">After</span>{" "}
                            {boardPercent}
                          </span>
                        )}
                      </span>
                      <span className="result-coordinate">
                        {coordinate(m.row * size + m.col, size)}
                        {m.direction === "across" ? "→" : "↓"}
                      </span>
                    </button>
                    {analysisGame &&
                      scoreTooltip.trigger(
                        m,
                        `Score breakdown for ${m.word} at ${coordinate(m.row * size + m.col, size)} ${m.direction}`,
                      )}
                    {!endgameRanked && replyPending && (
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
                    {!endgameRanked && !reply && !replyPending && risk && (
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
            <span className="hover-hint">
              Hover to preview · right-click or P to pin/unpin · click to play
            </span>
            <span className="tap-hint">
              Tap to preview · tap again to play
            </span>
          </>
        )}
        {replyAnalysis.pending ? (
          <span title="Checking opponent replies">
            Replies {Object.keys(replyAnalysis.results ?? {}).length}/
            {replyAnalysis.target.length}
          </span>
        ) : !endgame && boardOddsProgress ? (
          <span role="status" title="Checking bingo odds after your play">
            Bingo {boardOddsProgress.checked}/{boardOddsProgress.total}
          </span>
        ) : !endgame && rackOddsPending ? (
          <span role="status">Calculating bingo draws…</span>
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
      {analysisGame && replyMove && replyDetail && (
        <section
          className={`inline-reply${compact && replyDetail.kind === "distribution" ? " compact-reply" : ""}`}
          aria-label={`Reply after ${replyMove.word}`}
        >
          <h3>
            Reply after <MoveWord move={replyMove} rules={analysisGame.template} />
          </h3>
          <ReplyPreview
            game={analysisGame}
            move={replyMove}
            result={replyDetail}
            defense={defense?.[replyMove.id]}
            analysis={replyAnalysis}
            onHeatmap={() => openHeatmap(replyMove)}
          />
        </section>
      )}
      {scoreTooltip.popup}
      {analysisGame && defenseDetail && (
        <PremiumDefense
          game={analysisGame}
          move={defenseDetail.move}
          defense={defense?.[defenseDetail.move.id] ?? defenseDetail.risk}
          onClose={() => setInspectedDefense(undefined)}
        />
      )}
      {analysisGame &&
        heatmapMove &&
        heatmapResult?.kind === "distribution" &&
        replyAnalysis.reference && (
          <ReplyHeatmapDialog
            game={analysisGame}
            move={heatmapMove}
            result={heatmapResult}
            reference={replyAnalysis.reference}
            pending={heatmapDetail?.pending}
            error={heatmapDetail?.error}
            onClose={() => setHeatmap(undefined)}
            onRetry={() => openHeatmap(heatmapMove)}
          />
        )}
    </section>
  );
}
