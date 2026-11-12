import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ImagePlus,
  ArrowRight,
  ArrowUpRight,
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
  LayoutGrid,
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
  UserRound,
  Wifi,
  X,
  Archive,
  Trash2,
} from "lucide-react";
import Board from "./components/Board";
import BoardStudio from "./components/BoardStudio";
import ScreenshotImport from "./components/ScreenshotImport";
import { importBoard } from "../shared/screenshot";
import Modal from "./components/Modal";
import Results from "./components/Results";
import { store, useStore } from "./store";
import {
  type BoardTemplate,
  type Game,
  type Move,
  applyMove,
  coordinate,
  emptyBoard,
  redo,
  remember,
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
  const [selected, setSelected] = useState<number | null>(null),
    [direction, setDirection] = useState<"across" | "down">("across"),
    [entry, setEntry] = useState("");
  const [moves, setMoves] = useState<Move[] | null>(null),
    [preview, setPreview] = useState<Move | null>(null),
    [busy, setBusy] = useState(""),
    [solveError, setSolveError] = useState(""),
    [elapsed, setElapsed] = useState(0),
    [warnings, setWarnings] = useState<string[]>([]);
  const [formName, setFormName] = useState(""),
    [formTemplate, setFormTemplate] = useState("scrabble"),
    [formDictionary, setFormDictionary] = useState(""),
    [formBusy, setFormBusy] = useState(false),
    [showArchive, setShowArchive] = useState(false);
  const worker = useRef<Worker | null>(null),
    request = useRef(0),
    searching = useRef(false),
    wordInput = useRef<HTMLInputElement>(null),
    keepWordFocus = useRef(false),
    importBase = useRef<Game | null>(null),
    rackInput = useRef<HTMLInputElement>(null);
  const game = data?.games.find((g) => g.id === gameId),
    profile = data?.profiles.find((p) => p.id === profileId);
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
    if (searching.current) {
      worker.current?.terminate();
      worker.current = null;
      searching.current = false;
    }
    setMoves(null);
    setPreview(null);
    setWarnings([]);
    setSolveError("");
    setBusy("");
    request.current++;
  }, [signature]);
  useEffect(() => {
    setSelected(null);
    setEntry("");
    setError("");
  }, [gameId]);
  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  function update(next: Game) {
    store.update(next);
  }
  function notify(text: string) {
    setToast(text);
  }
  function chooseGame(id: string) {
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
      setFormName("");
      setFormTemplate("scrabble");
      setFormDictionary(
        game?.dictionaryId ||
          data?.dictionaries.find((d) => d.id === "csw24")?.id ||
          data?.dictionaries[0]?.id ||
          "",
      );
    }
    if (next === "rename") setFormName(game?.name || "");
    if (next === "profile") setFormName("");
    if (next === "rename-profile") setFormName(profile?.name || "");
  }
  function toggleDirection() {
    setDirection((current) => (current === "across" ? "down" : "across"));
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
    if (busy) {
      worker.current?.terminate();
      worker.current = null;
      searching.current = false;
      setBusy("");
      request.current++;
      return;
    }
    if (!game?.rack) return;
    if (!worker.current) {
      worker.current = new Worker(
        new URL("./solver.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current.onmessage = (e) => {
        const result = e.data;
        if (result.id !== request.current) return;
        if (result.status) {
          setBusy(result.status);
          return;
        }
        searching.current = false;
        setBusy("");
        if (result.error) {
          setSolveError(result.error);
          return;
        }
        setMoves(result.moves);
        setWarnings(result.warnings);
        setElapsed(result.elapsed);
      };
      worker.current.onerror = () => {
        searching.current = false;
        setBusy("");
        setSolveError("The solver stopped unexpectedly. Try again.");
        worker.current?.terminate();
        worker.current = null;
      };
    }
    setPreview(null);
    setSolveError("");
    setBusy("Finding moves…");
    searching.current = true;
    worker.current.postMessage({
      id: ++request.current,
      dictionaryId: game.dictionaryId,
      board: game.board,
      rack: game.rack,
      template: game.template,
    });
  }
  function play(move: Move) {
    if (!game) return;
    try {
      update(applyMove(game, move));
      notify(
        `${move.word} played for ${move.score} points. Add your new rack letters.`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function enterWord() {
    if (!game || selected === null || !entry) return;
    const text = entry.replace(/[^a-zA-Z.]/g, "").toUpperCase(),
      n = game.template.size;
    const available =
      direction === "across"
        ? n - (selected % n)
        : n - Math.floor(selected / n);
    if (text.length > available) {
      setError("That word runs past the edge of the board.");
      return;
    }
    const board = [...game.board];
    for (let k = 0; k < text.length; k++)
      if (text[k] !== ".")
        board[selected + k * (direction === "across" ? 1 : n)] = text[k];
    update({ ...game, ...remember(game, `Entered ${text}`), board });
    setEntry("");
    setError("");
  }
  function editCell(blank = false) {
    if (!game || selected === null) return;
    const board = [...game.board];
    if (blank) {
      if (!board[selected]) return;
      board[selected] =
        board[selected] === board[selected].toUpperCase()
          ? board[selected].toLowerCase()
          : board[selected].toUpperCase();
    } else board[selected] = "";
    update({
      ...game,
      ...remember(game, blank ? "Changed blank tile" : "Erased a tile"),
      board,
    });
  }
  const profileGames =
    data?.games.filter(
      (g) => g.profileId === profileId && g.archived === showArchive,
    ) || [];
  const pending = game && state.pending.includes(game.id),
    conflict = game && state.conflicts[game.id];
  if (!data)
    return (
      <div className="loading-screen">
        <div className="brand-mark">
          T<small>1</small>
        </div>
        <h1>Tilewise</h1>
        {state.error ? (
          <>
            <p>Cannot reach the Tilewise server.</p>
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
        <a className="brand" href="/" onClick={(e) => e.preventDefault()}>
          <span className="brand-mark">
            T<small>1</small>
          </span>
          <span>
            tilewise<span className="brand-caption">A LITTLE WORD WISDOM</span>
          </span>
        </a>
        <button className="button new-game" onClick={() => openDialog("new")}>
          <Plus size={18} />
          New game
        </button>
        <div className="sidebar-label">YOUR WORKSPACE</div>
        <button
          className="nav-link selected-nav"
          onClick={() => setSidebar(false)}
        >
          <LayoutGrid size={18} />
          My games
          <span className="nav-count">
            {
              data.games.filter((g) => g.profileId === profileId && !g.archived)
                .length
            }
          </span>
        </button>
        <div className="game-list">
          {profileGames.map((g) => (
            <button
              className={`game-link ${g.id === gameId ? "active" : ""}`}
              key={g.id}
              onClick={() => chooseGame(g.id)}
            >
              <span className="game-dot" />
              <span>
                {g.name}
                <small>{g.template.name}</small>
              </span>
              {g.id === gameId && <ChevronDown size={14} />}
            </button>
          ))}
          {!profileGames.length && (
            <p className="small muted no-games">
              {showArchive
                ? "No archived games."
                : "Your next game starts here."}
            </p>
          )}
        </div>
        <button
          className="text-button archive-toggle"
          onClick={() => setShowArchive(!showArchive)}
        >
          <Archive size={14} />
          {showArchive ? "Show active games" : "Archived games"}
        </button>
        <div className="sidebar-divider" />
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
            <span className="avatar">
              <UserRound size={18} />
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
              aria-label="Open games menu"
              onClick={() => setSidebar(true)}
            >
              <Menu size={20} />
            </button>
            <Home size={15} />
            <span>My games</span>
            <span className="breadcrumb-slash">/</span>
            <span>{game?.name || "Your workspace"}</span>
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
        <div className="workspace-heading">
          <div>
            <div className="eyebrow">MAKE ROOM FOR A GREAT WORD</div>
            <h1>
              {game?.name || "A fresh start."}
              {game && (
                <button
                  className="icon-button edit-title"
                  aria-label="Rename game"
                  onClick={() => openDialog("rename")}
                >
                  <Pencil size={16} />
                </button>
              )}
            </h1>
            <p>Your board. Your letters. All the possibilities.</p>
          </div>
          {game && (
            <button
              className="button secondary manage-button"
              aria-label="Game options"
              onClick={() => openDialog("manage")}
            >
              <MoreHorizontal size={18} />
              <span>Game options</span>
            </button>
          )}
        </div>
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
        {game ? (
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
                <Board
                  template={game.template}
                  board={game.board}
                  preview={preview}
                  selected={selected}
                  onSelect={(i) => {
                    setSelected(i);
                    setPreview(null);
                    wordInput.current?.focus({ preventScroll: true });
                  }}
                />
                <div className="board-legend">
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
                <div className="entry-panel">
                  <div className="entry-heading">
                    <span>
                      <Pencil size={14} />
                      {selected === null
                        ? "Click a square to enter the board"
                        : `Enter at ${coordinate(selected, game.template.size)}`}
                    </span>
                    <button
                      className="text-button direction-button"
                      aria-label="Toggle entry direction"
                      title="Switch Across/Down (Shift+Enter)"
                      aria-keyshortcuts="Shift+Enter"
                      onPointerDown={(e) => {
                        keepWordFocus.current =
                          document.activeElement === wordInput.current;
                        // Prevent the pointer's default focus transfer, keeping
                        // the iPhone keyboard open and preserving the caret.
                        if (keepWordFocus.current) e.preventDefault();
                      }}
                      onClick={() => {
                        toggleDirection();
                        if (keepWordFocus.current)
                          wordInput.current?.focus({ preventScroll: true });
                        keepWordFocus.current = false;
                      }}
                    >
                      {direction === "across" ? (
                        <ArrowRight size={16} />
                      ) : (
                        <ArrowDown size={16} />
                      )}{" "}
                      {direction === "across" ? "Across" : "Down"}
                      <kbd className="direction-shortcut" aria-hidden="true">
                        ⇧↵
                      </kbd>
                    </button>
                  </div>
                  <form
                    className="entry-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      enterWord();
                    }}
                  >
                    <input
                      ref={wordInput}
                      aria-label="Word to enter on board"
                      placeholder={
                        selected === null
                          ? "Select a starting square…"
                          : "Type a word, then press Enter"
                      }
                      value={entry}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      onChange={(e) =>
                        setEntry(
                          e.target.value
                            .replace(/[^a-zA-Z.]/g, "")
                            .toUpperCase(),
                        )
                      }
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          e.shiftKey &&
                          !e.nativeEvent.isComposing
                        ) {
                          e.preventDefault();
                          if (!e.repeat) toggleDirection();
                          return;
                        }
                        if (selected === null) return;
                        if (e.key === "Escape") {
                          setSelected(null);
                          setEntry("");
                        }
                        if (
                          !entry &&
                          [
                            "ArrowLeft",
                            "ArrowRight",
                            "ArrowUp",
                            "ArrowDown",
                          ].includes(e.key)
                        ) {
                          e.preventDefault();
                          const n = game.template.size,
                            r = Math.floor(selected / n),
                            c = selected % n;
                          const dr =
                              e.key === "ArrowDown"
                                ? 1
                                : e.key === "ArrowUp"
                                  ? -1
                                  : 0,
                            dc =
                              e.key === "ArrowRight"
                                ? 1
                                : e.key === "ArrowLeft"
                                  ? -1
                                  : 0;
                          if (
                            r + dr >= 0 &&
                            r + dr < n &&
                            c + dc >= 0 &&
                            c + dc < n
                          )
                            setSelected((r + dr) * n + c + dc);
                        }
                        if (
                          !entry &&
                          (e.key === "Backspace" || e.key === "Delete")
                        ) {
                          e.preventDefault();
                          editCell();
                        }
                      }}
                    />
                    <button
                      className="button secondary"
                      disabled={selected === null || !entry}
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Erase selected tile"
                      title="Erase selected tile"
                      disabled={selected === null || !game.board[selected]}
                      onClick={() => editCell()}
                    >
                      <Trash2 size={16} />
                    </button>
                  </form>
                  <div className="entry-note">
                    <span>
                      Enter opponent moves here · a dot skips a square
                    </span>
                    <button
                      className={`text-button ${selected !== null && game.board[selected] && game.board[selected] === game.board[selected].toLowerCase() ? "active" : ""}`}
                      disabled={selected === null || !game.board[selected]}
                      onClick={() => editCell(true)}
                    >
                      Blank tile:{" "}
                      {selected !== null &&
                      game.board[selected] &&
                      game.board[selected] ===
                        game.board[selected].toLowerCase()
                        ? "on"
                        : "off"}
                    </button>
                  </div>
                </div>
              </section>
              <section className="rack-panel panel">
                <div className="rack-heading">
                  <h2>Your rack</h2>
                  <span>
                    {game.rack.length} / {game.template.rackSize} tiles{" "}
                    <span className="rack-hint">· ? is a blank</span>
                  </span>
                  <button
                    className="icon-button"
                    aria-label="Sort rack"
                    title="Sort rack"
                    onClick={() =>
                      update({
                        ...game,
                        rack: game.rack.split("").sort().join(""),
                      })
                    }
                  >
                    <Shuffle size={16} />
                  </button>
                </div>
                <div
                  className="rack-tiles"
                  onClick={() => rackInput.current?.focus()}
                >
                  {Array.from({ length: game.template.rackSize }, (_, i) => {
                    const tile = game.rack[i];
                    return (
                      <span
                        key={i}
                        className={`rack-tile ${!tile ? "empty" : ""}`}
                      >
                        {tile === "?" ? "" : tile || "·"}
                        {tile && (
                          <small>
                            {tile === "?"
                              ? 0
                              : tileScore(tile, game.template.rules)}
                          </small>
                        )}
                      </span>
                    );
                  })}
                </div>
                <div className="rack-input-row">
                  <input
                    aria-label="Rack letters"
                    ref={rackInput}
                    value={game.rack}
                    placeholder="Type your letters…"
                    maxLength={game.template.rackSize * 2}
                    autoCapitalize="characters"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) =>
                      update({
                        ...game,
                        rack: e.target.value
                          .toUpperCase()
                          .replace(/[^A-Z?]/g, "")
                          .slice(0, game.template.rackSize),
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") solve();
                    }}
                  />
                  <button
                    className="button primary solve-button"
                    disabled={!game.rack && !busy}
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
              </section>
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
                preview={preview}
                onPreview={setPreview}
                onPlay={play}
                onSolve={solve}
                hasRack={!!game.rack}
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
                <span>TIP</span>Use <kbd>?</kbd> for a blank in your rack. On
                the board, select a letter and turn on “Blank tile”.
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
          <span>Tilewise · Local & personal</span>
        </footer>
      </main>
      {preview && game && (
        <div className="mobile-preview-dock" aria-label="Move preview">
          <div className="dock-board">
            <Board
              template={game.template}
              board={game.board}
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
            setSelected(null);
            setEntry("");
            notify("Screenshot imported. You can undo this change.");
          }}
        />
      )}
      {dialog === "boards" && (
        <BoardStudio
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
        <Modal
          title="A new game, a fresh board."
          subtitle="Every game keeps its own board, rack, and history."
          onClose={() => setDialog(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                const template = data.templates.find(
                  (t) => t.id === formTemplate,
                )!;
                const created = await store.createGame({
                  profileId,
                  name:
                    formName.trim() ||
                    `Game ${data.games.filter((g) => g.profileId === profileId).length + 1}`,
                  template,
                  dictionaryId: formDictionary,
                  board: emptyBoard(template.size),
                  rack: "",
                  past: [],
                  future: [],
                  archived: false,
                });
                chooseGame(created.id);
                setDialog(null);
              });
            }}
          >
            <label>
              Game name
              <input
                autoFocus
                placeholder="Sunday afternoon"
                maxLength={80}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </label>
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
      {dialog === "rename" && game && (
        <Modal title="Name your game" onClose={() => setDialog(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              update({ ...game, name: formName.trim() });
              setDialog(null);
            }}
          >
            <label>
              Game name
              <input
                autoFocus
                required
                maxLength={80}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </label>
            <footer className="modal-footer">
              <button className="button primary" disabled={!formName.trim()}>
                Save name
              </button>
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
                      {new Date(h.at).toLocaleString()} · rack{" "}
                      {h.rack || "empty"}
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
          subtitle="Open Tilewise on your iPhone or Mac, then choose the same profile."
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
              Open your NAS’s Tilewise address in Safari. While testing on the
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
          title="A little housekeeping."
          subtitle={game.name}
          onClose={() => setDialog(null)}
        >
          <div className="game-option-list">
            <button
              onClick={() =>
                void action(async () => {
                  const copy = await store.createGame({
                    ...game,
                    name: `${game.name.slice(0, 65)} (copy)`,
                    archived: false,
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
                update({ ...game, archived: !game.archived });
                setShowArchive(!game.archived);
                setDialog(null);
                notify(
                  game.archived
                    ? "Game restored."
                    : "Game archived. You can restore it any time.",
                );
              }}
            >
              <Archive size={19} />
              <span>
                <strong>
                  {game.archived ? "Restore game" : "Archive game"}
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
