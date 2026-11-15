import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ImagePlus,
  CircleHelp,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
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
  LoaderCircle,
  Menu,
  Monitor,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Redo2,
  Save,
  Search,
  Smartphone,
  Sun,
  Undo2,
  Wifi,
  X,
  Archive,
  Trash2,
} from "lucide-react";
import { version } from "../package.json";
import Brand, { BrandTile, updateFavicon } from "./components/Brand";
import BoardEntry, { BoardEntryHelp } from "./components/BoardEntry";
import { GameCalculations } from "./components/GameCalculations";
import GameId from "./components/GameId";
import { MoveSquareFilterControls, useMoveSquareFilter } from "./components/MoveSquareFilter";
import GameWorkspace, { usePhoneMoveReview } from "./components/GameWorkspace";
import RackEntry, { type RackEntryHandle } from "./components/RackEntry";
import ExchangeSuggestion from "./components/ExchangeSuggestion";
import {
  flyTiles,
  prepareTileFlight,
  revealTileTargets,
  rackTileRects,
} from "./components/tile-motion";
import TilePool from "./components/TilePool";
import OpponentRack from "./components/OpponentRack";
import { useReplyAnalysis } from "./useReplyAnalysis";
import { splitRack } from "../shared/rack-entry";
import BoardStudio from "./components/BoardStudio";
import ScreenshotImport from "./components/ScreenshotImport";
import { hasCustomPremiums, importBoard } from "../shared/screenshot";
import Modal from "./components/Modal";
import WordLists from "./components/WordLists";
import Results from "./components/Results";
import GamePicker from "./components/GamePicker";
import {
  GameDetailFields,
  FullMoveHistoryIcon,
  GameMetadata,
  readGameDetails,
} from "./components/GameDetails";
import ArchivedGames, { type ArchiveSort } from "./components/ArchivedGames";
import GameScoreBadge from "./components/GameScoreBadge";
import GameScores from "./components/GameScores";
import {
  emptyScoring,
  playTrackedMove,
  recordOpponentPlay,
  recordOpponentRackOut,
  setScoreTracking,
  summarizeGameScore,
  treatBoardEditAsCorrection,
} from "../shared/game-scoring";
import { defaultDictionary } from "../shared/dictionaries";
import { DEFENSE_LIMIT } from "../shared/premium-defense";
import { useSolver } from "./useSolver";
import { store, useStore } from "./store";
import { premiumPalette } from "./premium-palettes";
import {
  type BoardTemplate,
  type Game,
  type Move,
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
  | "rename"
  | "delete"
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
  phoneReview: boolean;
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
  return JSON.stringify([
    game.id,
    game.dictionaryId,
    game.rack,
    game.excludedRackSlots ?? [],
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
  return (
    <GameCalculations>
      <Tilemaxx />
    </GameCalculations>
  );
}

function Tilemaxx() {
  const desktopGame = useMediaQuery("(min-width: 1000px)");
  const phoneLayout = useMediaQuery("(max-width: 650px)");
  const boardPanel = useRef<HTMLElement>(null);
  const squareFilterButton = useRef<HTMLButtonElement>(null);
  const rackPanel = useRef<HTMLElement>(null);
  const rackEntry = useRef<RackEntryHandle>(null);
  const [flight, setFlight] = useState<TileFlight>();
  const state = useStore(),
    data = state.data;
  const [profileId, setProfileId] = useState(saved("tilewise:profile")),
    [gameId, setGameId] = useState(saved("tilewise:game"));
  const [dialog, setDialog] = useState<Dialog>(null),
    [sidebar, setSidebar] = useState(false),
    [toast, setToast] = useState(""),
    [error, setError] = useState("");
  const [theme, setTheme] = useState(saved("tilewise:theme", "system"));
  const [movePreview, setPreview] = useState<{
    move: Move;
    analysis: boolean;
  } | null>(null);
  const preview = movePreview?.move ?? null;
  const [formName, setFormName] = useState(""),
    [formTrackScores, setFormTrackScores] = useState(true),
    [formTemplate, setFormTemplate] = useState("scrabble"),
    [formDictionary, setFormDictionary] = useState(""),
    [formBusy, setFormBusy] = useState(false);
  const [editProfileId, setEditProfileId] = useState("");
  const [workspace, setWorkspace] = useState(currentWorkspace);
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
  const solver = useSolver(signature);
  const { busy, warnings } = solver;
  const replyAnalysis = useReplyAnalysis(
    game,
    signature,
    solver.results?.head ?? null,
    workspace === "games" && !!game && !busy && !solver.error,
    { searchId: solver.results?.searchId, rank: solver.rankEndgame },
  );
  const activeFlight =
    workspace === "games" && flight?.destination === signature
      ? flight
      : undefined;
  const phoneReview = usePhoneMoveReview(
    phoneLayout && workspace === "games",
    !busy && !solver.error && solver.results?.total
      ? solver.results.searchId
      : undefined,
    activeFlight?.phoneReview,
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
  const gameOver = !!game?.scoring?.end && !game.archived;
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
      setSidebar(false);
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
  function undoGame() {
    if (!game?.past.length) return;
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
    setSidebar(false);
    setPreview(null);
  }
  function chooseGame(id: string) {
    if (workspace !== "games") showWorkspace("games");
    setGameId(id);
    setSidebar(false);
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
    setSidebar(false);
    if (next === "screenshot") importBase.current = game || null;
    if (next === "new") {
      setFormTrackScores(true);
      setFormTemplate("scrabble");
      setFormDictionary(
        defaultDictionary(data?.dictionaries ?? [], game?.dictionaryId)?.id ??
          "",
      );
    }
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
    if (phoneLayout) phoneReview.open();
    if (solver.solve(game, reload)) setPreview(null);
  }
  function editPosition() {
    if (phoneReview.showing) phoneReview.dismiss();
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
    if (phoneLayout) {
      phoneReview.open();
      boardPanel.current?.scrollIntoView?.({ block: "nearest" });
    }
    const index = squareFilter.requiredSquares?.indices[0] ?? game.template.start;
    boardPanel.current
      ?.querySelector<HTMLButtonElement>(`[data-cell="${index}"]`)
      ?.focus({ preventScroll: true });
  }
  function previewMove(move: Move | null, analysis = false) {
    if (move && phoneLayout) phoneReview.open();
    setPreview(move ? { move, analysis } : null);
  }
  function play(move: Move) {
    if (!game || activeFlight) return;
    try {
      const next = playTrackedMove(game, move, replyAnalysis.bagSize);
      const motion = prepareTileFlight(
        game,
        move,
        rackPanel.current,
        boardPanel.current,
      );
      solver.rememberResults();
      setFlight(
        motion && {
          ...motion,
          before: game,
          destination: positionSignature(next),
          move,
          phoneReview: phoneReview.showing,
        },
      );
      setPreview(null);
      update(next);
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
    hasConflict = Object.keys(state.conflicts).length > 0,
    hasSaveError = Object.keys(state.saveErrors).length > 0,
    conflict = game && state.conflicts[game.id],
    saveError = game && state.saveErrors[game.id];
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
  const compactGame = desktopGame && workspace === "games" && !!game;
  const phoneBoardControls = phoneLayout && !compactGame;
  const collapsibleBoardHelp = compactGame || phoneLayout;
  const menuInTitle = phoneLayout && workspace === "games";
  const headlineScore = game && (
    <GameScoreBadge score={summarizeGameScore(game)} prominent={compactGame} />
  );
  const menuButton = (
    <button
      className="icon-button menu-button"
      aria-label="Open workspace menu"
      aria-expanded={sidebar}
      onClick={() => setSidebar(true)}
    >
      <Menu size={20} />
    </button>
  );
  const gameScores = game && (
    <GameScores
      key={game.id}
      game={game}
      onToggle={(enabled) => update(setScoreTracking(game, enabled))}
      onRecord={() => update(recordOpponentPlay(game))}
      onCorrection={() => update(treatBoardEditAsCorrection(game))}
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
  const saveAndTheme = (
    <div className="topbar-actions">
      <span
        className={`sync-status ${!state.online || hasConflict || hasSaveError ? "offline" : ""}`}
        title={saveError || state.error || "Games are saved on your server"}
      >
        {hasConflict || hasSaveError ? (
          <Info size={14} />
        ) : !state.online ? (
          <CloudOff size={14} />
        ) : pending ? (
          <LoaderCircle className="spin" size={14} />
        ) : (
          <CheckCheck size={15} />
        )}
        <span>
          {hasConflict
            ? "Review changes"
            : hasSaveError
              ? "Save rejected"
              : !state.online
                ? "Saved on this device"
                : pending
                  ? "Saving…"
                  : "All changes saved"}
        </span>
      </span>
      <div className="theme-settings">
        <div className="theme-switch" role="group" aria-label="Color theme">
          {[
            ["light", Sun],
            ["dark", Moon],
            ["system", Monitor],
          ].map(([value, Icon]) => {
            const I = Icon as typeof Sun;
            return (
              <button
                key={value as string}
                aria-label={`${value} theme`}
                aria-pressed={theme === value}
                title={`${value} theme`}
                className={theme === value ? "active" : ""}
                onClick={() => setTheme(value as string)}
              >
                <I size={15} />
              </button>
            );
          })}
        </div>
        <span className="app-version">v{version}</span>
      </div>
    </div>
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
        disabled={!game.past.length}
        aria-label="Undo"
        title="Undo"
        onClick={undoGame}
      >
        <Undo2 size={17} />
      </button>
      <button
        className="icon-button board-redo"
        disabled={!game.future.length}
        aria-label="Redo"
        title="Redo"
        onClick={() => update(redo(game))}
      >
        <Redo2 size={17} />
      </button>
    </>
  );
  const mobileBoardHistory = phoneBoardControls && (
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
        {collapsibleBoardHelp && (
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
        )}
      </div>
      <div className="board-actions">
        <button
          className="icon-button"
          aria-label="Import screenshot"
          title="Import screenshot"
          onClick={() => openDialog("screenshot")}
        >
          <ImagePlus size={17} />
        </button>
        {boardHistoryControls}
        <span className="toolbar-divider" />
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
      className={`app-shell${compactGame ? " compact-game" : ""}${phoneLayout ? " phone-layout" : ""}`}
      data-premium-palette={premiumPalette(
        workspace === "games" ? game?.platform : undefined,
      )}
    >
      {sidebar && (
        <div className="sidebar-scrim" onClick={() => setSidebar(false)} />
      )}
      <aside className={`sidebar ${sidebar ? "open" : ""}`}>
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
        <button className="nav-link" onClick={() => openDialog("help")}>
          <Smartphone size={18} />
          Use on another device
        </button>
        <div className="sidebar-bottom">
          {collapsibleBoardHelp ? (
            saveAndTheme
          ) : (
            <div className="local-note">
              <span className="status-dot" />
              Your games. Your home server.
            </div>
          )}
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
        {phoneLayout && !menuInTitle && (
          <header className="phone-menu">{menuButton}</header>
        )}
        {!compactGame && !phoneLayout && (
          <header className="topbar">
            <div className="breadcrumb">
              {menuButton}
              <Home size={15} />
              <span>My games</span>
              <span className="breadcrumb-slash">/</span>
              <span>
                {workspace === "studio"
                  ? "Board studio"
                  : workspace === "archive"
                    ? "Archived games"
                    : selectedGame?.name || "Your workspace"}
              </span>
            </div>
            {saveAndTheme}
          </header>
        )}
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
          <div className="workspace-heading game-heading">
            {menuInTitle && menuButton}
            <div className="game-heading-details">
              <div className="game-title-row">
                {selectedGame?.archived ? (
                  <h1>{selectedGame.name}</h1>
                ) : (
                  <GamePicker
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
                {!compactGame && headlineScore}
              </div>
              {compactGame && headlineScore}
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
                    disabled={!game.archivedBoard}
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
          </div>
        )}
        {state.storageError && (
          <div className="banner warning">
            Browser storage is full or disabled. Keep this tab open until the
            server confirms your changes are saved.
          </div>
        )}
        {conflict && game && (
          <div className="banner warning">
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
          <GameWorkspace phone={phoneLayout} reviewing={phoneReview.showing}>
            <div className="board-column">
              <section
                ref={boardPanel}
                className="board-panel panel"
                onKeyDown={(event) => {
                  if (squareFilter.selecting && event.key === "Escape") {
                    event.preventDefault();
                    finishSquareSelection();
                  }
                }}
              >
                {!compactGame && !phoneBoardControls && boardToolbar}
                <BoardEntry
                  key={game.id}
                  game={game}
                  hideHelp={collapsibleBoardHelp}
                  preview={activeFlight?.move ?? preview}
                  displayBoard={activeFlight?.before.board}
                  onChange={update}
                  onSelect={editPosition}
                  historyControls={
                    phoneBoardControls &&
                    !phoneReview.showing &&
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
                    historyControls={mobileBoardHistory}
                  />
                ) : phoneReview.showing && (
                  <div className="board-review-actions">
                    <span aria-live="polite">
                      {preview ? (
                        <>
                          <strong>{preview.word}</strong> · {preview.score} pts
                        </>
                      ) : (
                        "Choose a move to preview"
                      )}
                    </span>
                    {mobileBoardHistory}
                    {!movePreview?.analysis && (
                      <button
                        className="board-review-play"
                        type="button"
                        disabled={!preview || !!activeFlight}
                        onClick={() => preview && play(preview)}
                      >
                        <span className="button primary">Play</span>
                      </button>
                    )}
                  </div>
                )}
                {!collapsibleBoardHelp && boardLegend}
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
                    update(next.rack !== game.rack ? recordOpponentRackOut(next) : next)
                  }
                  onSolve={solve}
                  phoneLayout={phoneLayout}
                  onReviewEdit={phoneReview.showing ? editPosition : undefined}
                  positionKey={signature}
                  exchangeAdvice={solver.exchangeAdvice}
                  exchangeBag={replyAnalysis.bagSize}
                  exchangeBagConfirmed={replyAnalysis.bagConfirmed}
                  preview={preview}
                  flyingRack={activeFlight}
                />
                <OpponentRack
                  rack={replyAnalysis.opponentRack}
                  assumed={replyAnalysis.bagAssumedEmpty}
                />
                <TilePool key={`tile-pool:${game.id}`} game={game} />
              </section>
              {!phoneLayout && gameScores}
            </div>
            <div className="results-column">
              {gameOver ? (
                <section className="results-panel game-over panel" aria-label="Possible moves">
                  <h3>Game over</h3>
                </section>
              ) : (
                <Results
                  compact={compactGame}
                  collapsibleSearch={compactGame || phoneLayout}
                  results={solver.results}
                  exchangeAction={
                    solver.exchangeAdvice &&
                    !activeFlight && (
                      <ExchangeSuggestion
                        advice={solver.exchangeAdvice}
                        rack={game.rack}
                        onOpen={() => {
                          if (phoneReview.showing) editPosition();
                          rackEntry.current?.openSuggestedExchange(phoneLayout);
                        }}
                        inHeader
                      />
                    )
                  }
                  fetchPage={solver.page}
                  fetchShortlist={solver.shortlist}
                  busy={busy}
                  calculating={solver.calculating}
                  elapsed={solver.elapsed}
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
                    solver.runBoardOdds(game, candidates, bagSize)
                  }
                  onCancelBoardOdds={solver.cancelBoardOdds}
                />
              )}
              {phoneLayout && gameScores}
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
              <span>
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
          onApply={(board, premiums) => {
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
            update(importBoard(latest, board, premiums));
            setDialog(null);
            notify("Screenshot imported. You can undo this change.");
          }}
        />
      )}
      {dialog === "new" && (
        <Modal title="New game" onClose={() => setDialog(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const details = readGameDetails(e.currentTarget);
              void action(async () => {
                const template = data.templates.find(
                  (t) => t.id === formTemplate,
                );
                if (!template)
                  throw new Error(
                    "That board template was deleted. Choose another board.",
                  );
                const created = await store.createGame({
                  profileId,
                  ...details,
                  template,
                  dictionaryId: formDictionary,
                  board: emptyBoard(template.size),
                  rack: "",
                  excludedRackSlots: undefined,
                  past: [],
                  future: [],
                  archived: false,
                  trackScores: formTrackScores,
                });
                chooseGame(created.id);
                setDialog(null);
              });
            }}
          >
            <GameDetailFields />
            <label>
              Board layout
              <select
                value={formTemplate}
                onChange={(e) => setFormTemplate(e.target.value)}
              >
                {data.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.size} × {t.size}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Word list
              <select
                value={formDictionary}
                onChange={(e) => setFormDictionary(e.target.value)}
              >
                {data.dictionaries.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} · {d.count.toLocaleString()} words
                  </option>
                ))}
              </select>
            </label>
            <label className="score-checkbox">
              <input
                type="checkbox"
                checked={formTrackScores}
                onChange={(e) => setFormTrackScores(e.target.checked)}
              />
              Track scores
            </label>
            <p className="small muted">
              Saved under {profile?.name}. Custom layouts are available in Board
              studio.
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <footer className="modal-footer">
              <button
                type="button"
                className="button secondary"
                onClick={() => setDialog(null)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={formBusy}>
                {formBusy ? "Creating…" : "Create game"}
                <ArrowRight size={16} />
              </button>
            </footer>
          </form>
        </Modal>
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
              disabled={!game.future.length}
              onClick={() => update(redo(game))}
            >
              <Redo2 size={16} />
              Redo
            </button>
            <button
              className="button primary"
              disabled={!game.past.length}
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
      {dialog === "manage" && game && (
        <Modal
          title="Game options"
          subtitle={game.name}
          onClose={() => setDialog(null)}
          closeDisabled={formBusy}
        >
          <div className="game-option-list" aria-busy={formBusy}>
            {phoneBoardControls && (
              <>
                <button disabled={formBusy} onClick={() => openDialog("screenshot")}>
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
              disabled={formBusy}
              onClick={() => {
                update({
                  ...game,
                  ...remember(game, "Cleared board and rack"),
                  scoring: emptyScoring(),
                  board: emptyBoard(game.template.size),
                  rack: "",
                  excludedRackSlots: undefined,
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
