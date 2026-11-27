import { isSimulatedStyle } from "../shared/simulated-styles";
import { explainStyleExchange, type StyleExplanation } from "../shared/style-explanation";
import { Activity, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ImagePlus,
  ArrowRight,
  ChartNoAxesCombined,
  CircleArrowUp,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  CloudOff,
  Copy,
  Grid2X2,
  History,
  Home,
  Info,
  Keyboard,
  ListChecks,
  LoaderCircle,
  Map,
  Menu,
  Monitor,
  MoreHorizontal,
  Plus,
  Redo2,
  Save,
  Search,
  Settings,
  Smartphone,
  TriangleAlert,
  Undo2,
  Wifi,
  X,
  Archive,
} from "lucide-react";
import { version } from "../version.json";
import Brand, { BrandTile, updateFavicon } from "./components/Brand";
import BoardHistoryControls from "./components/BoardHistoryControls";
import BoardEntry, {
  BoardEntryHelp,
  type BoardEntryHandle,
  type DraftHistory,
} from "./components/BoardEntry";
import BoardFinishOverlay from "./components/BoardFinishOverlay";
import LastPlay, { type LastPlayBag } from "./components/LastPlay";
import { useGameFinish } from "./useGameFinish";
import { useGameReplay } from "./useGameReplay";
import { ReplayControls, ReplayScores } from "./components/GameReplay";
import {
  GameCalculations,
  useGameCalculating,
} from "./components/GameCalculations";
import GameId from "./components/GameId";
import { MoveSquareFilterControls, useMoveSquareFilter } from "./components/MoveSquareFilter";
import GameWorkspace, { GameBoardColumn, useMoveReview } from "./components/GameWorkspace";
import RackEntry, { type RackEntryHandle } from "./components/RackEntry";
import ExchangeSuggestion from "./components/ExchangeSuggestion";
import {
  flyTiles,
  prepareTileFlight,
  revealTileTargets,
  rackTileRects,
} from "./components/tile-motion";
import { useReplyAnalysis } from "./useReplyAnalysis";
import { rackComposition, splitRack } from "../shared/rack-entry";
import { playOwnMoveWithRackCorrection, type OwnPlayRackCorrection } from "../shared/own-play";
import BoardStudio from "./components/BoardStudio";
import ScreenshotImport from "./components/ScreenshotImport";
import { hasCustomPremiums, importBoard } from "../shared/screenshot";
import Modal from "./components/Modal";
import WordListChecker from "./components/WordListChecker";
import MoveWord from "./components/MoveWord";
import WordLists from "./components/WordLists";
import UiGuide from "./components/UiGuide";
import WorkspaceSettings, {
  useWorkspacePreferences,
} from "./components/WorkspaceSettings";
import { browserConcurrency, computeWorkerLimit } from "./compute-workers";
import { ComputeWorkerLimit } from "./components/ComputeWorkerLimit";
import Results from "./components/Results";
import GamePicker, { type GamePickerHandle } from "./components/GamePicker";
import KeyboardShortcuts from "./components/KeyboardShortcuts";
import useKeyboardShortcuts from "./useKeyboardShortcuts";
import {
  GameDetailFields,
  IncompleteMoveHistoryIcon,
  readGameDetails,
} from "./components/GameDetails";
import ArchivedGames from "./components/ArchivedGames";
import ArchiveStats from "./components/ArchiveStats";
import SyncConflictMenu from "./components/SyncConflictMenu";
import GameScoreBadge from "./components/GameScoreBadge";
import GameScores from "./components/GameScores";
import GameOptions from "./components/GameOptions";
import EndGameDialog from "./components/EndGameDialog";
import { useBoardTurnActions } from "./components/BoardTurnActions";
import {
  playTrackedMove,
  recordBoardlessTurn,
  lastSearchRecordedOpponentTurn,
  nextPlayerToMove,
  recordOpponentPlay,
  recordOpponentPlayForSearch,
  recordOpponentRackOut,
  reopenSearchRecordedOpponentPlay,
  setScoreTracking,
  tracksScores,
  treatBoardEditAsCorrection,
} from "../shared/game-scoring";
import { DEFENSE_LIMIT } from "../shared/premium-defense";
import { useSolver } from "./useSolver";
import { useStyleExchange } from "./useStyleExchange";
import { useGamePlayingStyle, usePlayingStyleSample } from "./useGamePlayingStyle";
import { useMoveListNavigation } from "./useMoveListNavigation";
import { profileWordHash } from "../shared/player-profiles";
import OfflineStatus from "./components/OfflineStatus";
import { useAutoUpdate } from "./useAutoUpdate";
import { followRoute, routeHref, useNavigation, type Workspace, type WorkspaceTool } from "./navigation";
import { useWorkspaceLayout } from "./useWorkspaceLayout";
import { store, useStore } from "./store";
import { premiumPalette } from "./premium-palettes";
import NewGameDialog from "./components/NewGameDialog";
import {
  type BoardTemplate,
  type BoardlessTurn,
  type Game,
  type Move,
  type Player,
  archiveGame,
  orderGames,
  redo,
  tileScore,
  undo,
} from "../shared/model";
import { recentOpponentNames } from "../shared/game-index";
import { archiveForReview, resumeFinishedGame } from "../shared/archive-history";

type Dialog =
  | "screenshot"
  | "new"
  | "dictionary-sources"
  | "profile"
  | "rename-profile"
  | "delete-profile"
  | "history"
  | "board-help"
  | "rename"
  | "delete"
  | "end-game"
  | "manage"
  | null;

const workspaceLinks = [
  ["games", "My games", Home],
  ["archive", "Archived games", Archive],
  ["stats", "Stats", ChartNoAxesCombined],
  ["studio", "Board studio", Grid2X2],
] as const;
const toolLinks = [
  ["dictionaries", "Word lists", BookOpen],
  ["word-list-checker", "Word list checker", ListChecks],
  ["ui-guide", "UI guide", Map],
  ["keyboard-shortcuts", "Keyboard shortcuts", Keyboard],
  ["help", "Use on another device", Smartphone],
] as const;

type TileFlight = NonNullable<ReturnType<typeof prepareTileFlight>> & {
  before: Game;
  bag: LastPlayBag;
  destination: string;
  move: Move;
  reviewing: boolean;
  trial: boolean;
};

