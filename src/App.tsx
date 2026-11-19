import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ImagePlus,
  CircleHelp,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
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
  LoaderCircle,
  Map,
  Menu,
  Monitor,
  MoreHorizontal,
  Pencil,
  Plus,
  Redo2,
  Save,
  Search,
  Settings,
  Smartphone,
  Undo2,
  Wifi,
  X,
  Archive,
  Trash2,
} from "lucide-react";
import { version } from "../version.json";
import Brand, { BrandTile, updateFavicon } from "./components/Brand";
import BoardEntry, {
  BoardEntryHelp,
  type BoardEntryHandle,
} from "./components/BoardEntry";
import BoardFinishOverlay from "./components/BoardFinishOverlay";
import LastPlay from "./components/LastPlay";
import { useGameFinish } from "./useGameFinish";
import {
  GameCalculations,
  useGameCalculating,
} from "./components/GameCalculations";
import GameId from "./components/GameId";
import { MoveSquareFilterControls, useMoveSquareFilter } from "./components/MoveSquareFilter";
import GameWorkspace, { useMoveReview } from "./components/GameWorkspace";
import RackEntry, { type RackEntryHandle } from "./components/RackEntry";
import ExchangeSuggestion from "./components/ExchangeSuggestion";
import {
  flyTiles,
  prepareTileFlight,
  revealTileTargets,
  rackTileRects,
} from "./components/tile-motion";
import TilePool from "./components/TilePool";
import { useReplyAnalysis } from "./useReplyAnalysis";
import { rackComposition, splitRack } from "../shared/rack-entry";
import BoardStudio from "./components/BoardStudio";
import ScreenshotImport from "./components/ScreenshotImport";
import { hasCustomPremiums, importBoard } from "../shared/screenshot";
import Modal from "./components/Modal";
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
  FullMoveHistoryIcon,
  GameMetadata,
  readGameDetails,
} from "./components/GameDetails";
import ArchivedGames, { type ArchiveSort } from "./components/ArchivedGames";
import SyncConflictMenu from "./components/SyncConflictMenu";
import GameScoreBadge from "./components/GameScoreBadge";
import GameScores from "./components/GameScores";
import EndGameDialog from "./components/EndGameDialog";
import {
  playTrackedMove,
  lastSearchRecordedOpponentTurn,
  nextPlayerToMove,
  recordOpponentPlay,
  recordOpponentPlayForSearch,
  recordOpponentRackOut,
  reopenSearchRecordedOpponentPlay,
  resetGameScoring,
  setScoreTracking,
  tracksScores,
  treatBoardEditAsCorrection,
} from "../shared/game-scoring";
import { CLEARED_BOARD } from "../shared/score-recovery";
import { DEFENSE_LIMIT } from "../shared/premium-defense";
import { useSolver } from "./useSolver";
import OfflineStatus from "./components/OfflineStatus";
import { useAutoUpdate } from "./useAutoUpdate";
import { useWorkspaceWidth } from "./useWorkspaceWidth";
import { store, useStore } from "./store";
import { premiumPalette } from "./premium-palettes";
import NewGameDialog from "./components/NewGameDialog";
import {
  type BoardTemplate,
  type Game,
  type Move,
  type Player,
  archiveGame,
  emptyBoard,
  localDate,
  orderGames,
  redo,
  remember,
  restoreArchivedGame,
  tileScore,
  undo,
} from "../shared/model";
import { recentOpponentNames } from "../shared/game-index";

type Dialog =
  | "screenshot"
  | "new"
  | "dictionaries"
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
  studio: "#board-studio",
} as const;
type Workspace = keyof typeof workspaceHashes;
type TileFlight = NonNullable<ReturnType<typeof prepareTileFlight>> & {
  before: Game;
  destination: string;
  move: Move;
  reviewing: boolean;
};

