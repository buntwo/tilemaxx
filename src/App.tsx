import { isSimulatedStyle } from "../shared/simulated-styles";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ImagePlus,
  ArrowLeft,
  ArrowRight,
  ChartNoAxesCombined,
  CircleArrowUp,
  BookOpen,
  Check,
  CheckCheck,
  CloudOff,
  Copy,
  Focus,
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
} from "./components/BoardEntry";
import BoardFinishOverlay from "./components/BoardFinishOverlay";
import LastPlay, { type LastPlayBag } from "./components/LastPlay";
import { useGameFinish } from "./useGameFinish";
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
import ArchivedGames, { type ArchiveSort } from "./components/ArchivedGames";
import ArchiveStats from "./components/ArchiveStats";
import SyncConflictMenu from "./components/SyncConflictMenu";
import GameScoreBadge from "./components/GameScoreBadge";
import GameScores from "./components/GameScores";
import GameOptions from "./components/GameOptions";
import EndGameDialog from "./components/EndGameDialog";
import {
  playTrackedMove,
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
import { useWorkspaceLayout } from "./useWorkspaceLayout";
import { store, useStore } from "./store";
import { premiumPalette } from "./premium-palettes";
import NewGameDialog from "./components/NewGameDialog";
import {
  type BoardTemplate,
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

type Dialog =
  | "screenshot"
  | "new"
  | "dictionaries"
  | "dictionary-sources"
  | "word-list-checker"
  | "profile"
  | "rename-profile"
  | "delete-profile"
  | "history"
  | "board-help"
  | "help"
  | "ui-guide"
  | "keyboard-shortcuts"
  | "workspace-settings"
  | "rename"
  | "delete"
  | "end-game"
  | "manage"
  | null;
const workspaceHashes = {
  games: "",
  archive: "#archived-games",
  stats: "#stats",
  studio: "#board-studio",
} as const;
type Workspace = keyof typeof workspaceHashes;
type TileFlight = NonNullable<ReturnType<typeof prepareTileFlight>> & {
  before: Game;
  bag: LastPlayBag;
  destination: string;
  move: Move;
  reviewing: boolean;
};

function currentWorkspace(): Workspace {
  if (location.hash === workspaceHashes.archive) return "archive";
  if (location.hash === workspaceHashes.stats) return "stats";
  if (location.hash === workspaceHashes.studio) return "studio";
  return "games";
}

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
  const squareFilterButton = useRef<HTMLButtonElement>(null);
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
  const [profileId, setProfileId] = useState(saved("tilewise:profile")),
    [gameId, setGameId] = useState(saved("tilewise:game"));
  const [dialog, setDialog] = useState<Dialog>(null),
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
  const [theme, setTheme] = useState(saved("tilewise:theme", "system"));
  const [preferences, setPreferences] = preferenceState;
  const [movePreview, setPreview] = useState<{
    move: Move;
    analysis: boolean;
    player: Player;
  } | null>(null);
  const preview = movePreview?.move ?? null;
  const [formName, setFormName] = useState(""),
    [formBusy, setFormBusy] = useState(false);
  const [editProfileId, setEditProfileId] = useState("");
  const [workspace, setWorkspace] = useState(currentWorkspace);
  useLayoutEffect(() => {
    if (pendingGameSearch.current !== workspace) return;
    pendingGameSearch.current = undefined;
    if (workspace === "archive") archiveFilter.current?.focus();
    else gamePicker.current?.focusSearch();
  }, [workspace]);
  const [archiveSort, setArchiveSort] = useState<ArchiveSort>("date");
  const [archiveEditId, setArchiveEditId] = useState<string>();
  const importBase = useRef<Game | null>(null);
  const selectedGame = data?.games.find(
    (g) => g.id === gameId && g.profileId === profileId,
  );
  const game = selectedGame ? state.games[selectedGame.id] : undefined;
  const squareFilter = useMoveSquareFilter(workspace === "games" ? game : undefined);
  const profile = data?.profiles.find((p) => p.id === profileId);
  const editProfile = data?.profiles.find((p) => p.id === editProfileId);
  const editingArchive =
    dialog === "rename" && archiveEditId
      ? data?.games.find(
          (g) => g.id === archiveEditId && g.profileId === profileId,
        )
      : undefined;
  const editGame = archiveEditId
    ? editingArchive && state.games[editingArchive.id]
    : game;
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
    game,
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
    ? solver.styleChoice(exchangeSearch, exchangeProfile, replyAnalysis.bagSize, exchangeSeed, styleSample)
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
  const activeFlight =
    workspace === "games" && flight?.destination === signature
      ? flight
      : undefined;
  const gameFinish = useGameFinish(workspace === "games" ? game : undefined, !!activeFlight);
  const boardLocked = !!gameFinish.current;
  const [ownPlay, setOwnPlay] = useState<{ gameId: string; board: string }>();
  const canEnterOwnPlay = !!game && workspace === "games" &&
    !game.archived && !gameOver && !boardLocked && !activeFlight;
  const enteringOwnPlay = canEnterOwnPlay && ownPlay?.gameId === game.id &&
    ownPlay.board === game.board.join(".");
  useEffect(() => {
    if (!enteringOwnPlay) setOwnPlay(undefined);
  }, [enteringOwnPlay]);
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
    showGuide: () => openDialog("keyboard-shortcuts"),
  });
  const updateBusy =
    state.pending.length > 0 ||
    !!dialog ||
    formBusy ||
    solver.calculating ||
    styleExchange.pending ||
    replyAnalysis.calculating ||
    calculating ||
    !!activeFlight;
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
  const hasPlayableRack = !!game && !gameOver && !!splitRack(game).available;
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
    if (!data) return;
    const pid = data.profiles.some((p) => p.id === profileId)
      ? profileId
      : data.profiles[0]?.id;
    if (pid !== profileId) setProfileId(pid);
    const current = data.games.find(
      (g) => g.id === gameId && g.profileId === pid,
    );
    if (!current) {
      const last = saved(`tilewise:last:${pid}`);
      const active = orderGames(
        data.games.filter((g) => g.profileId === pid && !g.archived),
        data.profiles.find((p) => p.id === pid)?.gameOrder,
      );
      setGameId(active.find((g) => g.id === last)?.id ?? active[0]?.id ?? "");
    }
  }, [data, profileId, gameId]);
  useEffect(() => {
    try {
      localStorage.setItem("tilewise:profile", profileId);
      localStorage.setItem("tilewise:game", gameId);
      if (game && game.profileId === profileId && !game.archived)
        localStorage.setItem(`tilewise:last:${profileId}`, game.id);
    } catch {}
  }, [profileId, gameId, game?.archived, game?.profileId]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("tilewise:theme", theme);
    } catch {}
  }, [theme]);
  useEffect(() => setPreview(null), [signature]);
  useEffect(() => {
    setError("");
  }, [gameId]);
  useEffect(() => {
    const changeView = () => {
      setWorkspace(currentWorkspace());
      setDialog(null);
      setSidebarDrawerOpen(false);
      setPreview(null);
    };
    window.addEventListener("hashchange", changeView);
    return () => window.removeEventListener("hashchange", changeView);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  function update(next: Game) {
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
  function updateAfterTurn(next: Game) {
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
  function notify(text: string) {
    setToast(text);
  }
  function showWorkspace(next: Workspace) {
    if (workspace !== next)
      history.pushState(
        null,
        "",
        workspaceHashes[next] || location.pathname + location.search,
      );
    setWorkspace(next);
    setSidebarDrawerOpen(false);
    setPreview(null);
  }
  function chooseGame(id: string) {
    if (workspace !== "games") showWorkspace("games");
    setGameId(id);
    setSidebarDrawerOpen(false);
  }
  function openMyGames() {
    showWorkspace("games");
    if (!selectedGame?.archived) return;
    const last = saved(`tilewise:last:${profileId}`);
    setGameId(
      activeGames.find((g) => g.id === last)?.id ?? activeGames[0]?.id ?? "",
    );
  }
  function openDialog(next: Dialog) {
    setError("");
    setFormBusy(false);
    setDialog(next);
    setSidebarDrawerOpen(false);
    if (next === "screenshot") importBase.current = game || null;
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
    setOwnPlay(undefined);
    const position = recordOpponentPlayForSearch(game);
    if (position !== game) updateAfterTurn(position);
    if (position.scoring?.end && !position.archived) return;
    setFindMovesRequest((request) => request + 1);
    if (narrowLayout) moveReview.open();
    if (solver.solve(position, reload)) setPreview(null);
  }
  function editPosition() {
    if (moveReview.showing) moveReview.dismiss();
    if (squareFilter.selecting) squareFilter.setSelecting(false);
    setPreview(null);
  }
  function startOwnPlay() {
    if (!canEnterOwnPlay) return;
    editPosition();
    setError("");
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
    squareFilterButton.current?.focus({ preventScroll: true });
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
  ) {
    if (enteringOwnPlay) return;
    if (move && narrowLayout && player === "you") moveReview.open();
    setPreview(move ? { move, analysis, player } : null);
  }
  function play(
    move: Move,
    { useRackMarks = true, correction }: {
      useRackMarks?: boolean;
      correction?: OwnPlayRackCorrection;
    } = {},
  ) {
    if (!game || activeFlight || boardLocked) return;
    try {
      const corrected = correction && playOwnMoveWithRackCorrection(
        game, correction, replyAnalysis.bagConfirmed ? replyAnalysis.bagSize : undefined,
      );
      const bagSize = corrected?.bagSize ?? replyAnalysis.bagSize;
      const next = corrected?.game ?? playTrackedMove(game, move, bagSize, useRackMarks);
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
  const profileGames =
    data?.games.filter((g) => g.profileId === profileId) ?? [];
  const activeGames = orderGames(
    profileGames.filter((g) => !g.archived),
    profile?.gameOrder,
  );
  const archivedGames = profileGames.filter((g) => g.archived);
  const viewingArchivedGame = workspace === "games" && selectedGame?.archived;
  const pending = state.pending.length > 0,

    hasSaveError = Object.keys(state.saveErrors).length > 0,
    conflict = game && state.conflicts[game.id],
    saveError = game && state.saveErrors[game.id];
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
  const headlineScore = game && (
    <GameScoreBadge
      score={gameFinish.score}
      turn={nextPlayerToMove(game)}
      onReplay={gameFinish.replay}
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
  const gameScores = game && (
    <GameScores
      key={game.id}
      game={game}
      onToggle={(enabled) => update(setScoreTracking(game, enabled))}
      onRecord={() => updateAfterTurn(recordOpponentPlay(game))}
      onCorrection={() => update(treatBoardEditAsCorrection(game))}
      onEditLastOpponentMove={
        lastSearchRecordedOpponentTurn(game)
          ? () => {
              editPosition();
              update(reopenSearchRecordedOpponentPlay(game));
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
        setProfileId(game.profileId);
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
  const boardName =
    game && game.template.name + (hasCustomPremiums(game) ? " (custom)" : "");
  const boardSize = game && `${game.template.size} × ${game.template.size}`;
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
        <button
          className="nav-link"
          aria-current={
            workspace === "games" && !viewingArchivedGame ? "page" : undefined
          }
          onClick={openMyGames}
        >
          <Home size={18} />
          My games
        </button>
        <button
          className="nav-link"
          aria-current={
            workspace === "archive" || viewingArchivedGame ? "page" : undefined
          }
          onClick={() => showWorkspace("archive")}
        >
          <Archive size={18} />
          Archived games
        </button>
        <button
          className="nav-link"
          aria-current={workspace === "stats" ? "page" : undefined}
          onClick={() => showWorkspace("stats")}
        >
          <ChartNoAxesCombined size={18} aria-hidden="true" />
          Stats
        </button>
        <button
          className="nav-link"
          aria-current={workspace === "studio" ? "page" : undefined}
          onClick={() => showWorkspace("studio")}
        >
          <Grid2X2 size={18} />
          Board studio
        </button>
        <button className="nav-link" onClick={() => openDialog("dictionaries")}>
          <BookOpen size={18} />
          Word lists
        </button>
        <button className="nav-link" onClick={() => openDialog("word-list-checker")}>
          <ListChecks size={18} aria-hidden="true" />
          Word list checker
        </button>
        <button className="nav-link" onClick={() => openDialog("ui-guide")}>
          <Map size={18} aria-hidden="true" />
          UI guide
        </button>
        <button
          className="nav-link"
          aria-keyshortcuts="?"
          onClick={() => openDialog("keyboard-shortcuts")}
        >
          <Keyboard size={18} aria-hidden="true" />
          Keyboard shortcuts
        </button>
        <button className="nav-link" onClick={() => openDialog("help")}>
          <Smartphone size={18} />
          Use on another device
        </button>
        <div className="sidebar-bottom">
          <div className="workspace-controls">
            <OfflineStatus
              game={game}
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
                onClick={() => openDialog("workspace-settings")}
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
              <select
                aria-label="Current profile"
                value={profileId}
                onChange={(e) => {
                  if (e.target.value === "new") {
                    openDialog("profile");
                    return;
                  }
                  setProfileId(e.target.value);
                  setGameId("");
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
            </span>
          </div>
        </div>
      </aside>
      <main className="main-content">
        {viewingArchivedGame && (
          <button
            className="button secondary archive-back archived-game-back"
            onClick={() => showWorkspace("archive")}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back to archived games
          </button>
        )}
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
            {game && (
              <button
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
            sort={archiveSort}
            onSort={setArchiveSort}
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
            onBack={openMyGames}
          />
        ) : game ? (
          <GameWorkspace
            definitionRules={game.template.rules}
            positionKey={signature}
            narrow={narrowLayout}
            reviewing={moveReview.showing}
            hasWarnings={warnings.length > 0}
          >
            <GameBoardColumn
              phone={narrowLayout}
              resizeDisabled={!!activeFlight}
              warnings={boardWarnings}
              board={<section
                ref={boardPanel}
                aria-label="Game board"
                className="board-panel panel"
                onKeyDown={(event) => {
                  if (
                    !boardLocked &&
                    squareFilter.selecting &&
                    event.key === "Escape"
                  ) {
                    event.preventDefault();
                    finishSquareSelection();
                  }
                }}
              >
                <LastPlay
                  game={activeFlight?.before ?? game}
                  bag={activeFlight?.bag ?? replyAnalysis}
                  reserveSpace={narrowLayout}
                />
                {!narrowLayout && boardWarnings}
                <BoardEntry
                  ref={boardEntry}
                  key={`${game.id}:${enteringOwnPlay ? "own-play" : "board"}`}
                  game={game}
                  skipPlayedTiles={preferences.skipPlayedTiles}
                  phoneLayout={narrowLayout}
                  hideHelp
                  preview={boardLocked ? null : activeFlight?.move ?? preview}
                  previewPlayer={activeFlight ? "you" : movePreview?.player}
                  readOnly={boardLocked}
                  displayBoard={activeFlight?.before.board}
                  onChange={updateAfterTurn}
                  overlay={
                    gameFinish.current && (
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
                                update(archiveGame(game));
                                notify("Game archived.");
                              }
                        }
                      />
                    )
                  }
                  onSelect={editPosition}
                  onSolve={hasPlayableRack && !activeFlight ? solve : undefined}
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
                  statusAction={
                    compactGame && !boardLocked && !game.board.some(Boolean) && (
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
                  opponentRack={replyAnalysis.opponentRack}
                  preview={
                    preferences.highlightRackPreview && movePreview?.player !== "opponent"
                      ? preview
                      : null
                  }
                  flyingRack={activeFlight}
                />
              </section>}
            />
            <div className="results-column">
              {gameOver ? (
                <section className="results-panel game-over panel" aria-label="Possible moves">
                  <h3>Game over</h3>
                </section>
              ) : (
                <Results
                  compact={compactGame}
                  collapsibleSearch
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
                  squareFilterControl={
                    <button
                      ref={squareFilterButton}
                      className={`icon-button move-square-toggle${squareFilter.marks.size ? " has-required-squares" : ""}`}
                      type="button"
                      disabled={boardLocked}
                      aria-label="Filter moves by squares"
                      aria-pressed={squareFilter.selecting}
                      title={squareFilter.marks.size ? `Filter moves by squares (${squareFilter.marks.size} selected)` : "Filter moves by squares"}
                      onClick={toggleSquareSelection}
                    >
                      <Focus size={16} aria-hidden="true" />
                    </button>
                  }
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
              {!narrowLayout && (
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
            <div className="game-scores-column">{gameScores}</div>
          </GameWorkspace>
        ) : selectedGame ? (
          <section className="welcome-panel panel" aria-label="Game board">
            <GameLoadStatus
              id={selectedGame.id}
              error={state.loadErrors[selectedGame.id]}
            />
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
            update(importBoard(latest, board, premiums, clearBoard));
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
                  setProfileId(p.id);
                  setGameId("");
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
                update({ ...editGame, ...readGameDetails(e.currentTarget, editGame.solo) });
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
          subtitle={`${boardName} · ${boardSize}`}
          onClose={() => setDialog(null)}
        >
          <div className="board-help-dialog">
            <BoardEntryHelp />
            {boardLegend}
          </div>
        </Modal>
      )}
      {dialog === "history" && game && (
        <Modal
          title="Your moves, remembered."
          subtitle="Undo restores the board and rack from before a move or board edit."
          onClose={() => setDialog(null)}
        >
          {!game.past.length ? (
            <div className="empty-history">
              <History size={28} />
              <p>No moves yet. Your next word starts the story.</p>
            </div>
          ) : (
            <ol className="history-list">
              {[...game.past].reverse().map((h, i) => (
                <li key={`${h.at}-${i}`}>
                  <span className="history-number">{game.past.length - i}</span>
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
              disabled={boardLocked || !game.future.length}
              onClick={redoGame}
            >
              <Redo2 size={16} />
              Redo
            </button>
            <button
              className="button primary"
              disabled={boardLocked || !game.past.length}
              onClick={undoGame}
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
          selectedId={game?.dictionaryId}
          onClose={() => setDialog(null)}
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
          selectedId={game?.dictionaryId}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "ui-guide" && (
        <UiGuide phoneLayout={narrowLayout} onClose={() => setDialog(null)} />
      )}
      {dialog === "keyboard-shortcuts" && (
        <KeyboardShortcuts phoneLayout={narrowLayout} onClose={() => setDialog(null)} />
      )}
      {dialog === "workspace-settings" && (
        <WorkspaceSettings
          theme={theme}
          onThemeChange={setTheme}
          preferences={preferences}
          concurrencyHint={concurrencyHint}
          workerLimit={workerLimit}
          onChange={setPreferences}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "help" && (
        <Modal
          title="Same game. Any screen."
          subtitle="Open Tilemaxx on your iPhone or Mac, then choose the same profile."
          onClose={() => setDialog(null)}
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
      {dialog === "delete" && game && (
        <Modal
          title="Delete this game?"
          subtitle={game.name}
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
                  await store.deleteGame(game.id);
                  setDialog(null);
                  setGameId("");
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
            update(archive ? archiveGame(next) : next);
            if (archive)
              chooseGame(
                activeGames.find((item) => item.id !== next.id)?.id ?? "",
              );
            setDialog(null);
            notify(
              archive
                ? "Game ended and archived."
                : "Game ended. Use Undo to resume.",
            );
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "manage" && game && (
        <GameOptions
          key={game.id}
          game={game}
          board={`${boardName} · ${boardSize}`}
          dictionaries={data.dictionaries}
          online={state.online}
          boardLocked={boardLocked}
          onUpdate={update}
          onChooseGame={chooseGame}
          onArchived={() =>
            chooseGame(activeGames.find((item) => item.id !== game.id)?.id ?? "")
          }
          onOpen={openDialog}
          onClose={() => setDialog(null)}
          notify={notify}
        />
      )}
    </div>
  );
}
