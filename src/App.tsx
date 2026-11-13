import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ImagePlus,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  CloudOff,
  Copy,
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
  Shuffle,
  Smartphone,
  Sparkles,
  Sun,
  Undo2,
  Upload,
  Wifi,
  X,
  Archive,
  Trash2,
} from "lucide-react";
import Board from "./components/Board";
import Brand, { BrandTile, updateFavicon } from "./components/Brand";
import BoardEntry from "./components/BoardEntry";
import RackEntry from "./components/RackEntry";
import {
  flyTiles,
  prepareTileFlight,
  rackTileRects,
} from "./components/tile-motion";
import TilePool from "./components/TilePool";
import { sortRack, splitRack } from "../shared/rack-entry";
import BoardStudio from "./components/BoardStudio";
import ScreenshotImport from "./components/ScreenshotImport";
import { importBoard } from "../shared/screenshot";
import Modal from "./components/Modal";
import Results from "./components/Results";
import GamePicker from "./components/GamePicker";
import {
  GameDetailFields,
  GameMetadata,
  readGameDetails,
} from "./components/GameDetails";
import ArchivedGames, { type ArchiveSort } from "./components/ArchivedGames";
import GameScores from "./components/GameScores";
import ScoreBreakdown from "./components/ScoreBreakdown";
import ExchangeAnalysis from "./components/ExchangeAnalysis";
import { placeTiles } from "../shared/move-analysis";
import {
  emptyScoring,
  playTrackedMove,
  recordOpponentPlay,
  scorePlacement,
  tracksScores,
  setScoreTracking,
  treatBoardEditAsCorrection,
} from "../shared/game-scoring";
import { defaultDictionary } from "../shared/dictionaries";
import { DEFENSE_LIMIT } from "../shared/premium-defense";
import { useSolver } from "./useSolver";
import { store, useStore } from "./store";
import {
  type BoardTemplate,
  type Game,
  type Move,
  archiveGame,
  coordinate,
  emptyBoard,
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
  const { size, start, premiums, rackSize, bingo, rules, tileCounts } =
    game.template;
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
  const boardPanel = useRef<HTMLElement>(null);
  const rackPanel = useRef<HTMLElement>(null);
  const flightDock = useRef<HTMLDivElement>(null);
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
  const [preview, setPreview] = useState<Move | null>(null);
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
  const activeFlight =
    workspace === "games" && flight?.destination === signature
      ? flight
      : undefined;
  useLayoutEffect(() => {
    if (!flight) return;
    if (!activeFlight) {
      setFlight(undefined);
      return;
    }
    const board = flight.compact ? flightDock.current : boardPanel.current;
    const sources =
      flight.sources ?? (board ? rackTileRects(board, flight.slots) : []);
    const finish = () =>
      setFlight((current) => (current === flight ? undefined : current));
    const stop =
      board &&
      flyTiles(
        board,
        flight.move.tiles,
        sources,
        flight.before.template.rules,
        flight.compact,
        finish,
      );
    if (!stop) finish();
    return stop || undefined;
  }, [activeFlight, flight]);
  const [exchange, setExchange] = useState<{ key: string; slots: number[] }>();
  const previewScore =
    game && preview
      ? scorePlacement(
          game.board,
          placeTiles(game.board, preview),
          game.template,
          preview.direction,
        )
      : null;
  const hasPlayableRack = !!game && !!splitRack(game).available;
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
  function solve() {
    if (!game || (!busy && !hasPlayableRack)) return;
    setPreview(null);
    solver.solve(game);
  }
  function play(move: Move) {
    if (!game) return;
    try {
      const next = playTrackedMove(game, move);
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
        },
      );
      setPreview(null);
      update(next);
      setError("");
      notify(
        `${move.word} played for ${move.score} points. Add your new rack letters.`,
      );
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
  return (
    <div className="app-shell">
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
          <div className="local-note">
            <span className="status-dot" />
            Your games. Your home server.
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
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button menu-button"
              aria-label="Open workspace menu"
              onClick={() => setSidebar(true)}
            >
              <Menu size={20} />
            </button>
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
          <div className="topbar-actions">
            <span
              className={`sync-status ${!state.online || hasConflict || hasSaveError ? "offline" : ""}`}
              title={
                saveError || state.error || "Games are saved on your server"
              }
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
            <div className="theme-switch" aria-label="Color theme">
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
          </div>
        </header>
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
          <div className="workspace-heading">
            <div>
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
                {game && tracksScores(game) && (
                  <span
                    className="game-title-score"
                    role="group"
                    aria-label="Tracked score"
                  >
                    <span aria-label="Your score">
                      {game.scoring?.you.points ?? 0}
                    </span>
                    <span aria-hidden="true">–</span>
                    <span aria-label="Opponent score">
                      {game.scoring?.opponent.points ?? 0}
                    </span>
                  </span>
                )}
              </div>
              {selectedGame && (
                <div className="game-title-meta">
                  <div>
                    <GameMetadata game={selectedGame} />
                  </div>
                  {selectedGame.archived && <span>Archived</span>}
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
                {game.archived && (
                  <button
                    className="button secondary"
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
                    <Undo2 size={16} /> Restore game
                  </button>
                )}
                <button
                  className="button secondary manage-button"
                  aria-label="Game options"
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
          <div className="workspace-grid">
            <div className="board-column">
              <section ref={boardPanel} className="board-panel panel">
                <div className="board-toolbar">
                  <div>
                    <span className="board-name">
                      <Grid2X2 size={16} />
                      {game.template.name}
                    </span>
                    <span className="board-size">
                      {game.template.size} × {game.template.size}
                    </span>
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
                    <button
                      className="icon-button"
                      disabled={!game.past.length}
                      aria-label="Undo"
                      title="Undo"
                      onClick={undoGame}
                    >
                      <Undo2 size={17} />
                    </button>
                    <button
                      className="icon-button"
                      disabled={!game.future.length}
                      aria-label="Redo"
                      title="Redo"
                      onClick={() => update(redo(game))}
                    >
                      <Redo2 size={17} />
                    </button>
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
                <BoardEntry
                  key={game.id}
                  game={game}
                  preview={preview}
                  onChange={update}
                  onSelect={() => setPreview(null)}
                />
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
                    ...(game.template.premiums.some(
                      (p) => p === "QW" || p === "QL",
                    )
                      ? ["QW", "QL"]
                      : []),
                  ].map((p) => (
                    <span key={p}>
                      <i className={p.toLowerCase()} />
                      {p[0] === "T"
                        ? "Triple"
                        : p[0] === "Q"
                          ? "Quadruple"
                          : "Double"}{" "}
                      {p[1] === "W" ? "word" : "letter"}
                    </span>
                  ))}
                </div>
              </section>
              <section
                ref={rackPanel}
                className="rack-panel panel"
                onFocusCapture={() => {
                  if (activeFlight) setFlight(undefined);
                }}
              >
                <div className="rack-heading">
                  <h2>Your rack</h2>
                  <button
                    className="icon-button"
                    aria-label="Sort rack"
                    title="Sort rack"
                    onClick={() =>
                      update({
                        ...game,
                        ...sortRack(game),
                      })
                    }
                  >
                    <Shuffle size={16} />
                  </button>
                  <button
                    className="button primary solve-button"
                    disabled={!hasPlayableRack && !busy}
                    onClick={solve}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <Sparkles size={17} />
                    )}{" "}
                    {busy ? "Cancel" : "Find moves"}
                    {!busy && <ArrowRight size={17} />}
                  </button>
                </div>
                <RackEntry
                  key={game.id}
                  game={game}
                  onChange={update}
                  onSolve={solve}
                  onExchange={(slots) => setExchange({ key: signature, slots })}
                  flyingRack={
                    activeFlight?.compact === false ? activeFlight : undefined
                  }
                />
                <TilePool key={`tile-pool:${game.id}`} game={game} />
              </section>
              <GameScores
                key={game.id}
                game={game}
                onToggle={(enabled) => update(setScoreTracking(game, enabled))}
                onRecord={() => update(recordOpponentPlay(game))}
                onCorrection={() => update(treatBoardEditAsCorrection(game))}
                onChange={update}
              />
              <div className="dictionary-strip">
                <BookOpen size={15} />
                <label>
                  Word list
                  <select
                    aria-label="Game dictionary"
                    value={game.dictionaryId}
                    onChange={(e) =>
                      update({ ...game, dictionaryId: e.target.value })
                    }
                  >
                    {data.dictionaries.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="icon-button"
                  aria-label="About word lists"
                  onClick={() => openDialog("dictionaries")}
                >
                  <Info size={15} />
                </button>
              </div>
            </div>
            <div className="results-column">
              <Results
                results={solver.results}
                fetchPage={solver.page}
                fetchShortlist={solver.shortlist}
                busy={busy}
                elapsed={solver.elapsed}
                error={solver.error}
                size={game.template.size}
                rackSize={game.template.rackSize}
                bingoBonus={game.template.bingo}
                preview={preview}
                onPreview={setPreview}
                onPlay={play}
                onSolve={solve}
                hasRack={hasPlayableRack}
                analysisGame={game}
                analysisKey={signature}
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
              <div className="keyboard-tip">
                <span>TIP</span>Use <kbd>Space</kbd> for a blank in your rack.
                On the board, press Space before a letter to enter a blank.
              </div>
            </div>
          </div>
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
        <footer className="workspace-footer">
          <span>Less guessing. More good words.</span>
          <span>Tilemaxx · Local & personal</span>
        </footer>
      </main>
      {activeFlight?.compact && game && (
        <div
          className="mobile-preview-dock tile-flight-dock"
          ref={flightDock}
          aria-hidden="true"
          inert
        >
          <div className="dock-board">
            <Board template={game.template} board={game.board} compact />
          </div>
          <div className="flight-rack">
            {Array.from({ length: game.template.rackSize }, (_, slot) => {
              const consumed = activeFlight.slots.includes(slot);
              const letter = activeFlight.before.rack[slot];
              const tile = letter && letter !== "." && !consumed;
              return (
                <span
                  key={slot}
                  data-rack-slot={slot}
                  className={`rack-tile${tile ? "" : " empty"}${tile && letter === "?" ? " blank" : ""}`}
                >
                  {tile && letter !== "?" ? letter : ""}
                  {tile && (
                    <small>{tileScore(letter, game.template.rules)}</small>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}
      {workspace === "games" && preview && game && (
        <div className="mobile-preview-dock" aria-label="Move preview">
          <div className="dock-board">
            <Board
              template={game.template}
              board={game.board}
              archivedBoard={game.archived ? game.archivedBoard : undefined}
              preview={preview}
              compact
            />
          </div>
          <div className="dock-info">
            <button
              className="icon-button"
              aria-label="Close move preview"
              onClick={() => setPreview(null)}
            >
              <X size={18} />
            </button>
            <span className="eyebrow">PREVIEW</span>
            <strong>{preview.word}</strong>
            <span>{preview.score} points</span>
            {previewScore && <ScoreBreakdown breakdown={previewScore} />}
            <small>
              {coordinate(
                preview.row * game.template.size + preview.col,
                game.template.size,
              )}{" "}
              {preview.direction}
            </small>
            <button className="button primary" onClick={() => play(preview)}>
              Play
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}
      {game && exchange?.key === signature && (
        <ExchangeAnalysis
          game={game}
          slots={exchange.slots}
          onClose={() => setExchange(undefined)}
        />
      )}
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
          onApply={(board) => {
            const base = importBase.current!;
            const latest = store.getSnapshot().games[base.id];
            if (!latest || latest.board.join(".") !== base.board.join("."))
              throw new Error(
                "The board changed while you were reviewing. Close this import and try again with the latest game.",
              );
            update(importBoard(latest, board));
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
        <Modal
          title="A word for every game."
          subtitle="Choose a dictionary per game. Imported lists are available on all your devices."
          onClose={() => setDialog(null)}
        >
          <div className="dictionary-list">
            {data.dictionaries.map((d) => (
              <div key={d.id}>
                <span className="dictionary-icon">
                  <BookOpen size={20} />
                </span>
                <div>
                  <strong>
                    {d.name}
                    <span className="small muted">
                      {d.count.toLocaleString()} words
                    </span>
                  </strong>
                  <p>{d.description}</p>
                </div>
                {game?.dictionaryId === d.id && <Check size={18} />}
              </div>
            ))}
          </div>
          <div className="import-box">
            <h3>Bring your own word list</h3>
            <p>
              A .txt file with one English word per line. You can import NWL,
              other Collins editions, or your own house dictionary.
            </p>
            <label
              className={`button secondary file-button ${formBusy ? "disabled" : ""}`}
            >
              <Upload size={16} />
              {formBusy ? "Importing…" : "Import word list"}
              <input
                type="file"
                accept=".txt,text/plain"
                disabled={formBusy}
                aria-label="Import word list"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  void action(async () => {
                    if (file.size > 12_000_000)
                      throw new Error(
                        "Please choose a text file smaller than 12 MB.",
                      );
                    const dictionary = await store.importDictionary(
                      file.name.replace(/\.txt$/i, ""),
                      await file.text(),
                    );
                    notify(
                      `${dictionary.name} imported: ${dictionary.count.toLocaleString()} words.`,
                    );
                  });
                  e.target.value = "";
                }}
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>
          <p className="small muted">
            ENABLE and Wordnik are open word-game lists. Their contents differ
            from official tournament lists and the current Words With Friends
            dictionary.
          </p>
        </Modal>
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
        >
          <div className="game-option-list">
            <button onClick={() => openDialog("rename")}>
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
            <button
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
          {error && <p className="error">{error}</p>}
        </Modal>
      )}
    </div>
  );
}