function saved(key: string, fallback = "") {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function positionSignature(game: Game) {
  const {
    size,
    start,
    premiums,
    rackSize,
    bingo,
    additionalBonuses,
    rules,
    tileCounts,
  } = game.template;
  const { available, held } = splitRack(game);
  const required = (game.requiredRackSlots ?? [])
    .map((slot) => game.rack[slot])
    .join("");
  return JSON.stringify([
    game.id,
    game.dictionaryId,
    rackComposition(available),
    rackComposition(held),
    rackComposition(required),
    game.board,
    size,
    start,
    premiums,
    rackSize,
    bingo,
    additionalBonuses,
    rules,
    tileCounts,
  ]);
}

function describeGameBoard(game: Game) {
  const { name, size } = game.template;
  return `${name}${hasCustomPremiums(game) ? " (custom)" : ""} · ${size} × ${size}`;
}

function GameLoadStatus({ id, error }: { id: string; error?: string }) {
  return error ? (
    <div>
      <p role="alert">{error}</p>
      <button
        className="button secondary"
        onClick={() => void store.loadGame(id)}
      >
        Try again
      </button>
    </div>
  ) : (
    <p role="status">Opening game…</p>
  );
}

export default function App() {
  const preferenceState = useWorkspacePreferences();
  const concurrencyHint = browserConcurrency();
  const { limitComputeWorkers, computeWorkerCap } = preferenceState[0];
  const workerLimit = computeWorkerLimit(
    limitComputeWorkers ? computeWorkerCap : undefined,
    concurrencyHint,
  );
  return (
    <GameCalculations>
      <ComputeWorkerLimit.Provider value={workerLimit}>
        <Tilemaxx preferenceState={preferenceState} concurrencyHint={concurrencyHint} workerLimit={workerLimit} />
      </ComputeWorkerLimit.Provider>
    </GameCalculations>
  );
}

function Tilemaxx({ preferenceState, concurrencyHint, workerLimit }: {
  preferenceState: ReturnType<typeof useWorkspacePreferences>;
  concurrencyHint: number | undefined;
  workerLimit: number;
}) {
  const sidebarOpenButton = useRef<HTMLButtonElement>(null);
  const sidebarCollapseButton = useRef<HTMLButtonElement>(null);
  const conflictBanner = useRef<HTMLDivElement>(null);
  const [reviewConflictId, setReviewConflictId] = useState<string>();
  const moveSidebarFocus = useRef(false);
  const boardPanel = useRef<HTMLElement>(null);
  const gameOptionsButton = useRef<HTMLButtonElement>(null);
  const moveOptionsButton = useRef<HTMLElement>(null);
  const rackPanel = useRef<HTMLElement>(null);
  const rackEntry = useRef<RackEntryHandle>(null);
  const boardEntry = useRef<BoardEntryHandle>(null);
  const gamePicker = useRef<GamePickerHandle>(null);
  const archiveFilter = useRef<HTMLInputElement>(null);
  const pendingGameSearch = useRef<Workspace>(undefined);
  const [flight, setFlight] = useState<TileFlight>();
  const rackRefill = useRef<{ position: string; from: Element | null } | null>(null);
  const state = useStore(),
    data = state.data;
  const { shell, narrowLayout, sidebarOverlay } = useWorkspaceLayout(!!data);
  const [preferredProfile] = useState(() => saved("tilewise:profile"));
  const [localDialog, setDialog] = useState<Dialog>(null),
    [sidebarDrawerOpen, setSidebarDrawerOpen] = useState(false),
    [toast, setToast] = useState(""),
    [error, setError] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sidebarVisible = sidebarOverlay ? sidebarDrawerOpen : !sidebarCollapsed;
  useLayoutEffect(() => {
    if (!moveSidebarFocus.current) return;
    moveSidebarFocus.current = false;
    const button = sidebarVisible ? sidebarCollapseButton : sidebarOpenButton;
    button.current?.focus({ preventScroll: true });
  }, [sidebarVisible]);
  const [theme, setTheme] = useState(() =>
    // Older versions saved System even when the user had never selected it.
    saved("tilemaxx:theme") || (saved("tilewise:theme") === "light" ? "light" : "dark"),
  );
  const [preferences, setPreferences] = preferenceState;
  const [movePreview, setPreview] = useState<{
    move: Move;
    analysis: boolean;
    player: Player;
    explanation?: { value: StyleExplanation; position: string };
  } | null>(null);
  const preview = movePreview?.move ?? null;
  const [formName, setFormName] = useState(""),
    [formBusy, setFormBusy] = useState(false);
  const [editProfileId, setEditProfileId] = useState("");
  const { route, navigate, closeOverlay } = useNavigation(() => {
    setDialog(null);
    setSidebarDrawerOpen(false);
    setPreview(null);
    gameReplay.pause();
  });
  const { workspace } = route;
  const dialog = route.tool ?? localDialog;
  const lastArchiveSort = useRef(route.sort);
  useEffect(() => {
    if (workspace === "archive") lastArchiveSort.current = route.sort;
  }, [route.sort, workspace]);
  useLayoutEffect(() => {
    if (pendingGameSearch.current !== workspace) return;
    pendingGameSearch.current = undefined;
    if (workspace === "archive") archiveFilter.current?.focus();
    else gamePicker.current?.focusSearch();
  }, [workspace]);
  const [archiveEditId, setArchiveEditId] = useState<string>();
  const importBase = useRef<Game | null>(null);
  const linkedGame = route.gameId ? data?.games.find((game) => game.id === route.gameId) : undefined;
  const profile = data?.profiles.find((p) => p.id === (linkedGame?.profileId ?? route.profileId ?? preferredProfile))
    ?? data?.profiles[0];
  const profileId = profile?.id ?? "";
  const profileGames = data?.games.filter((g) => g.profileId === profileId) ?? [];
  const activeGames = orderGames(
    profileGames.filter((g) => !g.archived),
    profile?.gameOrder,
  );
  const lastActive = saved(`tilewise:last:${profileId}`);
  const defaultGame = activeGames.find((g) => g.id === lastActive) ?? activeGames[0];
  const lastViewed = workspace === "games" && location.pathname === "/" ? saved("tilewise:game") : "";
  const selectedGame = route.gameId ? linkedGame :
    profileGames.find((g) => g.id === lastViewed) ?? defaultGame;
  const gameId = route.gameId ?? selectedGame?.id ?? "";
  const savedGame = selectedGame ? state.games[selectedGame.id] : undefined;
  const gameReplay = useGameReplay(
    workspace === "games" ? savedGame : undefined,
    !dialog && !(sidebarOverlay && sidebarDrawerOpen),
    route.move,
    (move, replace) => navigate(
      { ...route, gameId, move, review: undefined },
      savedGame?.archived || replace,
    ),
  );
  const replay = gameReplay.active;
  const historical = gameReplay.historical;
  const trial = gameReplay.trial;
  const boardUnavailable = historical && !replay?.frame.board;
  const recordedPreview = replay?.showRecorded ? replay.frame.position : undefined;
  const alternativePreview = replay?.alternativePreview;
  const replayDrawShelf = replay?.frames.some(({ draw }) => draw !== undefined) ?? false;
  const game = gameReplay.position ?? savedGame;
  const squareFilter = useMoveSquareFilter(workspace === "games" ? game : undefined);
  const editProfile = data?.profiles.find((p) => p.id === editProfileId);
  const editingArchive =
    dialog === "rename" && archiveEditId
      ? data?.games.find(
          (g) => g.id === archiveEditId && g.profileId === profileId,
        )
      : undefined;
  const editGame = archiveEditId
    ? editingArchive && state.games[editingArchive.id]
    : savedGame;
  const openId = workspace === "games" ? selectedGame?.id : undefined;
  const editId = editingArchive?.id;
  useEffect(() => {
    store.watchGames(openId, editId);
  }, [openId, editId]);
  const signature = game ? positionSignature(game) : "";
  const gameOver = !!game?.scoring?.end && !game.archived;
  const compactGame = workspace === "games" && !narrowLayout;
  const solver = useSolver(signature, game);
  const [findMovesRequest, setFindMovesRequest] = useState(0);
  const { busy, warnings, searchResults } = solver;
  const searchId = searchResults?.searchId;
  const calculating = useGameCalculating();
  const replyAnalysis = useReplyAnalysis(
    boardUnavailable ? undefined : game,
    signature,
    searchResults?.head ?? null,
    workspace === "games" && !!game && !game.solo && !gameOver && !busy && !solver.error,
    { searchId, rank: solver.rankEndgame },
    workerLimit,
    solver.replyCandidates,
  );
  const [playingStyle, selectPlayingStyle] = useGamePlayingStyle(game?.id, game?.solo);
  const moveListNavigation = useMoveListNavigation(solver.results?.searchId, playingStyle);
  const sampledProfile = isSimulatedStyle(playingStyle) ? undefined : playingStyle;
  const { sample: styleSample, resample: resampleStyle } = usePlayingStyleSample(signature, sampledProfile);
  const exchangeProfile = game?.solo ? undefined : sampledProfile;
  const exchangeSeed = game ? profileWordHash(game.id) : 0;
  const exchangeSearch = solver.results?.searchId;
  const exchangeChoice = exchangeProfile && exchangeSearch !== undefined
    ? solver.styleChoice(exchangeSearch, exchangeProfile, replyAnalysis.bagSize, exchangeSeed, styleSample, replyAnalysis.scorelessTurns)
    : undefined;
  const styleExchange = useStyleExchange(
    workspace === "games" && !game?.solo && !gameOver && !busy && !solver.error && !warnings.length && !replyAnalysis.invalid ? game : undefined,
    signature,
    exchangeSearch,
    exchangeProfile,
    exchangeChoice,
    replyAnalysis.bagSize,
    replyAnalysis.scorelessTurns,
    exchangeSeed,
  );
  const exchangeAdvice = moveListNavigation.view === "style" ? styleExchange.advice : solver.exchangeAdvice;
  const recommendedPass = playingStyle === "master" && moveListNavigation.view === "style"
    ? solver.masterPass(exchangeSearch, replyAnalysis.bagSize, replyAnalysis.scorelessTurns, replyAnalysis.opponentHasFinalTurn)
    : undefined;
  const activeFlight =
    workspace === "games" && flight?.destination === signature
      ? flight
      : undefined;
  const gameFinish = useGameFinish(workspace === "games" && !historical ? savedGame : undefined, !!activeFlight);
  const boardLocked = !!gameFinish.current || boardUnavailable;
  const canReplayGame = gameReplay.available && !boardLocked && !activeFlight;
  const [liveOwnPlay, setLiveOwnPlay] = useState<{ gameId: string; board: string }>();
  const [trialOwnPlay, setTrialOwnPlay] = useState<typeof liveOwnPlay>();
  const liveDraft = useRef<DraftHistory>(undefined);
  const trialDraft = useRef<DraftHistory>(undefined);
  const ownPlay = historical ? trialOwnPlay : liveOwnPlay;
  const setOwnPlay = historical ? setTrialOwnPlay : setLiveOwnPlay;
  const draft = historical ? trialDraft : liveDraft;
  const canEnterOwnPlay = !!game && workspace === "games" &&
    !game.archived && !gameOver && !boardLocked && !activeFlight;
  const enteringOwnPlay = canEnterOwnPlay && ownPlay?.gameId === game.id &&
    ownPlay.board === game.board.join(".");
  useEffect(() => {
    if (!enteringOwnPlay) setOwnPlay(undefined);
  }, [enteringOwnPlay, setOwnPlay]);
  useEffect(() => {
    if (!historical) setTrialOwnPlay(undefined);
  }, [historical]);
  useKeyboardShortcuts({
    enabled: !!data && !dialog && !boardLocked,
    focusRack() {
      if (!rackEntry.current) return false;
      setSidebarDrawerOpen(false);
      editPosition();
      rackEntry.current.focusEntry();
      return true;
    },
    toggleBoardCoordinates() {
      const outcome = boardEntry.current?.toggleCoordinateOverlay();
      if (!outcome) return false;
      if (outcome === "opened") {
        setSidebarDrawerOpen(false);
        boardPanel.current?.scrollIntoView?.({ block: "nearest" });
      }
      return true;
    },
    changeGameHistory(action) {
      if (workspace !== "games" || !game) return false;
      if (enteringOwnPlay) boardEntry.current?.changeDraftHistory(action);
      else if (action === "undo") undoGame();
      else redoGame();
      return true;
    },
    searchGames() {
      setSidebarDrawerOpen(false);
      if (workspace === "archive") {
        archiveFilter.current?.focus();
        return !!archiveFilter.current;
      }
      if (workspace === "games" && !selectedGame?.archived)
        return gamePicker.current?.focusSearch() ?? false;
      if (workspace === "games") {
        pendingGameSearch.current = "archive";
        showWorkspace("archive");
      } else {
        pendingGameSearch.current = "games";
        openMyGames();
      }
      return true;
    },
    showGuide: () => openTool("keyboard-shortcuts"),
  });
  const updateBusy =
    state.pending.length > 0 ||
    !!dialog ||
    formBusy ||
    solver.calculating ||
    styleExchange.pending ||
    replyAnalysis.calculating ||
    calculating ||
    !!activeFlight ||
    historical;
  const appUpdate = useAutoUpdate(
    state.online ? state.serverVersion : undefined,
    preferences.autoUpdate,
    updateBusy,
  );
  // Keep the preview controls active until the flying tiles land.
  const moveReview = useMoveReview(
    narrowLayout && workspace === "games" && (!gameOver || !!activeFlight),
    !busy && !solver.error && solver.results?.total
      ? solver.results.searchId
      : undefined,
    activeFlight?.reviewing,
  );
  const boardTurns = useBoardTurnActions(
    workspace === "games" && game && !game.archived && !gameOver && !historical &&
      tracksScores(game) ? game : undefined,
    canEnterOwnPlay && !enteringOwnPlay && (!moveReview.showing || !preview) && !squareFilter.selecting,
    editPosition,
    commitBoardTurn,
  );
  useLayoutEffect(() => {
    if (!flight) return;
    if (!activeFlight) {
      setFlight(undefined);
      return;
    }
    const board = boardPanel.current;
    const rack = rackPanel.current;
    const finish = () =>
      setFlight((current) => (current === flight ? undefined : current));
    if (!board || !rack) {
      finish();
      return;
    }
    const controller = new AbortController();
    let stop: (() => void) | undefined;
    const launch = () => {
      if (controller.signal.aborted) return;
      stop = flyTiles(
        board,
        flight.move.tiles,
        rackTileRects(rack, flight.slots),
        flight.before.template.rules,
        finish,
        flight.trial,
      );
      if (!stop) finish();
    };
    if (flight.reveal)
      void revealTileTargets(board, flight.move, controller.signal).then(
        launch,
      );
    else launch();
    return () => {
      controller.abort();
      stop?.();
    };
  }, [activeFlight, flight]);
  useLayoutEffect(() => {
    const refill = rackRefill.current;
    if (!refill) return;
    if (refill.position !== signature || workspace !== "games" || dialog || gameOver) {
      rackRefill.current = null;
      return;
    }
    if (activeFlight) return;
    rackRefill.current = null;
    const focused = document.activeElement;
    if (focused === refill.from || (focused === document.body && !refill.from?.isConnected))
      rackEntry.current?.focusEntry(true);
  }, [activeFlight, dialog, gameOver, signature, workspace]);
  const hasPlayableRack = !!game && !gameOver && !boardUnavailable && !!splitRack(game).available;
  useEffect(() => {
    updateFavicon();
    void store.refresh();
    const interval = setInterval(() => {
      if (!document.hidden) void store.refresh();
    }, 4000);
    const refresh = () => {
      if (document.hidden) void store.flush();
      else void store.refresh();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, []);
  useEffect(() => {
    if (route.workspace === "games" && !route.gameId && gameId)
      navigate({ ...route, gameId, profileId: undefined }, true);
  }, [gameId, navigate, route]);
  useEffect(() => {
    try {
      if (profileId) localStorage.setItem("tilewise:profile", profileId);
      if (openId) {
        localStorage.setItem("tilewise:game", openId);
        if (!selectedGame?.archived)
          localStorage.setItem(`tilewise:last:${profileId}`, openId);
      }
    } catch {}
  }, [profileId, openId, selectedGame?.archived]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  function changeTheme(nextTheme: string) {
    setTheme(nextTheme);
    try {
      localStorage.setItem("tilemaxx:theme", nextTheme);
    } catch {}
  }
  useEffect(() => setPreview(null), [signature]);
  useEffect(() => {
    setError("");
  }, [gameId, historical ? replay?.index : undefined]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  function update(next: Game) {
    if (historical) gameReplay.updateTrial(next);
    else updateSavedGame(next);
  }
  function updateSavedGame(next: Game) {
    // Older archives have no saved baseline. Capture their board before the
    // first edit so that additions stay marked after reloading or undoing.
    if (next.archived && !next.archivedBoard) {
      const previous = store.getSnapshot().games[next.id];
      const baseline = archiveGame(previous ?? next);
      next = {
        ...next,
        archivedBoard: baseline.archivedBoard,
        archivedState: baseline.archivedState,
      };
    }
    store.update(next);
  }
  function resumeGame() {
    if (!savedGame) return;
    const next = resumeFinishedGame(savedGame);
    if (next === savedGame) return;
    editPosition();
    gameFinish.dismiss();
    updateSavedGame(next);
    chooseGame(next.id);
    setDialog(null);
    notify("Game resumed.");
  }
  function updateAfterTurn(next: Game) {
    if (historical) {
      update(next);
      return;
    }
    const previous = store.getSnapshot().games[next.id];
    const finishing = gameFinish.queue(previous, next);
    update(next);
    const active = document.activeElement;
    if (finishing && active instanceof HTMLInputElement &&
      (boardPanel.current?.contains(active) || rackPanel.current?.contains(active)))
      active.blur();
  }
  function undoGame() {
    if (boardLocked || !game?.past.length) return;
    const previous = undo(game);
    const previousSignature = positionSignature(previous);
    if (previousSignature !== signature)
      solver.restoreOnUndo(previousSignature);
    update(previous);
  }
  function redoGame() {
    if (boardLocked || !game?.future.length) return;
    update(redo(game));
  }
  function changeSavedGameHistory(action: "undo" | "redo") {
    if (!historical) {
      if (action === "undo") undoGame();
      else redoGame();
      return;
    }
    if (!savedGame) return;
    const next = action === "undo" ? undo(savedGame) : redo(savedGame);
    if (next === savedGame) return;
    replay?.close();
    updateSavedGame(next);
  }
  function notify(text: string) {
    setToast(text);
  }
  function showWorkspace(next: Workspace) {
    navigate(workspaceRoute(next));
    setSidebarDrawerOpen(false);
    setPreview(null);
  }
  function workspaceRoute(next: Workspace) {
    const activeId = selectedGame && !selectedGame.archived ? selectedGame.id : defaultGame?.id;
    const archiveSort = workspace === "archive" ? route.sort : lastArchiveSort.current;
    return {
      workspace: next,
      profileId,
      gameId: next === "games" ? activeId : undefined,
      sort: next === "archive" ? archiveSort : undefined,
      stats: next === "stats" ? route.stats : undefined,
    };
  }
  function chooseGame(id: string) {
    navigate({ workspace: "games", gameId: id || undefined, profileId: id ? undefined : profileId });
    setSidebarDrawerOpen(false);
  }
  function openMyGames() {
    showWorkspace("games");
  }
  function selectProfile(id: string) {
    navigate({ workspace, profileId: id });
  }
  function toolRoute(tool: WorkspaceTool) {
    return { ...route, profileId, tool };
  }
  function openTool(tool: WorkspaceTool) {
    gameReplay.pause();
    setSidebarDrawerOpen(false);
    navigate(toolRoute(tool));
  }
  function closeTool() {
    closeOverlay({ ...route, tool: undefined, guide: undefined, wordList: undefined });
  }
  function selectReview(index: number | null | undefined) {
    const review = index == null ? index : index + 1;
    const next = { ...route, gameId, move: undefined, review };
    if (review === undefined) closeOverlay(next);
    else navigate(next);
  }
  function openDialog(next: Dialog) {
    setError("");
    setFormBusy(false);
    setDialog(next);
    setSidebarDrawerOpen(false);
    if (next === "manage") gameReplay.pause();
    if (next === "screenshot") importBase.current = savedGame ?? null;
    if (next === "rename") setArchiveEditId(undefined);
    if (next === "profile") setFormName("");
    if (next === "rename-profile" && profile) {
      setEditProfileId(profile.id);
      setFormName(profile.name);
    }
    if (next === "delete-profile") setFormName("");
  }
  async function action(fn: () => Promise<void>) {
    setFormBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFormBusy(false);
    }
  }
  function solve(reload = false) {
    if (!game || !hasPlayableRack) return;
    gameReplay.hideRecorded();
    setOwnPlay(undefined);
    const position = recordOpponentPlayForSearch(game);
    if (position !== game) updateAfterTurn(position);
    if (position.scoring?.end && !position.archived) return;
    setFindMovesRequest((request) => request + 1);
    if (narrowLayout) moveReview.open();
    if (solver.solve(position, reload)) setPreview(null);
  }
  function editPosition() {
    gameReplay.hideRecorded();
    if (moveReview.showing) moveReview.dismiss();
    if (squareFilter.selecting) squareFilter.setSelecting(false);
    setPreview(null);
  }
  function commitBoardTurn(player: Player, action: BoardlessTurn) {
    if (!game) return false;
    try {
      const explanation = player === "you" && !historical
        ? action.kind === "pass" ? recommendedPass :
          "slots" in action && exchangeAdvice && "profile" in exchangeAdvice
            ? explainStyleExchange(exchangeAdvice, game.rack, action.slots) : undefined
        : undefined;
      const next = recordBoardlessTurn(game, player, action, explanation);
      const recorded = next.past.at(-1);
      if (recorded?.player === "you" && recorded.action?.kind === "exchange") {
        rackRefill.current = { position: positionSignature(next), from: document.activeElement };
        solver.rememberResults();
      }
      editPosition();
      updateAfterTurn(next);
      setError("");
      return true;
    } catch (error) {
      setError((error as Error).message);
      return false;
    }
  }
  function startOwnPlay() {
    if (!canEnterOwnPlay) return;
    editPosition();
    setError("");
    draft.current = undefined;
    setOwnPlay({ gameId: game.id, board: game.board.join(".") });
    boardPanel.current?.scrollIntoView?.({ block: "nearest" });
  }
  function cancelOwnPlay() {
    setOwnPlay(undefined);
    setError("");
    rackPanel.current?.querySelector<HTMLElement>(".rack-tools summary")?.focus();
  }
  function finishSquareSelection() {
    squareFilter.setSelecting(false);
    moveOptionsButton.current?.focus({ preventScroll: true });
  }
  function toggleSquareSelection() {
    if (squareFilter.selecting) {
      finishSquareSelection();
      return;
    }
    if (!game) return;
    setOwnPlay(undefined);
    squareFilter.setSelecting(true);
    setPreview(null);
    if (narrowLayout) {
      moveReview.open();
      boardPanel.current?.scrollIntoView?.({ block: "nearest" });
    }
    const index = squareFilter.requiredSquares?.indices[0] ?? game.template.start;
    boardPanel.current
      ?.querySelector<HTMLButtonElement>(`[data-cell="${index}"]`)
      ?.focus({ preventScroll: true });
  }
  function previewMove(
    move: Move | null,
    analysis = false,
    player: Player = "you",
    explanation?: StyleExplanation,
  ) {
    if (enteringOwnPlay) return;
    if (move) gameReplay.hideRecorded();
    if (move && narrowLayout && player === "you") moveReview.open();
    setPreview(move ? {
      move, analysis, player, explanation: explanation && { value: explanation, position: signature },
    } : null);
  }
  function play(
    move: Move,
    { useRackMarks = true, correction, styleExplanation }: {
      useRackMarks?: boolean;
      correction?: OwnPlayRackCorrection;
      styleExplanation?: StyleExplanation;
    } = {},
  ) {
    if (!game || activeFlight || boardLocked) return;
    try {
      const corrected = correction && playOwnMoveWithRackCorrection(
        game, correction, replyAnalysis.bagConfirmed ? replyAnalysis.bagSize : undefined,
      );
      const bagSize = corrected?.bagSize ?? replyAnalysis.bagSize;
      const previewExplanation = movePreview?.move === move && movePreview.explanation?.position === signature
        ? movePreview.explanation.value : undefined;
      let decision = historical ? undefined : styleExplanation ?? previewExplanation;
      if (decision?.style !== playingStyle || moveListNavigation.view !== "style") decision = undefined;
      if (decision?.kind === "play") {
        if (recommendedPass) decision = { ...decision, recommended: false, preferred: "pass" };
        else if (exchangeAdvice && "profile" in exchangeAdvice)
          decision = { ...decision, recommended: false, preferred: "exchange" };
      }
      const next = corrected?.game ?? playTrackedMove(game, move, bagSize, useRackMarks, decision);
      const rackPosition = useRackMarks
        ? game
        : { ...game, excludedRackSlots: undefined, requiredRackSlots: undefined };
      const destination = positionSignature(next);
      const motion = !correction && preferences.animatePlayedTiles
        ? prepareTileFlight(
            rackPosition, move, rackPanel.current, boardPanel.current, narrowLayout,
          )
        : undefined;
      rackRefill.current = bagSize > 0
        ? { position: destination, from: document.activeElement }
        : null;
      solver.rememberResults();
      setFlight(
        motion && {
          ...motion,
          before: game,
          bag: {
            bagSize: replyAnalysis.bagSize,
            bagConfirmed: replyAnalysis.bagConfirmed,
            unseenPool: replyAnalysis.unseenPool,
          },
          destination,
          move,
          reviewing: moveReview.showing,
          trial: historical,
        },
      );
      setPreview(null);
      setOwnPlay(undefined);
      updateAfterTurn(next);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const archivedGames = profileGames.filter((g) => g.archived);
  const viewingArchivedGame = workspace === "games" && selectedGame?.archived;
  const pending = state.pending.length > 0,

    hasSaveError = Object.keys(state.saveErrors).length > 0,
    conflict = !historical && savedGame && state.conflicts[savedGame.id],
    saveError = !historical && savedGame && state.saveErrors[savedGame.id];
  useEffect(() => {
    if (reviewConflictId && reviewConflictId === game?.id && conflict) {
      conflictBanner.current?.focus();
      setReviewConflictId(undefined);
    }
  }, [conflict, game?.id, reviewConflictId]);
  const profileLetter =
    [...(profile?.name.trim() ?? "")][0]?.toLocaleUpperCase() || "?";
  if (!data)
    return (
      <div className="loading-screen">
        <BrandTile />
        <h1>Tilemaxx</h1>
        {state.error ? (
          <>
            <p>Cannot reach the Tilemaxx server.</p>
            <button
              className="button primary"
              onClick={() => void store.refresh()}
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" />
            <p>Opening your workspace…</p>
          </>
        )}
      </div>
    );
  function changeSidebarVisibility(visible: boolean) {
    if (visible === sidebarVisible) return;
    moveSidebarFocus.current = true;
    if (sidebarOverlay) setSidebarDrawerOpen(visible);
    else setSidebarCollapsed(!visible);
  }
  const headingMetadata = [
    selectedGame?.solo && "Solo",
    selectedGame?.platform,
    data.dictionaries.find(({ id }) => id === game?.dictionaryId)?.name,
  ].filter(Boolean).join(" · ");
  const opponentTurn = replay?.frame.move?.player === "opponent";
  const replayScores = game && ((replay?.showRecorded || alternativePreview) ? replay.frame.scores : {
    you: game.scoring?.[opponentTurn ? "opponent" : "you"].points ?? 0,
    opponent: game.scoring?.[opponentTurn ? "you" : "opponent"].points ?? 0,
  });
  const headlineScore = game && (
    <GameScoreBadge
      score={historical && replayScores
        ? { ...replayScores, solo: game.solo, outcome: "playing" }
        : gameFinish.score}
      label={historical ? "Replay score" : undefined}
      turn={historical && !game.solo ? replay?.frame.move?.player : nextPlayerToMove(game)}
      onReplay={historical ? undefined : gameFinish.replay}
      prominent={compactGame}
      showMargin
      showNoScore={!tracksScores(game)}
    />
  );
  const sidebarButton = (sidebarOverlay || !sidebarVisible) && (
    <button
      ref={sidebarOpenButton}
      className="icon-button menu-button"
      type="button"
      aria-label="Open sidebar"
      title="Open sidebar"
      aria-controls="tilemaxx-sidebar"
      aria-expanded={sidebarVisible}
      onClick={() => changeSidebarVisibility(true)}
    >
      <Menu size={20} aria-hidden="true" />
    </button>
  );
  const gameScores = savedGame && (
    <GameScores
      reviewNavigation={{
        index: route.review == null ? route.review : route.review - 1,
        select: selectReview,
      }}
      key={savedGame.id}
      game={savedGame}
      onToggle={(enabled) => update(setScoreTracking(savedGame, enabled))}
      onRecord={() => updateAfterTurn(recordOpponentPlay(savedGame))}
      onCorrection={() => update(treatBoardEditAsCorrection(savedGame))}
      onReplay={canReplayGame ? gameReplay.open : undefined}
      onEditLastOpponentMove={
        lastSearchRecordedOpponentTurn(savedGame)
          ? () => {
              editPosition();
              update(reopenSearchRecordedOpponentPlay(savedGame));
              boardPanel.current?.scrollIntoView?.({ block: "nearest" });
            }
          : undefined
      }
      onChange={update}
    />
  );
  const conflictGames = Object.values(state.conflicts).map((remote) => {
    const local = state.games[remote.id] ?? remote;
    return {
      ...local,
      profileName: data.profiles.length > 1
        ? data.profiles.find(({ id }) => id === local.profileId)?.name
        : undefined,
    };
  });
  const syncStatus = conflictGames.length ? (
    <SyncConflictMenu
      games={conflictGames}
      onOpen={(game) => {
        chooseGame(game.id);
        setReviewConflictId(game.id);
      }}
    />
  ) : (
    <span
      className={`sync-status ${!state.online || hasSaveError ? "offline" : ""}`}
      title={saveError || state.error || "Games are saved on your server"}
    >
      {hasSaveError ? (
        <Info size={14} />
      ) : !state.online ? (
        <CloudOff size={14} />
      ) : pending ? (
        <LoaderCircle className="spin" size={14} />
      ) : (
        <CheckCheck size={15} />
      )}
      <span>
        {hasSaveError
          ? "Save rejected"
          : !state.online
            ? "Saved on this device"
            : pending
              ? "Saving…"
              : "All changes saved"}
      </span>
    </span>
  );
  const boardLegend = game && (
    <div className="board-legend">
      {game.archivedBoard &&
        game.archived &&
        game.board.some(
          (tile, i) => tile && tile !== game.archivedBoard![i],
        ) && (
          <span>
            <i className="archive-edit" />
            Edited after archiving
          </span>
        )}
      {[
        "TW",
        "DW",
        "TL",
        "DL",
        ...(game.template.premiums.some((p) => p === "QW" || p === "QL")
          ? ["QW", "QL"]
          : []),
      ].map((p) => (
        <span key={p}>
          <i className={p.toLowerCase()} />
          {p[0] === "T" ? "Triple" : p[0] === "Q" ? "Quadruple" : "Double"}{" "}
          {p[1] === "W" ? "word" : "letter"}
        </span>
      ))}
    </div>
  );
  const boardHistoryControls = game && (
    <BoardHistoryControls
      canUndo={!boardLocked && !!game.past.length}
      canRedo={!boardLocked && !!game.future.length}
      onUndo={undoGame}
      onRedo={redoGame}
    />
  );
  const boardModeHistory = game && (
    <div className="board-mode-history">{boardHistoryControls}</div>
  );
  const boardWarnings = warnings.length > 0 && (
    <div className="board-warnings" role="alert">
      {warnings.map((warning, index) => (
        <p key={warning}>
          {index === 0 && <TriangleAlert size={14} aria-hidden="true" />}
          {warning}
        </p>
      ))}
    </div>
  );
  return (
    <div
      ref={shell}
      className={[
        "app-shell",
        workspace === "games" && (compactGame ? "compact-game" : "stacked-game"),
        narrowLayout && "phone-layout",
        sidebarOverlay && "sidebar-overlay",
        !sidebarVisible && "sidebar-collapsed",
      ].filter(Boolean).join(" ")}
      data-static-previews={preferences.pulseMovePreviews ? undefined : true}
      data-premium-palette={premiumPalette(
        workspace === "games" ? game?.platform : undefined,
      )}
    >
      {sidebarOverlay && sidebarVisible && (
        <div
          className="sidebar-scrim"
          onClick={() => changeSidebarVisibility(false)}
        />
      )}
      <aside
        id="tilemaxx-sidebar"
        aria-label="Sidebar"
        className="sidebar"
        hidden={!sidebarVisible}
        onKeyDown={(event) => {
          if (
            sidebarOverlay &&
            event.key === "Escape" &&
            !event.defaultPrevented
          )
            changeSidebarVisibility(false);
        }}
      >
        <div className="sidebar-heading">
          <Brand />
          <button
            ref={sidebarCollapseButton}
            type="button"
            className="icon-button sidebar-collapse"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            aria-controls="tilemaxx-sidebar"
            onClick={() => changeSidebarVisibility(false)}
          >
            <Menu size={20} aria-hidden="true" />
          </button>
        </div>
        <button
          className="button new-game"
          disabled={!state.online}
          title={state.online ? undefined : "A server connection is required"}
          onClick={() => openDialog(profile ? "new" : "profile")}
        >
          <Plus size={18} />
          {profile ? "New game" : "New profile"}
        </button>
        <div className="sidebar-divider" />
        {workspaceLinks.map(([section, label, Icon]) => (
          <a
            key={section}
            href={routeHref(workspaceRoute(section))}
            className="nav-link"
            aria-current={section === (viewingArchivedGame ? "archive" : workspace) ? "page" : undefined}
            onClick={(event) => followRoute(event, () => showWorkspace(section))}
          >
            <Icon size={18} aria-hidden="true" />
            {label}
          </a>
        ))}
        {toolLinks.map(([tool, label, Icon]) => (
          <a
            key={tool}
            href={routeHref(toolRoute(tool))}
            className="nav-link"
            aria-keyshortcuts={tool === "keyboard-shortcuts" ? "?" : undefined}
            onClick={(event) => followRoute(event, () => openTool(tool))}
          >
            <Icon size={18} aria-hidden="true" />
            {label}
          </a>
        ))}
        <div className="sidebar-bottom">
          <div className="workspace-controls">
            <OfflineStatus
              game={savedGame}
              games={data?.games}
              openGameId={openId}
              online={state.online}
              storageError={state.storageError}
            />
            {sidebarVisible && syncStatus}
            <div className="workspace-settings-row">
              <button
                className="icon-button workspace-settings-button"
                type="button"
                aria-label="Settings"
                title="Settings"
                onClick={() => openTool("workspace-settings")}
              >
                <Settings size={15} aria-hidden="true" />
              </button>
              <span className="app-version">
                v{version}
                {!preferences.autoUpdate && appUpdate.availableVersion && (
                  <button
                    type="button"
                    className="app-update-icon"
                    disabled={updateBusy || appUpdate.updating}
                    aria-label="Update and reload"
                    aria-description={`Version ${appUpdate.availableVersion} is available.`}
                    onClick={appUpdate.requestUpdate}
                  >
                    <CircleArrowUp size={14} aria-hidden="true" />
                    <span className="app-update-tooltip" aria-hidden="true">
                      {appUpdate.updating
                        ? "Updating…"
                        : updateBusy
                          ? "Update available when Tilemaxx is idle"
                          : "Update and reload"}
                    </span>
                  </button>
                )}
              </span>
            </div>
            {!preferences.autoUpdate && appUpdate.updateError && (
              <p className="app-update-error" role="status">{appUpdate.updateError}</p>
            )}
          </div>
          <div className="profile-picker">
            {profile && (
              <button
                className="avatar"
                type="button"
                aria-label="Edit current profile"
                title="Edit profile"
                onClick={() => openDialog("rename-profile")}
              >
                {profileLetter}
                <small>{tileScore(profileLetter, "scrabble")}</small>
              </button>
            )}
            <span>
              <small>PLAYING AS</small>
              <span className="profile-select">
                <select
                  aria-label="Current profile"
                  value={profileId}
                  onChange={({ currentTarget }) => {
                    if (currentTarget.value === "new") {
                      openDialog("profile");
                      return;
                    }
                    selectProfile(currentTarget.value);
                    currentTarget.blur();
                  }}
                >
                  {!profile && (
                    <option value="" disabled>
                      Select a profile
                    </option>
                  )}
                  {data.profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                  <option value="new">+ New profile</option>
                </select>
                <ChevronDown size={12} aria-hidden="true" />
              </span>
            </span>
          </div>
        </div>
      </aside>
      <main className="main-content">
        {workspace === "games" && (
          <header className="workspace-heading game-heading">
            {sidebarButton}
            <div className="game-title-row">
              {selectedGame?.archived ? (
                <div className="archived-game-title game-picker-trigger-line">
                  <h1 title={selectedGame.name}>{selectedGame.name}</h1>
                  {!selectedGame.fullMoveHistory && <IncompleteMoveHistoryIcon />}
                </div>
              ) : (
                <GamePicker
                  ref={gamePicker}
                  key={profileId}
                  game={selectedGame}
                  headingMetadata={headingMetadata}
                  games={activeGames}
                  onChoose={chooseGame}
                  onReorder={(ids) => store.reorderGames(profileId, ids)}
                />
              )}
            </div>
            {headlineScore}
            {savedGame && (
              <button
                ref={gameOptionsButton}
                type="button"
                className="icon-button game-options-button"
                aria-label="Game options"
                aria-haspopup="dialog"
                title="Game options"
                onClick={() => openDialog("manage")}
              >
                <MoreHorizontal size={18} aria-hidden="true" />
              </button>
            )}
            {headingMetadata && (
              <span className="game-heading-metadata" title={headingMetadata}>
                {headingMetadata}
              </span>
            )}
          </header>
        )}
        {state.storageError && (
          <div className="banner warning">
            Browser storage is full or disabled. Keep this tab open until the
            server confirms your changes are saved.
          </div>
        )}
        {conflict && game && (
          <div className="banner warning" ref={conflictBanner} tabIndex={-1}>
            <span>
              This game changed on another device. Your edits are safe here.
            </span>
            <button onClick={() => store.acceptRemote(game.id)}>
              Use server version
            </button>
            <button
              disabled={formBusy || !state.online}
              title={state.online ? undefined : "A server connection is required"}
              onClick={() =>
                void action(async () => {
                  const copy = await store.preserveCopy(game.id);
                  if (copy) chooseGame(copy.id);
                })
              }
            >
              Save my edits as a copy
            </button>
          </div>
        )}
        {saveError && game && (
          <div className="banner warning" role="alert">
            <span>Could not save this game. {saveError}</span>
            <button onClick={() => store.retrySave(game.id)}>Retry save</button>
          </div>
        )}
        {!state.online && (
          <div className="banner warning">
            Server connection lost. Edits stay on this device and will sync when
            the connection returns. Creating games requires a connection.
            <button onClick={() => void store.refresh()}>Reconnect</button>
          </div>
        )}
        {error && !dialog && (
          <div role="alert" className="banner warning">
            {error}
            <button
              className="icon-button"
              onClick={() => setError("")}
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {workspace === "studio" ? (
          <BoardStudio
            headerControl={sidebarButton}
            templateId={route.template}
            onEdit={(template) => navigate({ ...route, template })}
            onCloseEditor={() => closeOverlay({ ...route, template: undefined })}
            onDelete={async (id) => {
              await store.deleteTemplate(id);
              notify(
                "Custom board deleted. Existing games keep their layouts.",
              );
            }}
            templates={data.templates}
            onBack={openMyGames}
            onSave={async (template, editing) => {
              if (editing) await store.updateTemplate(template);
              else await store.saveTemplate(template);
              notify(
                editing
                  ? "Board updated for future games."
                  : "Board saved. Choose it when creating a new game.",
              );
            }}
          />
        ) : workspace === "archive" ? (
          <ArchivedGames
            filterRef={archiveFilter}
            headerControl={sidebarButton}
            games={archivedGames}
            dictionaries={data.dictionaries}
            sort={route.sort ?? "date"}
            onSort={(sort) => navigate({ ...route, profileId, sort: sort === "date" ? undefined : sort })}
            onOpen={chooseGame}
            onEdit={(id) => {
              setArchiveEditId(id);
              setDialog("rename");
            }}
            onBack={openMyGames}
          />
        ) : workspace === "stats" ? (
          <ArchiveStats
            key={profileId}
            headerControl={sidebarButton}
            games={archivedGames}
            view={route.stats}
            onChangeView={(stats) => navigate({ ...route, profileId, stats })}
            onBack={openMyGames}
          />
        ) : game ? (
          <GameWorkspace
            definitionRules={game.template.rules}
            positionKey={signature}
            narrow={narrowLayout}
            resizeDisabled={!!activeFlight}
            reviewing={moveReview.showing}
            replaying={!!replay}
            hasWarnings={warnings.length > 0}
          >
            <GameBoardColumn
              phone={narrowLayout}
              live={!game.archived && !replay}
              drawShelf={replayDrawShelf}
              resizeDisabled={!!activeFlight}
              warnings={boardWarnings}
              board={(replayDetails) => <section
                ref={boardPanel}
                aria-label="Game board"
                aria-description={boardTurns.label}
                className="board-panel panel"
                data-alternative-preview={!!alternativePreview || undefined}
                data-replay={historical || undefined}
                data-turn={boardTurns.player}
                data-turn-border={preferences.boardTurnBorder}
                onKeyDown={(event) => {
                  if (
                    !historical &&
                    !boardLocked &&
                    squareFilter.selecting &&
                    event.key === "Escape"
                  ) {
                    event.preventDefault();
                    finishSquareSelection();
                  }
                }}
              >
                {historical && replay ? (
                  <div className="last-play-lane">
                    <div className="last-play-row">
                      <span>{trial ? `Trial from move ${replay.index || 1}` : `Before move ${replay.index || 1}`}</span>
                      {replay.frame.board && replay.rackLayout?.incomplete && (
                        <span className="replay-rack-incomplete">Rack incomplete</span>
                      )}
                      {trial && (
                        <button type="button" className="text-button" onClick={() => {
                          editPosition();
                          gameReplay.backToTurn();
                        }}>Back to move {replay.index || 1}</button>
                      )}
                    </div>
                  </div>
                ) : <LastPlay
                  game={activeFlight?.before ?? game}
                  bag={activeFlight?.bag ?? replyAnalysis}
                  reserveSpace={narrowLayout}
                />}
                {!narrowLayout && boardWarnings}
                <BoardEntry
                  ref={boardEntry}
                  key={`${game.id}:${enteringOwnPlay ? "own-play" : "board"}`}
                  game={game}
                  skipPlayedTiles={preferences.skipPlayedTiles}
                  phoneLayout={narrowLayout}
                  hideHelp
                  preview={boardLocked ? null : activeFlight?.move ?? preview ?? alternativePreview ?? recordedPreview ?? null}
                  previewPlayer={activeFlight ? "you" : movePreview?.player ?? ((alternativePreview || recordedPreview) ? replay?.frame.move?.player : undefined)}
                  definePreview={historical}
                  readOnly={boardLocked}
                  displayBoard={activeFlight?.before.board}
                  trialBase={trial ? replay?.frame.board : undefined}
                  onChange={updateAfterTurn}
                  overlay={
                    boardUnavailable ? (
                      <div className="replay-board-unavailable" role="status">Board unavailable for this move</div>
                    ) : gameFinish.current && (
                      <BoardFinishOverlay
                        key={gameFinish.current.animation}
                        finish={gameFinish.current.result}
                        onDismiss={gameFinish.dismiss}
                        onArchive={
                          game.archived
                            ? undefined
                            : () => {
                                gameFinish.dismiss();
                                editPosition();
                                update(archiveForReview(game));
                                notify("Game archived.");
                              }
                        }
                      />
                    )
                  }
                  onSelect={() => {
                    boardTurns.dismiss?.();
                    editPosition();
                  }}
                  onSolve={hasPlayableRack && !activeFlight ? solve : undefined}
                  storedDraft={draft}
                  ownPlay={enteringOwnPlay ? {
                    onPlay: (move) => play(move, { useRackMarks: false }),
                    onRecordAnyway: (correction) => play(correction.move, { correction }),
                    onCancel: cancelOwnPlay,
                    onFixRack: () => rackEntry.current?.focusEntry(),
                  } : undefined}
                  historyControls={
                    !moveReview.showing &&
                    !squareFilter.selecting &&
                    boardHistoryControls
                  }
                  turnActions={moveReview.showing ? undefined : boardTurns.controls}
                  turnHint={boardTurns.rackExchange ? "Select tiles to exchange" : undefined}
                  statusAction={
                    compactGame && !historical && !game.archived && !boardLocked && !game.board.some(Boolean) && (
                      <button
                        type="button"
                        className="icon-button board-import"
                        aria-label="Import screenshot"
                        aria-haspopup="dialog"
                        title="Import screenshot"
                        onClick={() => openDialog("screenshot")}
                      >
                        <ImagePlus size={16} aria-hidden="true" />
                      </button>
                    )
                  }
                  moveFilter={{
                    marks: squareFilter.marks,
                    onToggle: squareFilter.selecting ? (index) => {
                      squareFilter.toggle(index);
                      setPreview(null);
                    } : undefined,
                  }}
                />
                {squareFilter.selecting ? (
                  <MoveSquareFilterControls
                    count={squareFilter.marks.size}
                    onDone={finishSquareSelection}
                    onClear={() => {
                      squareFilter.clear();
                      setPreview(null);
                    }}
                    historyControls={boardModeHistory}
                  />
                ) : moveReview.showing && (
                  <div className="board-review-actions">
                    <span aria-live="polite">
                      {preview ? (
                        <>
                          <strong><MoveWord move={preview} rules={game.template} /></strong> · {preview.score} pts
                        </>
                      ) : (
                        "Choose a move to preview"
                      )}
                    </span>
                    {boardTurns.controls}
                    {boardModeHistory}
                    {!movePreview?.analysis && (
                      <button
                        className="board-review-play"
                        data-move-preview-action
                        type="button"
                        disabled={boardLocked || !preview || !!activeFlight}
                        onClick={() => preview && play(preview)}
                      >
                        <span className="button primary">Play</span>
                      </button>
                    )}
                  </div>
                )}
                {boardTurns.details}
                {replay && (
                  <ReplayControls
                    {...replay}
                    archived={!!savedGame?.archived}
                    detailsTarget={replayDetails}
                    onToggleAlternative={() => {
                      setPreview(null);
                      setOwnPlay(undefined);
                      if (moveReview.showing) moveReview.dismiss();
                      replay.toggleAlternative();
                      if (!alternativePreview)
                        boardPanel.current?.querySelector(".board-entry")?.scrollIntoView?.({ block: "nearest" });
                    }}
                    onToggleRecorded={() => {
                      setPreview(null);
                      setOwnPlay(undefined);
                      if (moveReview.showing) moveReview.dismiss();
                      replay.toggleRecorded();
                    }}
                  />
                )}
              </section>}
              rack={(detailsTarget) => <section
                ref={rackPanel}
                aria-label="Your rack"
                className="rack-panel panel"
                onFocusCapture={() => {
                  if (activeFlight) setFlight(undefined);
                }}
              >
                <RackEntry
                  key={game.id}
                  ref={rackEntry}
                  game={game}
                  onChange={(next) =>
                    updateAfterTurn(
                      rackComposition(next.rack) !== rackComposition(game.rack)
                        ? recordOpponentRackOut(next)
                        : next,
                    )
                  }
                  onSolve={solve}
                  phoneLayout={narrowLayout}
                  onReviewEdit={moveReview.showing ? editPosition : undefined}
                  detailsTarget={detailsTarget}
                  onEnterOwnPlay={canEnterOwnPlay && !enteringOwnPlay ? startOwnPlay : undefined}
                  positionKey={signature}
                  exchangeAdvice={exchangeAdvice}
                  bagCount={replyAnalysis.bagSize}
                  bagConfirmed={replyAnalysis.bagConfirmed}
                  tileCountsInvalid={replyAnalysis.invalid}
                  exchangeScorelessTurns={replyAnalysis.scorelessTurns}
                  opponentRack={historical && !trial ? "" : replyAnalysis.opponentRack}
                  preview={
                    recordedPreview ?? alternativePreview ?? (preferences.highlightRackPreview && movePreview?.player !== "opponent" ? preview : null)
                  }
                  flyingRack={activeFlight}
                  replayFrame={historical && (!trial || boardUnavailable) ? replay?.frame : undefined}
                  recordedPreview={!!recordedPreview}
                  replayRackLayout={replay?.rackLayout}
                  drawShelf={replayDrawShelf}
                  recordingExchange={boardTurns.rackExchange}
                />
              </section>}
            />
            <div className="results-column">
              {gameOver ? (
                <section className="results-panel game-over panel" aria-label="Possible moves">
                  <h3>Game over</h3>
                  <button type="button" className="button secondary" onClick={resumeGame}>
                    Resume game
                  </button>
                </section>
              ) : (
                <Results
                  compact={compactGame}
                  results={solver.results}
                  findMovesRequest={findMovesRequest}
                  playingStyle={playingStyle}
                  onPlayingStyleChange={selectPlayingStyle}
                  styleSample={styleSample}
                  onResampleStyle={resampleStyle}
                  navigation={moveListNavigation}
                  exchangeAction={
                    exchangeAdvice &&
                    !activeFlight && (
                      <ExchangeSuggestion
                        advice={exchangeAdvice}
                        rack={game.rack}
                        onOpen={() => {
                          if (moveReview.showing) editPosition();
                          rackEntry.current?.openSuggestedExchange(narrowLayout);
                        }}
                        inHeader
                      />
                    )
                  }
                  fetchPage={solver.page}
                  fetchShortlist={solver.shortlist}
                  runBingoHunter={solver.runBingoHunter}
                  busy={busy}
                  calculating={solver.calculating || styleExchange.pending}
                  initialCalculating={solver.initialCalculating}
                  timing={solver.timing}
                  onTimingComplete={
                    solver.startedAt !== undefined && searchId !== undefined
                      ? (stoppedAt, analysis) => solver.finishTiming(searchId, stoppedAt, analysis)
                      : undefined
                  }
                  error={solver.error}
                  size={game.template.size}
                  bingoRules={game.template}
                  preview={preview}
                  requiredSquares={squareFilter.requiredSquares}
                  squareFilter={{
                    active: squareFilter.selecting,
                    disabled: boardLocked,
                    onToggle: toggleSquareSelection,
                  }}
                  optionsButtonRef={moveOptionsButton}
                  onPreview={previewMove}
                  phoneLayout={narrowLayout}
                  onPlay={play}
                  onSolve={solve}
                  onCancelSearch={solver.cancelSearch}
                  onCloseResults={() => {
                    editPosition();
                    solver.closeResults(!replyAnalysis.calculating);
                  }}
                  hasRack={hasPlayableRack}
                  analysisGame={game}
                  analysisKey={signature}
                  replyAnalysis={replyAnalysis}
                  replyEnabled={!game.solo}
                  rackOdds={solver.rackOdds}
                  defense={solver.defense}
                  defenseProgress={
                    solver.defenseProgress === undefined
                      ? undefined
                      : `${solver.defenseProgress}/${Math.min(solver.results?.total ?? 0, DEFENSE_LIMIT)}`
                  }
                  rackOddsPending={solver.rackOddsPending}
                  boardOdds={solver.boardOdds}
                  boardOddsProgress={solver.boardOddsProgress}
                  boardOddsError={solver.boardOddsError}
                  onBoardOdds={(candidates, bagSize) =>
                    solver.runBoardOdds(game, candidates, bagSize, workerLimit)
                  }
                  onCancelBoardOdds={solver.cancelBoardOdds}
                />
              )}
              <Activity mode={replay ? "hidden" : "visible"}>{gameScores}</Activity>
              {replay && savedGame && (
                <ReplayScores
                  {...replay}
                  sourceGame={savedGame}
                  solo={game.solo}
                  finalScoring={!historical ? (savedGame?.archivedState ?? savedGame)?.scoring : undefined}
                  finalOutcome={!historical ? gameFinish.score?.outcome : undefined}
                />
              )}
              {!narrowLayout && !replay && (
                <div className="companion-note">
                  <span className="note-icon">
                    <BookOpen size={19} />
                  </span>
                  <div>
                    <h3>A companion to your game.</h3>
                    <p>
                      {game.solo
                        ? "Play a suggestion or enter your own play, then refill your rack."
                        : "Play a suggestion, enter your opponent’s move, then refill your rack. We’ll remember where you left off."}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </GameWorkspace>
        ) : selectedGame ? (
          <section className="welcome-panel panel" aria-label="Game board">
            <GameLoadStatus
              id={selectedGame.id}
              error={state.loadErrors[selectedGame.id]}
            />
          </section>
        ) : route.gameId ? (
          <section className="welcome-panel panel" aria-label="Game board">
            <p role="status">This game is unavailable.</p>
            <button className="button secondary" onClick={openMyGames}>Back to games</button>
          </section>
        ) : (
          <div className="welcome-panel panel">
            <div className="illustrated-tiles">
              <span>
                H<small>4</small>
              </span>
              <span className="illustrated-tile-green">
                I<small>1</small>
              </span>
            </div>
            <h2>A board full of possibilities.</h2>
            <p>
              {profile
                ? `Create a game for ${profile.name} to get started.`
                : "Create a profile to start saving games."}
            </p>
            <button
              className="button primary"
              onClick={() => openDialog(profile ? "new" : "profile")}
            >
              <Plus size={16} />
              {profile ? "Create a game" : "Create a profile"}
            </button>
          </div>
        )}
        <footer className="workspace-footer">
          {!narrowLayout && <span>Less guessing. More good words.</span>}
          {openId && <GameId id={openId} onNotice={notify} />}
          <div className="workspace-footer-meta">
            {!narrowLayout && <span>Tilemaxx · Local & personal</span>}
            <button
              type="button"
              className="text-button dictionary-sources-button"
              aria-haspopup="dialog"
              onClick={() => openDialog("dictionary-sources")}
            >
              Dictionary sources
            </button>
          </div>
        </footer>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {dialog === "screenshot" && importBase.current && (
        <ScreenshotImport
          template={importBase.current.template}
          onClose={() => setDialog(null)}
          onApply={(board, premiums, clearBoard) => {
            const base = importBase.current!;
            const latest = store.getSnapshot().games[base.id];
            if (
              !latest ||
              latest.board.join(".") !== base.board.join(".") ||
              latest.template.premiums.join(".") !== base.template.premiums.join(".")
            )
              throw new Error(
                "The board changed while you were reviewing. Close this import and try again with the latest game.",
              );
            replay?.close();
            updateSavedGame(importBoard(latest, board, premiums, clearBoard));
            setDialog(null);
            notify(
              clearBoard
                ? "Premium squares imported. Score tracking is on."
                : "Screenshot imported. You can undo this change.",
            );
          }}
        />
      )}
      {dialog === "new" && (
        <NewGameDialog
          profileId={profileId}
          profileName={profile?.name}
          templates={data.templates}
          dictionaries={data.dictionaries}
          currentDictionaryId={game?.dictionaryId}
          opponentSuggestions={recentOpponentNames(data.games, profileId)}
          phoneLayout={narrowLayout}
          online={state.online}
          onCreate={async (input) => {
            const created = await store.createGame(input);
            chooseGame(created.id);
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {(dialog === "profile" ||
        (dialog === "rename-profile" && editProfile)) && (
        <Modal
          title={
            dialog === "rename-profile"
              ? "Edit profile"
              : "Make yourself at home."
          }
          subtitle={
            dialog === "rename-profile"
              ? "Your new name will appear on all your devices. Your games stay with this profile."
              : "Pick the same profile on every device to find your games."
          }
          onClose={() => {
            if (!formBusy) setDialog(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                if (dialog === "rename-profile") {
                  await store.renameProfile(editProfileId, formName.trim());
                  notify("Profile renamed.");
                } else {
                  const p = await store.createProfile(formName.trim());
                  selectProfile(p.id);
                }
                setDialog(null);
              });
            }}
          >
            <label>
              Profile name
              <input
                autoFocus
                required
                maxLength={80}
                placeholder="Your name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </label>
            <p className="small muted">
              Profiles organize games. Everyone on this home server can select
              any profile.
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <footer className="modal-footer">
              {dialog === "rename-profile" && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={formBusy}
                  onClick={() => openDialog("delete-profile")}
                >
                  Delete profile…
                </button>
              )}
              <button
                className="button primary"
                disabled={formBusy || !formName.trim()}
              >
                {formBusy
                  ? "Saving…"
                  : dialog === "rename-profile"
                    ? "Save name"
                    : "Create profile"}
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {dialog === "delete-profile" && editProfile && (
        <Modal
          title="Delete profile?"
          onClose={() => {
            if (!formBusy) setDialog(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (formBusy || formName !== editProfile.name) return;
              void action(async () => {
                await store.deleteProfile(editProfile.id, formName);
                if (editProfile.id === profileId)
                  navigate({ workspace }, true);
                setDialog(null);
                notify("Profile deleted.");
              });
            }}
          >
            <p>
              This permanently deletes the profile and all its active and
              archived games from every device.
            </p>
            <label>
              Type <strong>{editProfile.name}</strong> to confirm
              <input
                data-initial-focus
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <footer className="modal-footer">
              <button
                type="button"
                className="button secondary"
                disabled={formBusy}
                onClick={() => {
                  setFormName(editProfile.name);
                  setError("");
                  setDialog("rename-profile");
                }}
              >
                Keep profile
              </button>
              <button
                className="button danger"
                disabled={formBusy || formName !== editProfile.name}
              >
                {formBusy ? "Deleting…" : "Delete permanently"}
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {dialog === "rename" && (editGame || editingArchive) && (
        <Modal title="Edit game details" onClose={() => setDialog(null)}>
          {editGame ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                updateSavedGame({ ...editGame, ...readGameDetails(e.currentTarget, editGame.solo) });
                setDialog(null);
              }}
            >
              <GameDetailFields key={editGame.id} game={editGame} />
              <footer className="modal-footer">
                <button className="button primary">Save details</button>
              </footer>
            </form>
          ) : (
            editingArchive && (
              <GameLoadStatus
                id={editingArchive.id}
                error={state.loadErrors[editingArchive.id]}
              />
            )
          )}
        </Modal>
      )}
      {dialog === "board-help" && game && (
        <Modal
          title="Board help"
          subtitle={describeGameBoard(game)}
          onClose={() => setDialog(null)}
        >
          <div className="board-help-dialog">
            <BoardEntryHelp />
            {boardLegend}
          </div>
        </Modal>
      )}
      {dialog === "history" && savedGame && (
        <Modal
          title="Your moves, remembered."
          subtitle="Undo restores the board and rack from before a move or board edit."
          onClose={() => setDialog(null)}
        >
          {!savedGame.past.length ? (
            <div className="empty-history">
              <History size={28} />
              <p>No moves yet. Your next word starts the story.</p>
            </div>
          ) : (
            <ol className="history-list">
              {[...savedGame.past].reverse().map((h, i) => (
                <li key={`${h.at}-${i}`}>
                  <span className="history-number">{savedGame.past.length - i}</span>
                  <div>
                    <strong>{h.label}</strong>
                    <small>
                      {h.player &&
                        (h.player === "you" ? "You · " : "Opponent · ")}
                      {new Date(h.at).toLocaleString()} · rack{" "}
                      {h.rack.replaceAll(".", "·") || "empty"}
                    </small>
                  </div>
                  {h.score !== undefined && (
                    <b>
                      {h.score}
                      <small>pts</small>
                    </b>
                  )}
                </li>
              ))}
            </ol>
          )}
          <footer className="modal-footer">
            <button
              className="button secondary"
              disabled={!!gameFinish.current || !savedGame.future.length}
              onClick={() => changeSavedGameHistory("redo")}
            >
              <Redo2 size={16} />
              Redo
            </button>
            <button
              className="button primary"
              disabled={!!gameFinish.current || !savedGame.past.length}
              onClick={() => changeSavedGameHistory("undo")}
            >
              <Undo2 size={16} />
              Undo last change
            </button>
          </footer>
        </Modal>
      )}
      {dialog === "dictionaries" && (
        <WordLists
          dictionaries={data.dictionaries}
          selectedId={savedGame?.dictionaryId}
          onClose={closeTool}
          onNotify={notify}
        />
      )}
      {dialog === "dictionary-sources" && (
        <Modal
          title="Dictionary sources"
          className="dictionary-sources"
          onClose={() => setDialog(null)}
        >
          <p>
            Wiktionary definitions are written by contributors to{" "}
            <a
              href="https://en.wiktionary.org/"
              target="_blank"
              rel="noreferrer"
            >
              English Wiktionary
            </a>{" "}
            and made available under{" "}
            <a
              href="https://creativecommons.org/licenses/by-sa/4.0/"
              target="_blank"
              rel="noreferrer"
            >
              CC BY-SA 4.0
            </a>
            .
          </p>
          <p>
            The import uses{" "}
            <a href="https://kaikki.org/" target="_blank" rel="noreferrer">
              Kaikki’s Wiktextract exports
            </a>.
            Tilemaxx displays selected glosses and folds accents for lookup.
            Each Wiktionary headword in a tooltip links to its source entry.
          </p>
        </Modal>
      )}
      {dialog === "word-list-checker" && (
        <WordListChecker
          dictionaries={data.dictionaries}
          selectedId={route.wordList ?? game?.dictionaryId}
          onSelectList={(wordList) => navigate({ ...route, wordList })}
          onClose={closeTool}
        />
      )}
      {dialog === "ui-guide" && (
        <UiGuide
          phoneLayout={narrowLayout}
          selectedView={route.guide}
          onSelectView={(guide) => navigate({ ...route, guide })}
          onClose={closeTool}
        />
      )}
      {dialog === "keyboard-shortcuts" && (
        <KeyboardShortcuts phoneLayout={narrowLayout} onClose={closeTool} />
      )}
      {dialog === "workspace-settings" && (
        <WorkspaceSettings
          theme={theme}
          onThemeChange={changeTheme}
          preferences={preferences}
          concurrencyHint={concurrencyHint}
          workerLimit={workerLimit}
          onChange={setPreferences}
          onClose={closeTool}
        />
      )}
      {dialog === "help" && (
        <Modal
          title="Same game. Any screen."
          subtitle="Open Tilemaxx on your iPhone or Mac, then choose the same profile."
          onClose={closeTool}
        >
          <div className="device-illustration">
            <Monitor size={44} />
            <span>↔</span>
            <Smartphone size={34} />
          </div>
          <ol className="help-steps">
            <li>Connect both devices to your home Wi-Fi.</li>
            <li>
              Open your NAS’s Tilemaxx address in Safari. While testing on the
              Mac, use its local network address and port 4173.
            </li>
            <li>
              Select <strong>{profile?.name}</strong>, then your game. Wait for
              “All changes saved” before switching devices.
            </li>
          </ol>
          <div className="address-box">
            <span>{location.origin}</span>
            <button
              className="icon-button"
              aria-label="Copy current address"
              onClick={() => {
                if (navigator.clipboard)
                  void navigator.clipboard
                    .writeText(location.origin)
                    .then(() => notify("Address copied."))
                    .catch(() =>
                      notify("Select and copy the address shown here."),
                    );
                else notify("Select and copy the address shown here.");
              }}
            >
              <Copy size={16} />
            </button>
          </div>
          {location.hostname === "localhost" && (
            <p className="small muted">
              “localhost” opens this Mac only. On iPhone, replace it with your
              Mac’s network IP address.
            </p>
          )}
          <p className="small muted">
            In Safari on iPhone, Share → Add to Home Screen gives you a handy
            shortcut. This app uses simple profiles and is intended for your
            trusted home network.
          </p>
        </Modal>
      )}
      {dialog === "delete" && savedGame && (
        <Modal
          title="Delete this game?"
          subtitle={savedGame.name}
          onClose={() => {
            if (!formBusy) setDialog(null);
          }}
        >
          <p>
            This permanently deletes this game’s board, rack and move history
            from all devices. It cannot be undone. Your profile and saved board
            templates stay available.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <footer className="modal-footer">
            <button
              className="button secondary"
              disabled={formBusy}
              onClick={() => setDialog(null)}
            >
              Keep game
            </button>
            <button
              className="button danger"
              disabled={formBusy}
              onClick={() =>
                void action(async () => {
                  await store.deleteGame(savedGame.id);
                  setDialog(null);
                  navigate({ workspace: "games", profileId }, true);
                  notify("Game deleted.");
                })
              }
            >
              {formBusy ? "Deleting…" : "Delete permanently"}
            </button>
          </footer>
        </Modal>
      )}
      {dialog === "end-game" && game && !gameOver && !game.archived && (
        <EndGameDialog
          key={game.id}
          game={game}
          bagEmpty={replyAnalysis.bagSize === 0}
          onEnd={(next, archive) => {
            editPosition();
            if (busy) solver.cancelSearch();
            solver.cancelBoardOdds();
            updateSavedGame(archive ? archiveForReview(next) : next);
            if (archive)
              chooseGame(
                activeGames.find((item) => item.id !== next.id)?.id ?? "",
              );
            setDialog(null);
            notify(
              archive
                ? "Game ended and archived."
                : "Game ended.",
            );
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "manage" && savedGame && (
        <GameOptions
          key={savedGame.id}
          game={savedGame}
          board={describeGameBoard(savedGame)}
          dictionaries={data.dictionaries}
          online={state.online}
          boardLocked={!!gameFinish.current}
          onUpdate={(next) => {
            replay?.close();
            updateSavedGame(next);
          }}
          onChooseGame={chooseGame}
          onResume={resumeGame}
          onArchived={() =>
            chooseGame(activeGames.find((item) => item.id !== savedGame.id)?.id ?? "")
          }
          onOpen={(next) => {
            if (next === "end-game") replay?.close();
            if (next === "dictionaries") {
              setDialog(null);
              openTool(next);
            } else openDialog(next);
          }}
          onReplay={canReplayGame && !historical ? () => {
            gameReplay.open(gameOptionsButton.current);
            setDialog(null);
          } : undefined}
          onClose={() => setDialog(null)}
          notify={notify}
        />
      )}
    </div>
  );
}
