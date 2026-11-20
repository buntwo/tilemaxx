import { BINGO_STYLES, BINGO_STYLE_LABELS, isBingoStyle } from "../../shared/bingo-styles";
import { useBingoHunter } from "../useBingoHunter";
import type { HunterProgress } from "../parallel-bingo-hunter";
import type { RunBingoHunter } from "../useSolver";
import type { MoveStyle } from "../../shared/move-results";
import type { MoveListNavigation, MoveListView } from "../useMoveListNavigation";
import { moveLocation } from "../../shared/notation";
import {
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useEffect,
  useEffectEvent,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  Search,
  Sparkles,
  Swords,
  X,
  LoaderCircle,
  Trophy,
  ChartNoAxesCombined,
  Check,
} from "lucide-react";
import {
  bingoPoints,
  isBingo,
  type BingoRules,
  type Game,
  type Move,
  type Player,
} from "../../shared/model";
import {
  REPLY_REFINED_SAMPLES,
  REPLY_SAMPLES,
} from "../../shared/reply-analysis";
import { ANALYSIS_LIMIT } from "../../shared/move-analysis";
import { PLAYER_PROFILES, PLAYER_PROFILE_LABELS, profileWordHash } from "../../shared/player-profiles";
import { endgameAfterRefill } from "../../shared/endgame-refill";
import { rackLetters } from "../../shared/rack-entry";
import { scoreTotalsAtPosition } from "../../shared/game-scoring";
import { type BoardOddsResult, type RackOdds } from "../../shared/bingo-odds";
import { finalMarginLabel, scoreTone, signedPoints } from "../score-tone";
import { endgameLength } from "../endgame-line-format";
import { canHoverWithMouse } from "../move-preview";
import { definitionLanguageForRules } from "../../shared/definitions";
import { useDefinitionTooltip } from "./DefinitionTooltip";
import { useDefinitionHold } from "../useDefinitionHold";
import MoveAnalysis from "./MoveAnalysis";
import HighCeilingSetups from "./HighCeilingSetups";
import EmptyMoveTiles from "./EmptyMoveTiles";
import MoveWord, { BingoBadge, MoveLetters } from "./MoveWord";
import BingoOddsControls from "./BingoOddsControls";
import CalculationIndicator from "./CalculationIndicator";
import OptimalReplyDetails from "./OptimalReplyDetails";
import OpponentEndgameResults, {
  OpponentEndgamePending,
} from "./OpponentEndgameResults";
import { ComputeWorkerLimit } from "./ComputeWorkerLimit";
import { computeWorkerLimit } from "../compute-workers";
import { useOpponentEndgame } from "../useOpponentEndgame";
import { useGameCalculating } from "./GameCalculations";
import { formatUtility, useMoveScoreTooltip } from "./MoveScoreTooltip";
import PremiumDefense, {
  createPremiumReplyChance,
  PremiumRiskButton,
} from "./PremiumDefense";
import type { DefenseResults, MoveDefense } from "../../shared/premium-defense";
import type { useReplyAnalysis } from "../useReplyAnalysis";
import type { BoardOddsProgress } from "../useSolver";
import type { MoveTiming } from "../move-timing";
import MoveTimingButton from "./MoveTimingButton";
import type { ShortlistEntry } from "../../shared/move-shortlist";
import {
  coversRequiredSquares,
  defaultSortDescending,
  moveComparator,
  replyAdjustedPoints,
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
  ReplyHistogramStatus,
  ReplyLimitNotice,
  ReplyPreview,
  ReplySettings,
} from "./ReplyAnalysis";

type MoveListOrder = { sort: MoveSort; reversed: boolean };

const hunterStageLabels: Record<HunterProgress["phase"], string> = {
  exact: "Checking exact tile deals",
  screen: "Screening bingo setups",
  "screen-replies": "Screening opponent replies",
  sample: "Simulating replies",
  "follow-up": "Checking follow-up plays",
  checkpoint: "Comparing bingo finalists",
  refine: "Refining bingo estimates",
  "ceiling-discovery": "Finding high-scoring bingo setups",
  "ceiling-replies": "Checking replies to high-scoring setups",
};

function formatOdds(chance: number, exact: boolean) {
  const value =
    chance > 0 && chance < 0.005
      ? "<1%"
      : chance < 1 && chance > 0.995
        ? ">99%"
        : `${Math.round(chance * 100)}%`;
  return exact ? value : `≈${value}`;
}

function ResultSortMenu({
  label,
  accessibleLabel,
  sortDirection,
  children,
}: {
  label: string;
  accessibleLabel: string;
  sortDirection?: "ascending" | "descending";
  children: ReactNode;
}) {
  const root = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function dismissOutside(event: PointerEvent) {
      const menu = root.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target))
        menu.open = false;
    }
    document.addEventListener("pointerdown", dismissOutside, true);
    return () => document.removeEventListener("pointerdown", dismissOutside, true);
  }, []);

  function closeAndFocus() {
    if (!root.current) return;
    root.current.open = false;
    root.current.querySelector("summary")?.focus({ preventScroll: true });
  }

  return (
    <details
      className="result-sort-menu"
      ref={root}
      onBlur={(event) => {
        // A pointer click can blur the summary without focusing its option.
        // Outside pointer presses are handled separately.
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget))
          event.currentTarget.open = false;
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !event.currentTarget.open) return;
        event.preventDefault();
        closeAndFocus();
      }}
    >
      <summary
        className="result-column-sort"
        aria-label={accessibleLabel}
        aria-description={sortDirection && `Sorted ${sortDirection}`}
      >
        {label}
        {sortDirection === "ascending" ? (
          <ChevronUp size={9} aria-hidden="true" />
        ) : (
          <ChevronDown size={9} aria-hidden="true" />
        )}
      </summary>
      <div
        className="result-sort-options"
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("button"))
            closeAndFocus();
        }}
      >
        {children}
      </div>
    </details>
  );
}