function currentWorkspace(): Workspace {
  if (location.hash === workspaceHashes.archive) return "archive";
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

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
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
  const phoneLayout = useMediaQuery("(max-width: 650px)");
  const sidebarOverlay = useMediaQuery("(max-width: 800px)");
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
  const state = useStore(),
    data = state.data;
  const { main, twoColumns } = useWorkspaceWidth(!!data);
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
  const narrowLayout = !twoColumns;
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
    workspace === "games" && !!game && !gameOver && !busy && !solver.error,
    { searchId, rank: solver.rankEndgame },
    workerLimit,
    solver.replyCandidates,
  );
  const activeFlight =
    workspace === "games" && flight?.destination === signature
      ? flight
      : undefined;
  const gameFinish = useGameFinish(workspace === "games" ? game : undefined, !!activeFlight);
  const boardLocked = !!gameFinish.current;
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
  const availableUpdate = useAutoUpdate(
    state.online ? state.serverVersion : undefined,
    preferences.autoUpdate,
    state.pending.length > 0 ||
      !!dialog ||
      formBusy ||
      solver.calculating ||
      replyAnalysis.calculating ||
      calculating ||
      !!activeFlight,
  );
  const moveReview = useMoveReview(
    narrowLayout && workspace === "games" && !gameOver,
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
    if (move && narrowLayout && player === "you") moveReview.open();
    setPreview(move ? { move, analysis, player } : null);
  }
  function play(move: Move) {
    if (!game || activeFlight || boardLocked) return;
    try {
      const next = playTrackedMove(game, move, replyAnalysis.bagSize);
      const motion = preferences.animatePlayedTiles
        ? prepareTileFlight(game, move, rackPanel.current, boardPanel.current)
        : undefined;
      solver.rememberResults();
      setFlight(
        motion && {
          ...motion,
          before: game,
          destination: positionSignature(next),
          move,
          reviewing: moveReview.showing,
        },
      );
      setPreview(null);
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
  const dictionarySelector = game && (
    <div className="game-word-list">
      <label>
        Word list
        <select
          aria-label="Game dictionary"
          value={game.dictionaryId}
          onChange={(e) => update({ ...game, dictionaryId: e.target.value })}
        >
          {data.dictionaries.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="icon-button"
        aria-label="About word lists"
        onClick={() => openDialog("dictionaries")}
      >
        <Info size={13} aria-hidden="true" />
      </button>
    </div>
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
    <>
      <button
        className="icon-button board-undo"
        disabled={boardLocked || !game.past.length}
        aria-label="Undo"
        title="Undo"
        onClick={undoGame}
      >
        <Undo2 size={17} />
      </button>
      <button
        className="icon-button board-redo"
        disabled={boardLocked || !game.future.length}
        aria-label="Redo"
        title="Redo"
        onClick={() => update(redo(game))}
      >
        <Redo2 size={17} />
      </button>
    </>
  );
  const boardModeHistory = game && (
    <div className="board-mode-history">{boardHistoryControls}</div>
  );
  const boardToolbar = game && (
    <div className="board-toolbar">
      <div>
        <span className="board-name" title={boardName}>
          <Grid2X2 size={16} />
          {boardName}
        </span>
        <span className="board-size">{boardSize}</span>
        <details
          className="board-help"
          onKeyDown={(event) => {
            if (event.key === "Escape" && event.currentTarget.open) {
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}
        >
          <summary
            className="icon-button"
            aria-label="Board help"
            title="Board help"
          >
            <CircleHelp size={16} />
          </summary>
          <div className="board-help-content">
            <BoardEntryHelp />
            {boardLegend}
          </div>
        </details>
      </div>
      <div className="board-actions">
        <button
          className="icon-button"
          aria-label="Import screenshot"
          title="Import screenshot"
          disabled={boardLocked}
          onClick={() => openDialog("screenshot")}
        >
          <ImagePlus size={17} />
        </button>
        <button
          className="icon-button"
          aria-label="Move history"
          title="Move history"
          onClick={() => openDialog("history")}
        >
          <History size={17} />
        </button>
      </div>
    </div>
  );
  return (
    <div
      className={`app-shell${workspace === "games" ? (compactGame ? " compact-game" : " stacked-game") : ""}${phoneLayout ? " phone-layout" : ""}${!sidebarVisible ? " sidebar-collapsed" : ""}`}
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
        <Brand />
        <button
          className="button new-game"
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
                {!preferences.autoUpdate && availableUpdate && (
                  <span
                    className="app-update-icon"
                    role="img"
                    aria-label={`Update available · v${availableUpdate}`}
                    tabIndex={0}
                  >
                    <CircleArrowUp size={14} aria-hidden="true" />
                    <span className="app-update-tooltip" aria-hidden="true">
                      Update available · v{availableUpdate}
                    </span>
                  </span>
                )}
              </span>
            </div>
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
      <main ref={main} className="main-content">
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
            <div className="game-heading-details">
              <div className="game-title-row">
                {sidebarButton}
                {selectedGame?.archived ? (
                  <h1>{selectedGame.name}</h1>
                ) : (
                  <GamePicker
                    ref={gamePicker}
                    key={profileId}
                    game={selectedGame}
                    games={activeGames}
                    onChoose={chooseGame}
                    onReorder={(ids) => store.reorderGames(profileId, ids)}
                  />
                )}
                {selectedGame?.archived && selectedGame.fullMoveHistory && (
                  <FullMoveHistoryIcon />
                )}
              </div>
              {headlineScore}
              {selectedGame && (
                <div className="game-title-meta">
                  <div>
                    <GameMetadata game={selectedGame} />
                  </div>
                  {selectedGame.archived && <span>Archived</span>}
                  {dictionarySelector}
                </div>
              )}
              {game?.notes && (
                <details className="game-notes" key={game.id}>
                  <summary>Notes</summary>
                  <p>{game.notes}</p>
                </details>
              )}
            </div>
            {game && (
              <div className="game-actions">
                {compactGame && boardToolbar}
                {game.archived && (
                  <button
                    className="button secondary restore-game"
                    aria-label="Restore game"
                    title="Restore game"
                    disabled={boardLocked || !game.archivedBoard}
                    onClick={() => {
                      update(restoreArchivedGame(game));
                      notify(
                        game.archivedState
                          ? "Archived position restored."
                          : "Archived board restored.",
                      );
                    }}
                  >
                    <Undo2 size={16} /> <span>Restore game</span>
                  </button>
                )}
                <button
                  className="button secondary manage-button"
                  aria-label="Game options"
                  title="Game options"
                  onClick={() => openDialog("manage")}
                >
                  <MoreHorizontal size={18} />
                  <span>Game options</span>
                </button>
              </div>
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
            the connection returns.
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
            sort={archiveSort}
            onSort={setArchiveSort}
            onOpen={chooseGame}
            onEdit={(id) => {
              setArchiveEditId(id);
              setDialog("rename");
            }}
            onBack={openMyGames}
          />
        ) : game ? (
          <GameWorkspace narrow={narrowLayout} reviewing={moveReview.showing}>
            <div className="board-column">
              <section
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
                <LastPlay game={activeFlight?.before ?? game} />
                <BoardEntry
                  ref={boardEntry}
                  key={game.id}
                  game={game}
                  hideHelp
                  preview={boardLocked ? null : activeFlight?.move ?? preview}
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
                  historyControls={
                    !moveReview.showing &&
                    !squareFilter.selecting &&
                    boardHistoryControls
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
              </section>
              <section
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
                  phoneLayout={phoneLayout}
                  onReviewEdit={moveReview.showing ? editPosition : undefined}
                  positionKey={signature}
                  exchangeAdvice={solver.exchangeAdvice}
                  exchangeBag={replyAnalysis.bagSize}
                  exchangeBagConfirmed={replyAnalysis.bagConfirmed}
                  opponentRack={replyAnalysis.opponentRack}
                  preview={
                    preferences.highlightRackPreview && movePreview?.player !== "opponent"
                      ? preview
                      : null
                  }
                  flyingRack={activeFlight}
                />
                <TilePool key={`tile-pool:${game.id}`} game={game} />
              </section>
            </div>
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
                  exchangeAction={
                    solver.exchangeAdvice &&
                    !activeFlight && (
                      <ExchangeSuggestion
                        advice={solver.exchangeAdvice}
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
                  calculating={solver.calculating}
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
                  phoneLayout={phoneLayout}
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
              {warnings.length > 0 && (
                <div className="board-warnings">
                  <Info size={17} />
                  <div>
                    {warnings.map((w) => (
                      <p key={w}>{w}</p>
                    ))}
                  </div>
                </div>
              )}
              {!phoneLayout && (
                <div className="companion-note">
                  <span className="note-icon">
                    <BookOpen size={19} />
                  </span>
                  <div>
                    <h3>A companion to your game.</h3>
                    <p>
                      Play a suggestion, enter your opponent’s move, then refill
                      your rack. We’ll remember where you left off.
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
        {(!phoneLayout || openId) && (
          <footer className="workspace-footer">
            {!phoneLayout && <span>Less guessing. More good words.</span>}
            {openId && <GameId id={openId} onNotice={notify} />}
            {!phoneLayout && <span>Tilemaxx · Local & personal</span>}
          </footer>
        )}
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
          phoneLayout={phoneLayout}
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
                update({ ...editGame, ...readGameDetails(e.currentTarget) });
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
              onClick={() => update(redo(game))}
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
      {dialog === "ui-guide" && (
        <UiGuide phoneLayout={phoneLayout} onClose={() => setDialog(null)} />
      )}
      {dialog === "keyboard-shortcuts" && (
        <KeyboardShortcuts onClose={() => setDialog(null)} />
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
        <Modal
          title="Game options"
          subtitle={game.name}
          onClose={() => setDialog(null)}
          closeDisabled={formBusy}
        >
          <div className="game-option-list" aria-busy={formBusy}>
            {!compactGame && (
              <>
                <button disabled={formBusy || boardLocked} onClick={() => openDialog("screenshot")}>
                  <ImagePlus size={19} />
                  <span><strong>Import screenshot</strong></span>
                  <ArrowUpRight size={16} />
                </button>
                <button disabled={formBusy} onClick={() => openDialog("history")}>
                  <History size={19} />
                  <span><strong>Move history</strong></span>
                  <ArrowUpRight size={16} />
                </button>
                <button disabled={formBusy} onClick={() => openDialog("board-help")}>
                  <CircleHelp size={19} />
                  <span><strong>Board help</strong></span>
                  <ArrowUpRight size={16} />
                </button>
              </>
            )}
            <button disabled={formBusy} onClick={() => openDialog("rename")}>
              <Pencil size={19} />
              <span>
                <strong>Edit game details</strong>
                <small>Opponent, platform, date, and notes.</small>
              </span>
              <ArrowUpRight size={16} />
            </button>
            <button
              onClick={() =>
                void action(async () => {
                  const copy = await store.createGame({
                    ...game,
                    name: `${game.name.slice(0, 65)} (copy)`,
                    archived: false,
                    archivedBoard: undefined,
                    archivedState: undefined,
                  });
                  chooseGame(copy.id);
                  setDialog(null);
                })
              }
              disabled={formBusy}
            >
              <Copy size={19} />
              <span>
                <strong>Duplicate game</strong>
                <small>Try another path with the same position.</small>
              </span>
              <ArrowUpRight size={16} />
            </button>
            {!game.archived && !gameOver && (
              <button disabled={formBusy} onClick={() => openDialog("end-game")}>
                <Check size={19} />
                <span>
                  <strong>End game</strong>
                  <small>Record the final result.</small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            )}
            <button
              disabled={formBusy}
              onClick={() => {
                update(
                  game.archived
                    ? {
                        ...game,
                        archived: false,
                        archivedBoard: undefined,
                        archivedState: undefined,
                      }
                    : archiveGame(game),
                );
                if (!game.archived)
                  chooseGame(
                    activeGames.find((g) => g.id !== game.id)?.id ?? "",
                  );
                setDialog(null);
                notify(
                  game.archived ? "Game moved to My games." : "Game archived.",
                );
              }}
            >
              <Archive size={19} />
              <span>
                <strong>
                  {game.archived ? "Move to My games" : "Archive game"}
                </strong>
                <small>Keep the board and history for later.</small>
              </span>
              <ArrowUpRight size={16} />
            </button>
            {!game.archived && (
              <button
                disabled={formBusy}
                onClick={() =>
                  void action(async () => {
                    const created = await store.archiveAndStartNewGame(
                      game.id,
                      localDate(),
                    );
                    chooseGame(created.id);
                    setDialog(null);
                    notify("Game archived. New game started.");
                  })
                }
              >
                <Plus size={19} />
                <span>
                  <strong>Archive &amp; start new game</strong>
                  <small>Play the same opponent again with a blank board.</small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            )}
            <button
              disabled={formBusy || boardLocked}
              onClick={() => {
                update({
                  ...game,
                  ...remember(game, CLEARED_BOARD),
                  scoring: resetGameScoring(game),
                  board: emptyBoard(game.template.size),
                  rack: "",
                  excludedRackSlots: undefined,
                  requiredRackSlots: undefined,
                });
                setDialog(null);
                notify("Board cleared. Use Undo to restore it.");
              }}
            >
              <Trash2 size={19} />
              <span>
                <strong>Clear board and rack</strong>
                <small>Start fresh. You can undo this.</small>
              </span>
              <ArrowUpRight size={16} />
            </button>
            <button disabled={formBusy} onClick={() => openDialog("delete")}>
              <Trash2 size={19} />
              <span>
                <strong>Delete game</strong>
                <small>Permanently remove this game and its history.</small>
              </span>
              <ArrowUpRight size={16} />
            </button>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </Modal>
      )}
    </div>
  );
}
