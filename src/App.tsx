import { useEffect, useRef, useState } from "react";
import {
  ImagePlus,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  CloudOff,
  Copy,
  Grid2X2,
  Flame,
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
import BoardEntry from "./components/BoardEntry";
import RackEntry from "./components/RackEntry";
import TilePool from "./components/TilePool";
import { rackLetters } from "../shared/rack-entry";
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
import {
  emptyScoring,
  playTrackedMove,
  recordOpponentPlay,
  setScoreTracking,
  treatBoardEditAsCorrection,
} from "../shared/game-scoring";
import { defaultDictionary } from "../shared/dictionaries";
import { type BoardOddsResult, type RackOdds } from "../shared/bingo-odds";
import { store, useStore } from "./store";
import {
  type BoardTemplate,
  type Game,
  type Move,
  archiveGame,
  coordinate,
  emptyBoard,
  redo,
  remember,
  restoreArchivedGame,
  tileScore,
  undo,
} from "../shared/model";

type Dialog =
  | "screenshot"
  | "new"
  | "boards"
  | "dictionaries"
  | "profile"
  | "rename-profile"
  | "history"
  | "help"
  | "rename"
  | "delete"
  | "manage"
  | null;
function saved(key: string, fallback = "") {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

const BRAND_LETTERS = "TILEMAX";
const BRAND_WORD = "tilemaxx";
const brandIndex = Math.floor(Math.random() * BRAND_LETTERS.length);
const brandLetter = BRAND_LETTERS[brandIndex];
const highlightedIndex =
  brandLetter === "X" && Math.random() < 0.5 ? brandIndex + 1 : brandIndex;
const brandOnFire = Math.random() < 0.1;

function BrandTile({ letter = brandLetter }: { letter?: string }) {
  return (
    <span
      className={`brand-mark${brandOnFire ? " on-fire" : ""}`}
      aria-hidden="true"
    >
      {brandOnFire && <Flame className="brand-flame" size={19} />}
      {letter}
      <small>{tileScore(letter, "scrabble")}</small>
    </span>
  );
}

function Brand() {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const selected = previewIndex ?? highlightedIndex;
  const reset = () => setPreviewIndex(null);

  return (
    <a
      className="brand"
      href="/"
      aria-label="Tilemaxx"
      onClick={(e) => e.preventDefault()}
    >
      <BrandTile letter={BRAND_WORD[selected].toUpperCase()} />
      <span>
        <span
          className="brand-word"
          onPointerLeave={reset}
          onPointerMove={(e) => {
            if (
              e.pointerType === "mouse" ||
              !e.currentTarget.hasPointerCapture(e.pointerId)
            )
              return;
            const letter = document
              .elementFromPoint(e.clientX, e.clientY)
              ?.closest<HTMLElement>("[data-brand-letter]");
            setPreviewIndex(
              letter && e.currentTarget.contains(letter)
                ? Number(letter.dataset.brandLetter)
                : null,
            );
          }}
          onPointerUp={(e) => {
            if (e.pointerType !== "mouse") reset();
          }}
          onPointerCancel={reset}
          onLostPointerCapture={reset}
        >
          {[...BRAND_WORD].map((letter, index) => (
            <span
              key={index}
              data-brand-letter={index}
              className={
                index === selected
                  ? `brand-highlight${brandOnFire ? " on-fire" : ""}`
                  : undefined
              }
              onPointerEnter={(e) => {
                if (e.pointerType === "mouse" || e.pointerType === "pen")
                  setPreviewIndex(index);
              }}
              onPointerDown={(e) => {
                if (e.pointerType === "mouse" || !e.isPrimary) return;
                e.currentTarget.parentElement?.setPointerCapture(e.pointerId);
                setPreviewIndex(index);
              }}
            >
              {letter}
            </span>
          ))}
        </span>
        <span className="brand-caption">A LITTLE WORD WISDOM</span>
      </span>
    </a>
  );
}

export default function App() {
  const state = useStore(),
    data = state.data;
  const [profileId, setProfileId] = useState(saved("tilewise:profile")),
    [gameId, setGameId] = useState(saved("tilewise:game"));
  const [dialog, setDialog] = useState<Dialog>(null),
    [sidebar, setSidebar] = useState(false),
    [toast, setToast] = useState(""),
    [error, setError] = useState("");
  const [theme, setTheme] = useState(saved("tilewise:theme", "system"));
  const [moves, setMoves] = useState<Move[] | null>(null),
    [preview, setPreview] = useState<Move | null>(null),
    [busy, setBusy] = useState(""),
    [solveError, setSolveError] = useState(""),
    [elapsed, setElapsed] = useState(0),
    [warnings, setWarnings] = useState<string[]>([]);
  const [rackOdds, setRackOdds] = useState<RackOdds>();
  const [rackOddsPending, setRackOddsPending] = useState(false);
  const [boardOdds, setBoardOdds] = useState<BoardOddsResult>();
  const [boardOddsProgress, setBoardOddsProgress] = useState<{
    checked: number;
    total: number;
  }>();
  const [boardOddsError, setBoardOddsError] = useState("");
  const [formName, setFormName] = useState(""),
    [formTrackScores, setFormTrackScores] = useState(true),
    [formTemplate, setFormTemplate] = useState("scrabble"),
    [formDictionary, setFormDictionary] = useState(""),
    [formBusy, setFormBusy] = useState(false);
  const [archiveView, setArchiveView] = useState(
    () => location.hash === "#archived-games",
  );
  const [archiveSort, setArchiveSort] = useState<ArchiveSort>("date");
  const [archiveEditId, setArchiveEditId] = useState<string>();
  const worker = useRef<Worker | null>(null),
    request = useRef(0),
    solverTask = useRef<"moves" | "rack-odds" | "board-odds" | null>(null),
    importBase = useRef<Game | null>(null);
  const game = data?.games.find((g) => g.id === gameId),
    profile = data?.profiles.find((p) => p.id === profileId);
  const editGame = archiveEditId
    ? data?.games.find(
        (g) => g.id === archiveEditId && g.profileId === profileId,
      )
    : game;
  const signature = game
    ? `${game.id}|${game.dictionaryId}|${game.rack}|${game.board.join(".")}`
    : "";
  useEffect(() => {
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
      setGameId(
        data.games.find(
          (g) => g.profileId === pid && g.id === last && !g.archived,
        )?.id ||
          data.games.find((g) => g.profileId === pid && !g.archived)?.id ||
          "",
      );
    }
  }, [data, profileId, gameId]);
  useEffect(() => {
    try {
      localStorage.setItem("tilewise:profile", profileId);
      localStorage.setItem("tilewise:game", gameId);
      if (gameId) localStorage.setItem(`tilewise:last:${profileId}`, gameId);
    } catch {}
  }, [profileId, gameId]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("tilewise:theme", theme);
    } catch {}
  }, [theme]);
  useEffect(() => {
    if (solverTask.current) stopSolver();
    setMoves(null);
    setPreview(null);
    setWarnings([]);
    setSolveError("");
    setBusy("");
    setRackOdds(undefined);
    setRackOddsPending(false);
    setBoardOdds(undefined);
    setBoardOddsProgress(undefined);
    setBoardOddsError("");
    request.current++;
  }, [signature]);
  useEffect(() => {
    setError("");
  }, [gameId]);
  useEffect(() => {
    const changeView = () => {
      setArchiveView(location.hash === "#archived-games");
      setDialog(null);
      setSidebar(false);
      setPreview(null);
    };
    window.addEventListener("hashchange", changeView);
    return () => window.removeEventListener("hashchange", changeView);
  }, []);
  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  function update(next: Game) {
    // Older archives have no saved baseline. Capture their board before the
    // first edit so that additions stay marked after reloading or undoing.
    if (next.archived && !next.archivedBoard) {
      const previous = data?.games.find((g) => g.id === next.id);
      const baseline = archiveGame(previous ?? next);
      next = {
        ...next,
        archivedBoard: baseline.archivedBoard,
        archivedState: baseline.archivedState,
      };
    }
    store.update(next);
  }
  function notify(text: string) {
    setToast(text);
  }
  function showArchive(open: boolean) {
    if (archiveView !== open)
      history.pushState(
        null,
        "",
        open ? "#archived-games" : location.pathname + location.search,
      );
    setArchiveView(open);
    setSidebar(false);
    setPreview(null);
  }
  function chooseGame(id: string) {
    if (archiveView) showArchive(false);
    setGameId(id);
    setSidebar(false);
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
    if (next === "rename-profile") setFormName(profile?.name || "");
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
  function stopSolver() {
    worker.current?.terminate();
    worker.current = null;
    solverTask.current = null;
    request.current++;
  }
  function solverWorker() {
    if (!worker.current) {
      const active = new Worker(
        new URL("./solver.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = active;
      active.onmessage = (e) => {
        const result = e.data;
        if (worker.current !== active || result.id !== request.current) return;
        if ("boardOddsProgress" in result) {
          setBoardOddsProgress(
            (previous) =>
              previous && { ...previous, checked: result.boardOddsProgress },
          );
          return;
        }
        if ("boardOdds" in result || "boardOddsError" in result) {
          solverTask.current = null;
          setBoardOddsProgress(undefined);
          setBoardOdds(result.boardOdds);
          setBoardOddsError(result.boardOddsError ?? "");
          return;
        }
        if ("rackOdds" in result || "rackOddsError" in result) {
          solverTask.current = null;
          setRackOddsPending(false);
          setRackOdds(
            result.rackOdds ?? {
              byLeave: {},
              exact: false,
              bagSize: 0,
              error: result.rackOddsError,
            },
          );
          return;
        }
        if (result.status) {
          setBusy(result.status);
          return;
        }
        solverTask.current = result.rackOddsPending ? "rack-odds" : null;
        setRackOddsPending(!!result.rackOddsPending);
        setBusy("");
        if (result.error) {
          setSolveError(result.error);
          return;
        }
        setMoves(result.moves);
        setWarnings(result.warnings);
        setElapsed(result.elapsed);
      };
      active.onerror = () => {
        if (worker.current !== active) return;
        const task = solverTask.current;
        stopSolver();
        setBusy("");
        setRackOddsPending(false);
        setBoardOddsProgress(undefined);
        if (task === "board-odds")
          setBoardOddsError("The board check stopped unexpectedly. Try again.");
        else if (task === "rack-odds")
          setRackOdds({
            byLeave: {},
            exact: false,
            bagSize: 0,
            error: "Bingo draw odds could not be calculated.",
          });
        else setSolveError("The solver stopped unexpectedly. Try again.");
      };
    }
    return worker.current;
  }
  function solve() {
    if (busy) {
      stopSolver();
      setBusy("");
      return;
    }
    if (!game || !rackLetters(game.rack)) return;
    if (solverTask.current) stopSolver();
    setPreview(null);
    setSolveError("");
    setBusy("Finding moves…");
    setRackOdds(undefined);
    setRackOddsPending(false);
    setBoardOdds(undefined);
    setBoardOddsProgress(undefined);
    setBoardOddsError("");
    solverTask.current = "moves";
    solverWorker().postMessage({
      id: ++request.current,
      dictionaryId: game.dictionaryId,
      board: game.board,
      rack: game.rack,
      template: game.template,
    });
  }
  function runBoardOdds(candidates: Move[], bagSize: number) {
    if (!game || solverTask.current || !candidates.length) return;
    setBoardOdds(undefined);
    setBoardOddsError("");
    setBoardOddsProgress({ checked: 0, total: candidates.length });
    solverTask.current = "board-odds";
    solverWorker().postMessage({
      id: ++request.current,
      kind: "board-odds",
      dictionaryId: game.dictionaryId,
      board: game.board,
      rack: game.rack,
      template: game.template,
      candidates,
      bagSize,
    });
  }
  function cancelBoardOdds() {
    if (solverTask.current !== "board-odds") return;
    stopSolver();
    setBoardOddsProgress(undefined);
  }
  function play(move: Move) {
    if (!game) return;
    try {
      update(playTrackedMove(game, move));
      notify(
        `${move.word} played for ${move.score} points. Add your new rack letters.`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const profileGames =
    data?.games.filter((g) => g.profileId === profileId) ?? [];
  const activeGames = profileGames.filter((g) => !g.archived);
  const archivedGames = profileGames.filter((g) => g.archived);
  const pending = game && state.pending.includes(game.id),
    conflict = game && state.conflicts[game.id];
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
        <button className="button new-game" onClick={() => openDialog("new")}>
          <Plus size={18} />
          New game
        </button>
        <div className="sidebar-divider" />
        <button
          className="nav-link"
          aria-current={archiveView ? undefined : "page"}
          onClick={() => showArchive(false)}
        >
          <Home size={18} />
          My games
        </button>
        <button
          className="nav-link"
          aria-current={archiveView ? "page" : undefined}
          onClick={() => showArchive(true)}
        >
          <Archive size={18} />
          Archived games
        </button>
        <button className="nav-link" onClick={() => openDialog("boards")}>
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
            <span className="avatar" aria-hidden="true">
              {profileLetter}
              <small>{tileScore(profileLetter, "scrabble")}</small>
            </span>
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
                {data.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value="new">+ New profile</option>
              </select>
            </span>
            <button
              className="icon-button"
              aria-label="Rename current profile"
              title="Rename profile"
              onClick={() => openDialog("rename-profile")}
            >
              <Pencil size={15} />
            </button>
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
              {archiveView ? "Archived games" : game?.name || "Your workspace"}
            </span>
          </div>
          <div className="topbar-actions">
            <span
              className={`sync-status ${!state.online || conflict ? "offline" : ""}`}
              title={state.error || "Games are saved on your server"}
            >
              {conflict ? (
                <Info size={14} />
              ) : !state.online ? (
                <CloudOff size={14} />
              ) : pending ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <CheckCheck size={15} />
              )}
              <span>
                {conflict
                  ? "Review changes"
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
        {!archiveView && (
          <div className="workspace-heading">
            <div>
              <div className="game-title-row">
                <GamePicker
                  game={game}
                  games={activeGames}
                  onChoose={chooseGame}
                />
              </div>
              {game && (
                <div className="game-title-meta">
                  <div>
                    <GameMetadata game={game} />
                  </div>
                  {game.archived && <span>Archived</span>}
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
        {archiveView ? (
          <ArchivedGames
            games={archivedGames}
            sort={archiveSort}
            onSort={setArchiveSort}
            onOpen={chooseGame}
            onEdit={(id) => {
              setArchiveEditId(id);
              setDialog("rename");
            }}
            onBack={() => showArchive(false)}
          />
        ) : game ? (
          <div className="workspace-grid">
            <div className="board-column">
              <section className="board-panel panel">
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
                      onClick={() => update(undo(game))}
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
              <section className="rack-panel panel">
                <div className="rack-heading">
                  <h2>Your rack</h2>
                  <span>
                    {rackLetters(game.rack).length} / {game.template.rackSize}{" "}
                    tiles
                  </span>
                  <button
                    className="icon-button"
                    aria-label="Sort rack"
                    title="Sort rack"
                    onClick={() =>
                      update({
                        ...game,
                        rack: rackLetters(game.rack).split("").sort().join(""),
                      })
                    }
                  >
                    <Shuffle size={16} />
                  </button>
                  <button
                    className="button primary solve-button"
                    disabled={!rackLetters(game.rack) && !busy}
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
                />
                <TilePool key={`tile-pool:${game.id}`} game={game} />
              </section>
              <GameScores
                key={game.id}
                game={game}
                onToggle={(enabled) => update(setScoreTracking(game, enabled))}
                onRecord={() => update(recordOpponentPlay(game))}
                onCorrection={() => update(treatBoardEditAsCorrection(game))}
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
                moves={moves}
                busy={busy}
                elapsed={elapsed}
                error={solveError}
                size={game.template.size}
                rackSize={game.template.rackSize}
                bingoBonus={game.template.bingo}
                preview={preview}
                onPreview={setPreview}
                onPlay={play}
                onSolve={solve}
                hasRack={!!rackLetters(game.rack)}
                analysisGame={game}
                analysisKey={signature}
                rackOdds={rackOdds}
                rackOddsPending={rackOddsPending}
                boardOdds={boardOdds}
                boardOddsProgress={boardOddsProgress}
                boardOddsError={boardOddsError}
                onBoardOdds={runBoardOdds}
                onCancelBoardOdds={cancelBoardOdds}
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
              Create a game for {profile?.name || "your profile"} to get
              started.
            </p>
            <button
              className="button primary"
              onClick={() => openDialog("new")}
            >
              <Plus size={16} />
              Create a game
            </button>
          </div>
        )}
        <footer className="workspace-footer">
          <span>Less guessing. More good words.</span>
          <span>Tilemaxx · Local & personal</span>
        </footer>
      </main>
      {!archiveView && preview && game && (
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
            const latest = store
              .getSnapshot()
              .data?.games.find((g) => g.id === base.id);
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
      {dialog === "boards" && (
        <BoardStudio
          onDelete={async (id) => {
            await store.deleteTemplate(id);
            notify("Custom board deleted. Existing games keep their layouts.");
          }}
          templates={data.templates}
          onClose={() => setDialog(null)}
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
      {(dialog === "profile" || dialog === "rename-profile") && (
        <Modal
          title={
            dialog === "rename-profile"
              ? "Rename your profile"
              : "Make yourself at home."
          }
          subtitle={
            dialog === "rename-profile"
              ? "Your new name will appear on all your devices. Your games stay with this profile."
              : "Pick the same profile on every device to find your games."
          }
          onClose={() => setDialog(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                if (dialog === "rename-profile") {
                  await store.renameProfile(profileId, formName.trim());
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
            {error && <p className="error">{error}</p>}
            <footer className="modal-footer">
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
      {dialog === "rename" && editGame && (
        <Modal title="Edit game details" onClose={() => setDialog(null)}>
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
              onClick={() => update(undo(game))}
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