export default function Results({
  results: resultSet,
  findMovesRequest,
  exchangeAction,
  playingStyle,
  onPlayingStyleChange,
  navigation,
  compact = false,
  collapsibleSearch = compact,
  fetchPage,
  fetchShortlist,
  runBingoHunter,
  busy,
  calculating = false,
  timing,
  onTimingComplete,
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
  onCloseResults,
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
  findMovesRequest?: number;
  exchangeAction?: ReactElement | false;
  playingStyle?: MoveStyle;
  onPlayingStyleChange?: (style: MoveStyle | undefined) => void;
  navigation: MoveListNavigation;
  compact?: boolean;
  collapsibleSearch?: boolean;
  fetchPage: FetchMovePage;
  runBingoHunter?: RunBingoHunter;
  fetchShortlist: (
    searchId: number,
    options: ShortlistOptions,
  ) => Promise<ShortlistEntry[] | undefined>;
  busy: string;
  calculating?: boolean;
  timing?: MoveTiming;
  onTimingComplete?: (
    stoppedAt: number,
    analysis: Omit<MoveTiming, "total" | "solver">,
  ) => void;
  error: string;
  size: number;
  bingoRules: BingoRules;
  preview: Move | null;
  requiredSquares?: RequiredSquares;
  squareFilterControl?: ReactElement;
  onPreview: (m: Move | null, analysis?: boolean, player?: Player) => void;
  phoneLayout?: boolean;
  onPlay: (m: Move) => void;
  onSolve: (reload?: boolean) => void;
  onCancelSearch: () => void;
  onCloseResults: () => void;
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
    [locked, setLocked] = useState<string | null>(null);
  useEffect(() => setFilter(""), [findMovesRequest]);
  const localCalculation = useGameCalculating();
  const workerLimit = useContext(ComputeWorkerLimit) ?? computeWorkerLimit();
  const { bagSize, bagConfirmed, invalid, opponentRack, scorelessTurns } =
    replyAnalysis;
  const opponentRackSize = replyAnalysis.unseen - bagSize;
  const premiumReplyChance = useMemo(
    () => createPremiumReplyChance(replyAnalysis.unseenPool, opponentRackSize),
    [replyAnalysis.unseenPool, opponentRackSize],
  );
  const opponentPosition = useMemo(() => {
    if (!analysisGame || busy || bagSize !== 0 || invalid) return;
    // A recorded refill can establish a prior scoreless play when settings are unset.
    const refill = bagConfirmed ? undefined : endgameAfterRefill(analysisGame);
    return {
      opponentRack,
      scorelessTurns: refill?.scorelessTurns ?? scorelessTurns,
    };
  }, [analysisGame, busy, bagSize, bagConfirmed, invalid, opponentRack, scorelessTurns]);
  const emptyRackEndgame =
    !!analysisGame &&
    !rackLetters(analysisGame.rack) &&
    (!replyAnalysis.crossplay || !replyAnalysis.opponentHasFinalTurn);
  const emptyRackMessage = "Your rack is empty. There’s no opponent endgame to solve.";
  const opponentKey =
    opponentPosition && !emptyRackEndgame && analysisKey
      ? JSON.stringify([
          analysisKey,
          opponentPosition.opponentRack,
          opponentPosition.scorelessTurns,
        ])
      : undefined;
  const opponent = useOpponentEndgame(opponentKey, workerLimit);
  const opponentSearch = opponent.current;
  function startOpponentEndgame() {
    if (!analysisGame || !opponentPosition || emptyRackEndgame) return;
    const { board, rack, template, dictionaryId } = analysisGame;
    setLocked(null);
    setInspectedReply(undefined);
    setAnalyzing(false);
    onPreview(null);
    opponent.start({ board, rack, template, ...opponentPosition }, dictionaryId);
  }

  function closeOpponentEndgame() {
    onPreview(null);
    opponent.close();
  }
  const scroller = useRef<HTMLDivElement>(null),
    pinnedRow = useRef<HTMLDivElement>(null),
    pointer = useRef("mouse");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const filterInputId = useId();
  const findMovesButton = useRef<HTMLButtonElement>(null);
  const focusFindMoves = useRef(false);
  useEffect(() => {
    if (focusFindMoves.current && !resultSet && !busy && !error) {
      focusFindMoves.current = false;
      findMovesButton.current?.focus({ preventScroll: true });
    }
  }, [resultSet, busy, error]);
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
  const searchId = resultSet?.searchId;
  const selectedProfile = resultSet ? playingStyle : undefined;
  const { view, returnView } = navigation;
  const shortlistActive = view === "shortlist";
  const profile = view === "style" ? selectedProfile : undefined;
  const bingoStyle = isBingoStyle(selectedProfile) ? selectedProfile : undefined;
  const hunterSelected = !!bingoStyle && view === "style";
  const hunterLabel = bingoStyle && BINGO_STYLE_LABELS[bingoStyle];
  const hunterKey = bingoStyle && resultSet?.total && !busy && !error && !invalid
    ? JSON.stringify([bingoStyle, analysisKey, resultSet.searchId, bagSize, scorelessTurns, replyAnalysis.opponentHasFinalTurn])
    : undefined;
  const hunter = useBingoHunter(hunterKey, runBingoHunter, {
    style: bingoStyle,
    gameId: analysisGame?.id,
    searchId: resultSet?.searchId,
    findMovesRequest,
    bagSize,
    scorelessTurns,
    opponentHasFinalTurn: replyAnalysis.opponentHasFinalTurn,
    workerLimit,
  });
  const hunterResult = hunterSelected ? hunter.current?.result : undefined;
  const hunterProgress = hunter.current?.progress;
  const hunterPending = hunter.current?.pending;
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
    move: Move;
    searchId: number;
    histogramSelected?: true;
  }>();
  const [followHistogram, setFollowHistogram] = useState<{ moveId: string; searchId: number }>();
  const [heatmap, setHeatmap] = useState<{ move: Move; searchId: number }>();
  const replyInspection =
    inspectedReply?.searchId === resultSet?.searchId ? inspectedReply : undefined;
  const histogramSelection = replyInspection?.histogramSelected ? replyInspection.move : undefined;
  const replyMove =
    (analyzing ? null : histogramSelection ?? preview) ?? replyInspection?.move;
  const replyDetail = replyMove && replyAnalysis.results?.[replyMove.id];
  const requestedHistogram = replyMove &&
    replyAnalysis.detail?.key === `reply-histogram:${replyMove.id}`
      ? replyAnalysis.detail
      : undefined;
  const replyLine = replyMove && replyAnalysis.cachedEndgame(replyMove.id);
  const replyLength = replyLine && endgameLength(replyLine);
  const heatmapMove =
    heatmap?.searchId === resultSet?.searchId
      ? heatmap?.move
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
    setHeatmap({ move, searchId: resultSet.searchId });
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
  const showAdjustedPoints = !!analysisGame && replyEnabled && !endgame && !replyAnalysis.invalid;
  const canSortAdjusted =
    showAdjustedPoints && !replyAnalysis.pending && Object.keys(replyDeltas).length > 0;
  const shortlistReplies = replyAnalysis.pending
    ? undefined
    : replyAnalysis.results;
  const [shortlistResult, setShortlistResult] = useState<{
    searchId: number;
    entries: ShortlistEntry[];
  }>();
  const [ordering, setOrdering] = useState<{
    searchId?: number;
    views: Partial<Record<MoveListView, MoveListOrder>>;
  }>();
  const activeOrder = ordering?.searchId === searchId ? ordering?.views[view] : undefined;
  const ranking =
    replyEnabled && !shortlistActive ? replyAnalysis.ranking : undefined;
  const waitingForEndgame = replyEnabled && !profile && replyAnalysis.estimatingEndgame;
  const endgameProgress = replyEnabled ? replyAnalysis.endgameProgress : undefined;
  const endgameRanked = !!ranking?.checked;
  const showEndgameSwing =
    endgameRanked || (replyEnabled && !shortlistActive && !!replyAnalysis.exactEndgameSpreads);
  const sort = profile && !activeOrder ? "playing-style" :
    activeOrder &&
    (activeOrder.sort !== "endgame" || showEndgameSwing) &&
    (activeOrder.sort !== "reply-adjusted" || canSortAdjusted) &&
    (activeOrder.sort !== "playing-style" || profile) &&
    (!endgame || (activeOrder.sort !== "bingo-draw" && activeOrder.sort !== "board-bingo"))
      ? activeOrder.sort
      : showEndgameSwing
        ? "endgame"
        : canSortAdjusted && !shortlistActive
          ? "reply-adjusted"
          : shortlistActive ? "shortlist" : "score";
  const reversed =
    (activeOrder?.sort === sort && activeOrder.reversed) || false;
  const [scrollPositions, setScrollPositions] = useState<
    Partial<Record<MoveListView, MoveListOrder & { top: number }>>
  >({});
  const position = scrollPositions[view];
  const scroll = position?.sort === sort && position.reversed === reversed ? position.top : 0;
  const pointsSorted = sort === "score" || sort === "reply-adjusted" || sort === "playing-style";
  function setSort(sort: MoveSort, reversed = false, target = view) {
    setOrdering((current) => ({
      searchId,
      views: {
        ...(current?.searchId === searchId && current?.views),
        [target]: { sort, reversed },
      },
    }));
  }
  function toggleView(target: "all" | "shortlist") {
    if (navigation.toggle(target)) onPreview(null);
  }
  function checkReplyHistogram(move: Move) {
    if (!resultSet || !replyAnalysis.canRequestHistogram) return;
    // A histogram can make adjusted sorting available for the first time.
    if (!activeOrder && !shortlistActive) setSort(sort, reversed);
    setFollowHistogram(!shortlistActive && (sort === "reply-adjusted" || sort === "reply")
      ? { moveId: move.id, searchId: resultSet.searchId }
      : undefined);
    setLocked(null);
    onPreview(null);
    setInspectedReply({ move, searchId: resultSet.searchId, histogramSelected: true });
    replyAnalysis.requestDetail(move, { kind: "reply-histogram" });
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
  const topScore = resultSet ? resultSet.topScore : null;
  const rackMarked = !!(
    analysisGame?.excludedRackSlots?.length ||
    analysisGame?.requiredRackSlots?.length
  );
  const scoreDeltaHint =
    topScore === null
      ? "Best score with rack marks cleared exceeded the search limit"
      : rackMarked
        ? `Best score with rack marks cleared is ${topScore} points`
        : undefined;
  const headScoreRanks = useMemo(
    () => Object.fromEntries(resultSet?.head.map(({ id }, index) => [id, index + 1]) ?? []),
    [resultSet],
  );
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
  const locateMoveId =
    followHistogram &&
    histogramSelection?.id === followHistogram.moveId &&
    followHistogram.searchId === searchId &&
    !replyAnalysis.pending &&
    replyAnalysis.detail?.key === `reply-histogram:${followHistogram.moveId}` &&
    !replyAnalysis.detail.pending &&
    replyAnalysis.detail.result?.kind === "distribution"
      ? followHistogram.moveId
      : undefined;
  const unstyledSquarePage = useMoveResults(
    profile && requiredSquares ? resultSet : null,
    { filter, requiredSquares, sort: "score", offset: 0 },
    fetchPage,
    !busy && !error,
  );
  const page = useMoveResults(
    resultSet,
    {
      filter,
      profile,
      profileBagSize: profile ? bagSize : undefined,
      profileScorelessTurns: profile === "strong" && bagSize === 0 ? scorelessTurns : undefined,
      profileSeed: hunterSelected ? hunterResult?.id :
        profile && analysisGame ? profileWordHash(analysisGame.id) : undefined,
      requiredSquares,
      sort: shortlistActive || sort === "shortlist" ? "score" : sort,
      reversed: !shortlistActive && reversed,
      offset: shortlistActive
        ? 0
        : Math.max(0, Math.floor(scroll / moveRowHeight) - 5),
      locateMoveId,
      rackOdds: sort === "bingo-draw" ? rackOdds : undefined,
      boardOdds: sort === "board-bingo" ? boardOdds : undefined,
      replyDeltas:
        sort === "reply" || sort === "reply-adjusted" ? replyDeltas : undefined,
      endgameId: !profile && endgameRanked ? ranking.id : undefined,
      exactEndgameSpreads: sort === "endgame" ? replyAnalysis.exactEndgameSpreads : undefined,
    },
    fetchPage,
    !busy && !error && !waitingForEndgame && (!hunterSelected || !!hunterResult),
  );
  const scoreTooltip = useMoveScoreTooltip(analysisGame, (move) => {
    const delta = replyDeltas[move.id];
    const adjusted = replyAdjustedPoints(move, delta);
    if (!showAdjustedPoints || delta === undefined || adjusted === undefined) return;
    return `${move.score} pts − (${signedPoints(delta, 1)} Δ Reply) = ${Number(adjusted.toFixed(1))} reply-adjusted pts`;
  }, (move) => {
    const utility = page.utilities?.[move.id];
    return profile && utility
      ? { profile, utility, checksDefense: profile !== "casual" && !hunterSelected && bagSize > 0 }
      : undefined;
  });
  const total = shortlistActive ? filteredShortlist.length : page.total;
  const exactCount = page.exactEndgameCount ?? 0;
  const endgameDivider = exactCount > 0 && exactCount < total ? exactCount : -1;
  const start = shortlistActive ? 0 : page.start;
  const visible = shortlistActive ? filteredShortlist : page.visible;
  const pagePending = shortlistActive
    ? shortlistResult?.searchId !== searchId
    : page.pending;
  // Style rankings can omit legal plays. Use the same counts as No style.
  const countPage = profile ? unstyledSquarePage : page;
  const bingoCount = !requiredSquares
    ? resultSet?.bingoCount ?? 0
    : shortlistActive
      ? filteredShortlist.filter((move) => isBingo(bingoRules, move.tiles.length)).length
      : countPage.bingoCount;
  const moveCount = !requiredSquares ? totalMoves : shortlistActive ? total : countPage.total;
  const moveCountPending = requiredSquares && (shortlistActive ? pagePending : countPage.pending);
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
  const showList = !busy && !error && !!resultSet &&
    !waitingForEndgame && (!hunterSelected || !!hunterResult?.checked) &&
    !(profile && page.error) && (shortlistActive || !page.unavailable) &&
    !pagePending && total > 0;
  const mouseDefinitions = showList && canHoverWithMouse("mouse");
  const definitionLanguage = showList && (phoneLayout || mouseDefinitions)
    ? definitionLanguageForRules(bingoRules.rules)
    : undefined;
  const definitionPosition = useMemo(
    () => ({}),
    [resultSet, filter, requiredSquares, sort, reversed, view, profile, analysisKey],
  );
  const touchDefinitions = phoneLayout && !!definitionLanguage;
  const definitionHold = useDefinitionHold(touchDefinitions, definitionPosition);
  const definitions = useDefinitionTooltip(definitionLanguage, definitionPosition, definitionHold.locked);
  const definitionMoveId = definitions.id && definitions.anchor?.dataset.moveId;
  useEffect(() => {
    setScrollPositions({});
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [resultSet, filter, requiredSquares, playingStyle]);
  const restoreScroll = useEffectEvent(() => {
    if (scroller.current) scroller.current.scrollTop = scroll;
  });
  useLayoutEffect(() => restoreScroll(), [view, sort, reversed, showList]);
  useEffect(() => {
    setLocked(null);
    setInspectedReply((current) => current?.histogramSelected ? undefined : current);
    setFollowHistogram(undefined);
    scoreTooltip.close();
  }, [resultSet, filter, requiredSquares, sort, reversed, view, profile]);
  useEffect(() => {
    const index = page.locatedIndex;
    const list = scroller.current;
    if (index === undefined || !list) return;
    setFollowHistogram(undefined);
    if (index < 0) return;
    const rowTop = index * moveRowHeight;
    if (
      rowTop >= list.scrollTop &&
      rowTop + moveRowHeight <= list.scrollTop + list.clientHeight
    ) return;
    list.scrollTo({
      top: Math.max(0, rowTop - (list.clientHeight - moveRowHeight) / 2),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [page.locatedIndex]);
  useEffect(() => {
    setInspectedReply(undefined);
    if (requiredSquares)
      setCandidates((current) => current.filter((move) => coversRequiredSquares(move, requiredSquares)));
  }, [requiredSquares]);
  useEffect(() => {
    if (!preview) setLocked(null);
  }, [preview]);
  useEffect(() => {
    if (!locked && !histogramSelection) return;
    function dismissPreview(event: MouseEvent) {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        pinnedRow.current?.contains(target) ||
        target.closest("[data-move-preview-action], .definition-sheet") ||
        (histogramSelection && (target === scroller.current || target.closest("dialog")))
      )
        return;
      setLocked(null);
      setInspectedReply(undefined);
      onPreview(null);
    }
    // A completed tap dismisses the preview. Starting a scroll does not.
    document.addEventListener("click", dismissPreview, true);
    return () => document.removeEventListener("click", dismissPreview, true);
  }, [locked, histogramSelection, onPreview]);
  function togglePin(move: Move) {
    if (histogramSelection) {
      setInspectedReply(undefined);
      setFollowHistogram(undefined);
      if (histogramSelection.id === move.id) {
        onPreview(null);
        return;
      }
    }
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
  const showFilters = !!resultSet && !!(totalMoves || requiredSquares || analysisGame) && !busy && !error;
  const hunterStatus = hunterPending && (
    <span role="status">
      {hunterProgress
        ? `${hunterProgress.stage}. ${hunterStageLabels[hunterProgress.phase]}`
        : `Starting ${hunterLabel}…`}
      {!!hunterProgress?.total && ` · ${hunterProgress.done}/${hunterProgress.total} moves`}
    </span>
  );
  const hunterAction = hunterPending ? (
    <button type="button" className="button secondary" onClick={hunter.cancel}>Cancel</button>
  ) : hunterResult?.canContinue ? (
    <button type="button" className="button secondary"
      onClick={() => hunter.start(hunter.current?.error ? undefined : hunterResult.id)}>
      {hunter.current?.error ? `Restart ${hunterLabel}` : "Run another 10 seconds"}
    </button>
  ) : undefined;
  const returnViewLabel = returnView === "style" && selectedProfile
    ? isBingoStyle(selectedProfile)
      ? BINGO_STYLE_LABELS[selectedProfile]
      : PLAYER_PROFILE_LABELS[selectedProfile]
    : "All moves";
  const viewPicker = analysisGame && (
    <div className="result-view-picker" role="group" aria-label="Move list view">
      <button
        type="button"
        aria-pressed={view === "all"}
        title={view === "all" && returnView ? `Return to ${returnViewLabel}` : undefined}
        onClick={() => toggleView("all")}
      >
        All moves
      </button>
      <button
        type="button"
        aria-pressed={view === "shortlist"}
        title={view === "shortlist" && returnView ? `Return to ${returnViewLabel}` : undefined}
        onClick={() => toggleView("shortlist")}
      >
        Shortlist <span>{requiredSquares ? filteredShortlist.length : shortlist.length}</span>
      </button>
    </div>
  );
  const solveEndgame = opponentPosition && (
    <button
      className="button secondary solve-endgame-action"
      type="button"
      aria-label="Solve endgame"
      title={emptyRackEndgame ? emptyRackMessage : "Solve endgame"}
      disabled={emptyRackEndgame}
      onClick={startOpponentEndgame}
    >
      <Swords size={16} aria-hidden="true" />
      <span>Solve endgame</span>
    </button>
  );
  const moveListControls = viewPicker && (
    <div className="move-list-controls">
      {viewPicker}
      {solveEndgame}
      <select
        className="move-playing-style"
        aria-label="Playing style"
        title="Rank moves by a playing style"
        value={profile ?? ""}
        onChange={(event) => {
          const value = event.target.value as MoveStyle | "";
          onPlayingStyleChange?.(value || undefined);
          navigation.reset();
          setOrdering(undefined);
          setLocked(null);
          onPreview(null);
        }}
      >
        <option value="">No style</option>
        {PLAYER_PROFILES.map((profile) => (
          <option key={profile} value={profile}>{PLAYER_PROFILE_LABELS[profile]}</option>
        ))}
        {runBingoHunter && BINGO_STYLES.map(style => (
          <option key={style} value={style}>{BINGO_STYLE_LABELS[style]}</option>
        ))}
      </select>
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
  if (analysisGame && opponentPosition && opponentSearch) {
    if ("result" in opponentSearch) {
      return (
        <OpponentEndgameResults
          game={analysisGame}
          opponentRack={opponentPosition.opponentRack}
          result={opponentSearch.result}
          timing={opponentSearch.timing}
          onClose={closeOpponentEndgame}
          onPreview={(move) => onPreview(move, true, "opponent")}
        />
      );
    }
    return (
      <section className="results-panel panel" aria-label="Opponent endgame search">
        <header className="results-title">
          <div className="heading-with-icon">
            <CalculationIndicator
              active={opponentSearch.pending}
              idleIcon={<Swords />}
            />
            <h2>Opponent endgame</h2>
          </div>
        </header>
        {opponentSearch.pending ? (
          <OpponentEndgamePending
            progress={opponentSearch.progress}
            onCancel={closeOpponentEndgame}
          />
        ) : (
          <div className="results-empty">
            <h3>Couldn’t solve the opponent endgame</h3>
            <p className="error" role="alert">{opponentSearch.error}</p>
            <button type="button" className="button secondary" onClick={closeOpponentEndgame}>
              Back
            </button>
          </div>
        )}
      </section>
    );
  }
  return (
    <section
      aria-label="Possible moves"
      className={`results-panel panel ${!endgame && (analysisGame || rackOdds) ? "with-bingo-odds" : ""}${analysisGame && (replyEnabled || defense) ? " with-reply-column" : ""}${showEndgameSwing ? " with-endgame-estimates" : ""}${(showAdjustedPoints || profile) ? " with-third-score-line" : ""}`}
      style={{
        "--move-row-height": `${moveRowHeight}px`,
        "--result-rank-digits": String(totalMoves).length,
      } as CSSProperties}
    >
      <header
        className={`results-title possible-moves-title${exchangeAction ? " has-exchange-advice" : ""}`}
      >
        <div className="heading-with-icon">
          <CalculationIndicator
            active={
              calculating ||
              localCalculation ||
              replyAnalysis.calculating
            }
            onFindMoves={
              hasRack && !resultSet && !busy && !error
                ? () => onSolve()
                : undefined
            }
            onQuiet={
              onTimingComplete
                ? (stoppedAt) => {
                    onTimingComplete(stoppedAt, {
                      replies:
                        replyAnalysis.repliesElapsed === undefined
                          ? undefined
                          : { elapsed: replyAnalysis.repliesElapsed, endgame },
                      estimates: replyAnalysis.estimatesElapsed,
                      exactLines:
                        endgameProgress?.elapsed === undefined
                          ? undefined
                          : {
                              elapsed: endgameProgress.elapsed,
                              attempts: endgameProgress.attempts,
                            },
                    });
                  }
                : undefined
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
                title={!requiredSquares ? `${bingoLabel} across all legal moves` : bingoLabel}
              >
                <Trophy size={11} aria-hidden="true" />
                {formattedBingoCount}
              </span>
            )}
            <span className="count-badge" title={requiredSquares
              ? "Moves covering the selected squares"
              : "All legal moves"}>
              {moveCountPending ? "…" : moveCount.toLocaleString()}
            </span>
          </div>
        )}
        {exchangeAction}
        {analysisGame && !!totalMoves && !busy && !error && (
          <button
            type="button"
            className="button secondary analysis-toggle"
            title={analyzing ? "Close analysis" : "Analyze"}
            aria-expanded={analyzing}
            disabled={
              !analyzing &&
              (waitingForEndgame ||
                !total ||
                pagePending ||
                (!shortlistActive && page.unavailable))
            }
            data-move-preview-action
            onClick={() => {
              if (!analyzing)
                setCandidates(
                  shortlistActive
                    ? filteredShortlist.slice(0, ANALYSIS_LIMIT)
                    : [preview ?? page.head[0]],
                );
              setLocked(null);
              setInspectedReply(undefined);
              onPreview(null);
              setAnalyzing(!analyzing);
            }}
          >
            <ChartNoAxesCombined size={15} aria-hidden="true" />
            <span>{analyzing ? "Close analysis" : "Analyze"}</span>
          </button>
        )}
        {(resultSet || error) && (
          <button
            className="icon-button results-close move-results-close"
            type="button"
            aria-label="Close possible moves"
            onClick={() => {
              setFilter("");
              setSearchOpen(false);
              setOrdering(undefined);
              navigation.reset();
              setInspectedReply(undefined);
              setHeatmap(undefined);
              focusFindMoves.current = true;
              onCloseResults();
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </header>
      {showFilters && (!collapsibleSearch || !hasBingoControls || !totalMoves) && (
        <div className="result-filters">
          {moveListControls}
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
            toolbarStart={collapsibleSearch && moveListControls}
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
          <div className="results-search-actions">
            <button className="button secondary" type="button" onClick={() => onSolve()}>
              Try again
            </button>
            {solveEndgame}
          </div>
        </div>
      ) : resultSet === null ? (
        <div className="results-empty">
          <EmptyMoveTiles rules={bingoRules.rules} />
          <h3>{solveEndgame && emptyRackEndgame ? "No opponent endgame" : "A good move starts here."}</h3>
          {solveEndgame && emptyRackEndgame ? (
            <p>{emptyRackMessage}</p>
          ) : (
            <p>
              Enter the board and your rack.
              <br />
              We’ll find the possibilities.
            </p>
          )}
          <div className="results-search-actions">
            <button
              className="button primary"
              type="button"
              onClick={() => onSolve()}
              ref={findMovesButton}
              disabled={!hasRack}
            >
              <Sparkles size={16} />
              Find moves
            </button>
            {solveEndgame}
          </div>
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
              if (shortlistActive) toggleView("all");
              setSort("score", false, "all");
            }}
          >
            Skip endgame analysis
          </button>
        </div>
      ) : hunterSelected && !hunterResult?.checked ? (
        <div className="results-empty">
          {hunterPending ? (
            <>
              <LoaderCircle className="spin" size={24} aria-hidden="true" />
              {hunterStatus}
              {hunterAction}
            </>
          ) : (
            <>
              <p role="status">{hunter.current?.error ?? (invalid
                ? `Check tile counts before running ${hunterLabel}.`
                : hunterResult?.canContinue
                  ? "Search paused before enough moves could be compared."
                  : hunterResult?.limited
                    ? "The search reached its complexity limit."
                    : "Rank moves by weighted play points now and expected bingo points after the reply. Bingos count in full.")}</p>
              {hunterAction ?? (
                <button type="button" className="button primary" disabled={!hunterKey} onClick={() => hunter.start()}>
                  Run {hunterLabel}
                </button>
              )}
            </>
          )}
        </div>
      ) : profile && page.error ? (
        <div className="results-empty" role="status"><p>{page.error}</p></div>
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
          <h3>{profile && !filter && !requiredSquares ? "No moves spotted" : totalMoves ? "No matching words" : "No legal moves found"}</h3>
          <p>
            {!totalMoves
              ? "Check your rack and board, or try a different dictionary."
              : requiredSquares
                ? "Change the selected squares or clear the square filter."
                : filter
                  ? "Try a different word or clear the filter."
                  : "Try the All moves view."}
          </p>
          {!showFilters && solveEndgame}
        </div>
      ) : (
        <>
          {replyEnabled && (replyAnalysis.invalid || replyAnalysis.error) && (
            <div className="reply-controls" role="status">
              {replyAnalysis.error ?? "Check tile counts for reply analysis."}
            </div>
          )}
          {replyEnabled && <ReplyLimitNotice analysis={replyAnalysis} size={size} />}
          {replyEnabled && (estimateNotice || endgameProgress) && (
            <div className="reply-controls">
              {estimateNotice && <span role="status">{estimateNotice}</span>}
              {endgameProgress && (
                <span
                  role="status"
                  title={[...endgameProgress.limits, endgameProgress.error].filter(Boolean).join("\n") || undefined}
                >
                  {endgameProgress.pending
                    ? `Solving exact lines · ${endgameProgress.checked}/${endgameProgress.total} checked`
                    : `${endgameProgress.ready}/${endgameProgress.total} exact lines ready`}
                  {!!endgameProgress.limits.length &&
                    ` · ${endgameProgress.limits.length} hit a limit`}
                  {endgameProgress.error && " · Background search stopped"}
                </span>
              )}
              {replyAnalysis.canContinueEndgames && (
                <button
                  type="button" className="button secondary"
                  title="Continue each unfinished line for up to 10 more seconds."
                  onClick={replyAnalysis.continueEndgames}
                >
                  Run another 10 seconds
                </button>
              )}
            </div>
          )}
          {replyEnabled && analysisGame && !onBoardOdds && (
            <div className="reply-controls">
              <ReplySettings analysis={replyAnalysis} />
            </div>
          )}
          {hunterResult && (
            <div className="reply-controls">
              {hunterStatus ?? (
                <span role="status">
                  {hunterResult.checked} candidates checked
                  {hunterResult.canContinue && (hunterResult.ceilingPass ? " · High-ceiling setups ready to check" : " · Provisional")}
                  {hunterResult.ceilings?.length === 0 && !hunterResult.canContinue && " · No high-ceiling setups found"}
                  {hunterResult.finalistsRefined && " · Finalists checked more deeply"}
                  {hunterResult.limited && " · Search limit reached"}
                  {hunter.current?.error && ` · ${hunter.current.error}`}
                </span>
              )}
              {hunterAction}
            </div>
          )}
          {!!hunterResult?.ceilings?.length && (
            <HighCeilingSetups setups={hunterResult.ceilings} selected={locked}
              onPreview={togglePin} onPlay={(move) => { setLocked(null); onPlay(move); }} />
          )}
          <div className="result-columns">
            <div className="result-word-heading">
              {column("WORD", "word", "word")}
            </div>
            <div className="result-points-heading">
              {canSortAdjusted || profile ? (
                <ResultSortMenu
                  label={sort === "playing-style" ? "STYLE" : sort === "reply-adjusted" ? "ADJ. PTS" : "PTS"}
                  accessibleLabel={profile ? "Sort by playing style or points" : "Sort by points or reply-adjusted points"}
                  sortDirection={
                    pointsSorted
                      ? reversed ? "ascending" : "descending"
                      : undefined
                  }
                >
                  {column("Points", "score", "points")}
                  {canSortAdjusted && column("Reply-adjusted points", "reply-adjusted", "reply-adjusted points")}
                  {profile && (
                    <button className="result-column-sort" type="button" aria-pressed={sort === "playing-style"}
                      onClick={() => setSort("playing-style")}>Playing style</button>
                  )}
                </ResultSortMenu>
              ) : (
                column("PTS", "score", "points")
              )}
            </div>
            {analysisGame && (replyEnabled || defense) && (
              <div className="result-reply-heading">
                {showEndgameSwing
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
                <ResultSortMenu
                  label={
                    sort === "bingo-draw"
                      ? "DRAW %"
                      : sort === "board-bingo"
                        ? "AFTER %"
                        : "LEAVE"
                  }
                  accessibleLabel="Sort by leave or bingo odds"
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
                </ResultSortMenu>
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
            onScroll={(e) => {
              const top = e.currentTarget.scrollTop;
              setScrollPositions((current) => ({ ...current, [view]: { sort, reversed, top } }));
            }}
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
                const risk = analysisGame && defense?.[m.id];
                const reply = replyAnalysis.results?.[m.id];
                const extraReason = replyAnalysis.extraReasons[m.id];
                const extraLabel = extraReason === "block" ? "Premium block" :
                  extraReason === "leave" ? "Better leave" : undefined;
                const movePosition = moveLocation(m);
                const adjusted = showAdjustedPoints && reply?.kind === "distribution"
                  ? replyAdjustedPoints(m, reply.difference)
                  : undefined;
                const adjustedLabel = adjusted === undefined
                  ? undefined
                  : Number(adjusted.toFixed(1));
                const utility = page.utilities?.[m.id];
                const utilityTotal = utility && formatUtility(utility.total);
                const estimate = page.endgame?.[m.id];
                const exactLine = showEndgameSwing
                  ? replyAnalysis.cachedEndgame(m.id)
                  : undefined;
                const length = exactLine && endgameLength(exactLine);
                const swing = exactLine?.spread ?? estimate?.spread;
                const exact = !!exactLine || !!estimate?.exact;
                const finalMargin = swing !== undefined && replyScores
                  ? replyScores.you - replyScores.opponent + swing
                  : undefined;
                const openingReply = exactLine?.line[1];
                const threat = exactLine
                  ? openingReply && !openingReply.leave && !replyAnalysis.crossplay
                    ? openingReply
                    : undefined
                  : estimate?.reply?.goesOut
                    ? estimate.reply
                    : undefined;
                const threatBingo =
                  !!threat &&
                  isBingo(
                    bingoRules,
                    "tiles" in threat ? threat.tiles.length : replyAnalysis.opponentRack.length,
                  );
                const metricId =
                  (reply || showEndgameSwing) && analysisGame
                    ? `${replyMetricId}-${start + offset}`
                    : undefined;
                const replyPending =
                  (targetIds.has(m.id) &&
                    replyAnalysis.pending &&
                    !(m.id in (replyAnalysis.results ?? {}))) ||
                  (!!replyAnalysis.detail?.pending &&
                    replyAnalysis.detail.key === `reply-histogram:${m.id}`);
                const checkHistogram = !analyzing && replyEnabled && replyAnalysis.canRequestHistogram;
                const sacrifice = topScore === null ? 0 : topScore - m.score;
                const sacrificeLabel =
                  topScore === null
                    ? ", top score unavailable"
                    : sacrifice
                      ? `, ${sacrifice} below top score${rackMarked ? " with rack marks cleared" : ""}`
                      : "";
                const short = shortlistActive
                  ? shortlistById.get(m.id)
                  : undefined;
                const scoreRank = short?.scoreRank ?? page.scoreRanks?.[m.id] ?? headScoreRanks[m.id];
                const scoreRankLabel = scoreRank === undefined ? "" : `Rank ${scoreRank} by points`;
                const selected =
                  analyzing &&
                  candidates.some((candidate) => candidate.id === m.id);
                const histogramSelected = histogramSelection?.id === m.id;
                const pinned = locked === m.id || histogramSelected;
                return (
                  <div
                    className="result-slot"
                    key={m.id}
                    ref={pinned ? pinnedRow : undefined}
                    style={{ top: (start + offset) * moveRowHeight }}
                    onContextMenu={(event) => {
                      if (definitionHold.ownsContextMenu(event.target)) {
                        event.preventDefault();
                        return;
                      }
                      if (analyzing) return;
                      event.preventDefault();
                      togglePin(m);
                    }}
                    onPointerEnter={(e) => {
                      if (locked || histogramSelection || !canHoverWithMouse(e.pointerType)) return;
                      onPreview(m, analyzing);
                      if (
                        !analyzing &&
                        searchId !== undefined &&
                        (reply || exactLine || (compact && replyPending))
                      )
                        setInspectedReply({ move: m, searchId });
                    }}
                    onPointerLeave={(e) => {
                      if (!locked && !histogramSelection && canHoverWithMouse(e.pointerType))
                        onPreview(null);
                    }}
                  >
                    {start + offset === endgameDivider && (
                      <span
                        className="result-endgame-divider"
                        role="separator"
                        aria-label="End of exact swings"
                      />
                    )}
                    <button
                      className={`result-row${bingo ? " bingo" : ""}${preview?.id === m.id || selected || histogramSelected ? " active" : ""}${pinned ? " pinned" : ""}`}
                      aria-pressed={analyzing ? selected : undefined}
                      aria-describedby={definitionMoveId === m.id
                        ? [metricId, definitions.id].filter(Boolean).join(" ")
                        : metricId}
                      disabled={
                        analyzing &&
                        !selected &&
                        candidates.length >= ANALYSIS_LIMIT
                      }
                      aria-label={`${m.word}, ${m.score} points, ${movePosition} ${m.direction}, ${m.tiles.length} tiles${bingo ? `, bingo, ${bingoBonus}-point bonus included` : ""}${rackPercent ? `, bingo draw ${rackPercent}` : ""}${boardPercent ? `, bingo after your play ${boardPercent}` : ""}${sacrificeLabel}${utility ? `, Utility ${utilityTotal}, rank ${utility.rank} by playing style` : adjustedLabel === undefined ? "" : `, ${adjustedLabel} reply-adjusted points`}${short ? `, ${short.reason}${short.detail ? `, ${short.detail}` : ""}` : extraLabel ? `, ${extraLabel}` : ""}${scoreRankLabel ? `, ${scoreRankLabel}` : ""}${histogramSelected ? ", selected for reply details" : ""}`}
                      onPointerDown={(e) => {
                        pointer.current = e.pointerType;
                      }}
                      onFocus={() => {
                        if (!locked && !histogramSelection) onPreview(m, analyzing);
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
                        if (histogramSelection) setInspectedReply(undefined);
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
                        <span className="result-rank" title={scoreRankLabel} aria-hidden="true">
                          {scoreRank}
                        </span>
                        <span
                          className="result-letters"
                          aria-hidden="true"
                          data-move-id={definitionLanguage ? m.id : undefined}
                          data-definition-hold={touchDefinitions || undefined}
                          onPointerDown={touchDefinitions ? (event) => {
                            definitionHold.start(event, (anchor) =>
                              definitions.openSheet(anchor, [{ word: m.word }], m.word),
                            );
                          } : undefined}
                          onPointerEnter={(mouseDefinitions && definitionLanguage) ? (event) => {
                            if (event.pointerType === "mouse" && event.buttons === 0)
                              definitions.hover(event.currentTarget, m.word);
                          } : undefined}
                          onPointerLeave={(mouseDefinitions && definitionLanguage) ? (event) => {
                            if (event.pointerType === "mouse") definitions.leave();
                          } : undefined}
                        >
                          <MoveLetters
                            move={m}
                            size={size}
                            board={analysisGame?.board}
                            showTileTitles={!definitionLanguage}
                          />
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
                              : extraLabel ?? `${m.tiles.length} tile${m.tiles.length !== 1 ? "s" : ""}`}
                            {!short && !extraLabel && m.blanks
                              ? ` · ${m.blanks} blank${m.blanks > 1 ? "s" : ""}`
                              : ""}
                            {!short && !extraLabel && m.crosses.length
                              ? ` · +${m.crosses.length} cross`
                              : ""}
                          </span>
                        </small>
                      </span>
                      <span className="result-score result-stack">
                        <strong>{m.score}</strong>
                        <small
                          className="result-score-delta"
                          title={scoreDeltaHint}
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
                          {topScore === null ? "—" : signedPoints(-sacrifice)}
                        </small>
                        {utility ? (
                          <small className="result-score-extra">U {utilityTotal}</small>
                        ) : adjustedLabel !== undefined && (
                          <small className="result-score-extra">Adj. {adjustedLabel}</small>
                        )}
                      </span>
                      {showEndgameSwing ? (
                        <span className="result-reply-metric" id={metricId}>
                          {swing !== undefined ? (
                            <span
                              className="reply-cell endgame-estimate"
                              title={`${exact ? "Exact" : "Estimated"} endgame swing ${signedPoints(swing)}${threat ? `. Opponent can go out with ${threat.word} for ${threat.score} points.` : ""}`}
                            >
                              <strong
                                className={scoreTone(swing) ?? "reply-neutral"}
                              >
                                {!exact && "≈"}
                                {signedPoints(swing)}
                                {threatBingo && finalMargin === undefined && (
                                  <BingoBadge className="endgame-threat-badge" />
                                )}
                              </strong>
                              {finalMargin !== undefined ? (
                                <small
                                  className={scoreTone(finalMargin) ?? "reply-neutral"}
                                  title={exact ? "Final margin" : "Estimated final margin"}
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
                              {length && (
                                <small
                                  className="reply-neutral endgame-ply-count"
                                  title={length.expanded}
                                >
                                  {length.compact}
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
                        {moveLocation(m)}
                      </span>
                    </button>
                    {analysisGame &&
                      scoreTooltip.trigger(
                        m,
                        `${utility ? "Utility" : "Score"} breakdown for ${m.word} at ${moveLocation(m)} ${m.direction}`,
                      )}
                    {!showEndgameSwing && replyPending && (
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
                    {!showEndgameSwing && !reply && !replyPending && (risk || checkHistogram) && (
                      <div className="result-defense-action result-reply-actions">
                        {risk && (
                          <PremiumRiskButton
                            defense={risk}
                            size={size}
                            moveLabel={`${m.word} at ${movePosition} ${m.direction}`}
                            chanceFor={premiumReplyChance}
                            onClick={() =>
                              setInspectedDefense({ move: m, risk, key: analysisKey })
                            }
                          />
                        )}
                        {checkHistogram && (
                          <button
                            type="button"
                            className="icon-button result-histogram-trigger"
                            aria-label={`Check reply histogram for ${m.word} at ${movePosition} ${m.direction}`}
                            title="Check reply histogram"
                            data-move-preview-action
                            onClick={() => checkReplyHistogram(m)}
                          >
                            <ChartNoAxesCombined size={15} aria-hidden="true" />
                          </button>
                        )}
                      </div>
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
              {touchDefinitions && " · hold the word to define"}
            </span>
          </>
        )}
        {replyAnalysis.pending ? (
          <span title="Checking opponent replies">
            Replies {replyAnalysis.target.filter(({ id }) => id in (replyAnalysis.results ?? {})).length}/
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
          timing && <MoveTimingButton timing={timing} />
        )}
      </footer>
      {analysisGame && replyMove && (replyLine || replyDetail || requestedHistogram) && (
        <section
          className={`inline-reply${compact && replyDetail?.kind === "distribution" ? " compact-reply" : ""}`}
          aria-label={`Reply after ${replyMove.word}`}
          data-move-preview-action
        >
          <h3 className={replyLine ? "optimal-reply-title" : undefined}>
            <span>Reply after <MoveWord move={replyMove} rules={analysisGame.template} /></span>
            {replyLength && (
              <span className="exact-reply-metadata">
                <span className="optimal-reply-badge"><Check size={13} aria-hidden="true" /> Exact line</span>
                <small>{replyLength.expanded}</small>
              </span>
            )}
          </h3>
          {replyLine ? (
            <OptimalReplyDetails
              key={replyMove.id}
              game={analysisGame}
              line={replyLine}
              opponentRack={replyAnalysis.opponentRack}
            />
          ) : replyDetail ? (
            <ReplyPreview
              game={analysisGame}
              move={replyMove}
              result={replyDetail}
              defense={defense?.[replyMove.id]}
              analysis={replyAnalysis}
              onHeatmap={() => openHeatmap(replyMove)}
            />
          ) : <ReplyHistogramStatus detail={requestedHistogram} size={size} />}
        </section>
      )}
      {scoreTooltip.popup}
      {definitions.popup}
      {analysisGame && defenseDetail && (
        <PremiumDefense
          game={analysisGame}
          move={defenseDetail.move}
          defense={defense?.[defenseDetail.move.id] ?? defenseDetail.risk}
          opponentRackSize={opponentRackSize}
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
            limit={heatmapDetail?.limit}
            onClose={() => setHeatmap(undefined)}
            onRetry={() => openHeatmap(heatmapMove)}
          />
        )}
    </section>
  );
}
