import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { ArrowDown, ArrowRight, Trash2 } from "lucide-react";
import Board from "./Board";
import { parseBoardCoordinate } from "./BoardCoordinates";
import { BoardEditHistory } from "../../shared/board-entry";
import { boardWordsAt } from "../../shared/game-scoring";
import {
  coordinate,
  type Board as BoardState,
  type BoardTemplate,
  type Game,
  type Move,
} from "../../shared/model";

// A sentinel lets mobile keyboards send deletion even when no text is waiting.
// The actual letters live on the board; this input only receives keyboard events.
const SENTINEL = "\u200b";
type Direction = "across" | "down";
type EditKind = "enter" | "erase" | "blank";
type MoveFilterSelection = {
  marks: ReadonlySet<number>;
  onToggle?: (index: number) => void;
};

export type BoardEntryHandle = {
  toggleCoordinateOverlay: () => "opened" | "closed" | false;
};

export default function BoardEntry({
  ref,
  game,
  hideHelp,
  readOnly,
  displayBoard,
  preview,
  onChange,
  onSelect,
  onSolve,
  moveFilter,
  historyControls,
  overlay,
}: {
  ref?: Ref<BoardEntryHandle>;
  game: Game;
  hideHelp?: boolean;
  readOnly?: boolean;
  displayBoard?: BoardState;
  preview: Move | null;
  onChange: (game: Game) => void;
  onSelect: () => void;
  onSolve?: () => void;
  moveFilter?: MoveFilterSelection;
  historyControls?: ReactNode;
  overlay?: ReactNode;
}) {
  const history = useRef(new BoardEditHistory());
  const wordScores = useCallback(
    (index: number) => boardWordsAt(game, index),
    [game],
  );
  return (
    <BoardInput
      ref={displayBoard ? undefined : ref}
      board={displayBoard ?? game.board}
      hideHelp={hideHelp}
      readOnly={readOnly}
      archivedBoard={game.archived ? game.archivedBoard : undefined}
      template={game.template}
      preview={preview}
      wordScores={displayBoard ? undefined : wordScores}
      onSelect={onSelect}
      onSolve={onSolve}
      moveFilter={moveFilter}
      historyControls={historyControls}
      overlay={overlay}
      onBreak={() => history.current.reset()}
      onChange={(board, kind) => {
        if (displayBoard) return;
        const next = history.current.apply(game, board, kind);
        if (next !== game) onChange(next);
      }}
    />
  );
}

export function BoardInput({
  ref,
  board,
  archivedBoard,
  template,
  preview,
  onChange,
  onSelect,
  onSolve,
  onBreak,
  onCursorChange,
  selection,
  uncertain,
  inputLabel = "Type on board",
  hideHelp = false,
  readOnly = false,
  wordScores,
  moveFilter,
  historyControls,
  overlay,
}: {
  ref?: Ref<BoardEntryHandle>;
  board: BoardState;
  archivedBoard?: BoardState;
  template: BoardTemplate;
  preview?: Move | null;
  onChange: (board: BoardState, kind: EditKind) => void;
  onSelect?: () => void;
  onSolve?: () => void;
  onBreak?: () => void;
  onCursorChange?: (index: number | null) => void;
  selection?: { index: number };
  uncertain?: ReadonlySet<number>;
  inputLabel?: string;
  hideHelp?: boolean;
  readOnly?: boolean;
  wordScores?: (index: number) => ReturnType<typeof boardWordsAt>;
  moveFilter?: MoveFilterSelection;
  historyControls?: ReactNode;
  overlay?: ReactNode;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [direction, setDirection] = useState<Direction>("across");
  const [pendingBlank, setPendingBlank] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const [coordinateQuery, setCoordinateQuery] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const focusing = useRef(false);
  const shiftHeld = useRef(false);
  const breakHistory = useRef(onBreak);
  breakHistory.current = onBreak;
  const resetHistory = () => breakHistory.current?.();
  useEffect(() => {
    const reset = () => {
      breakHistory.current?.();
      shiftHeld.current = false;
      setFocused(false);
      setPendingBlank(false);
      setCoordinateQuery(null);
    };
    const restore = () => setFocused(document.activeElement === input.current);
    const visibility = () => {
      if (document.hidden) reset();
    };
    window.addEventListener("blur", reset);
    window.addEventListener("focus", restore);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", reset);
      window.removeEventListener("focus", restore);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => onCursorChange?.(selected), [selected, onCursorChange]);
  useEffect(() => {
    if (!selection) return;
    setSelected(selection.index);
    setPendingBlank(false);
    setAtEnd(false);
  }, [selection]);
  const helpId = useId();
  const n = template.size;
  const tile = selected === null ? "" : board[selected];
  const isBlank = Boolean(tile && tile === tile.toLowerCase());
  const cursor = focused && selected !== null ? coordinate(selected, n) : "";
  const toggleMark = readOnly ? undefined : moveFilter?.onToggle;
  const locating = coordinateQuery !== null && !readOnly && !toggleMark;
  const target = locating ? parseBoardCoordinate(coordinateQuery, n) : null;
  const instruction = pendingBlank
    ? "Type a blank’s letter"
    : atEnd
      ? historyControls
        ? "Board edge"
        : "Board edge — choose another square"
      : "Type to enter";
  const status = locating
    ? coordinateStatus()
    : readOnly
      ? "Board locked"
      : cursor
        ? `${cursor} · ${instruction}`
        : "Tap a square and type";
  const help = <BoardEntryHelp id={helpId} hidden={hideHelp} />;

  useImperativeHandle(ref, () => ({
    toggleCoordinateOverlay() {
      if (readOnly || toggleMark) return false;
      if (locating) {
        closeCoordinateOverlay();
        return "closed";
      }
      resetHistory();
      setPendingBlank(false);
      setCoordinateQuery("");
      // Clear any pinned move before focusing the board keyboard.
      if (document.activeElement === input.current) onSelect?.();
      focus();
      return "opened";
    },
  }));

  useEffect(() => {
    if (readOnly || toggleMark) setCoordinateQuery(null);
  }, [readOnly, toggleMark]);

  function coordinateStatus() {
    if (!target)
      return coordinateQuery
        ? `Use A1–${coordinate(n * n - 1, n)}`
        : "Type a coordinate";
    if (target.row === null && target.column !== null)
      return `Column ${coordinate(target.column, n)[0]} · ← →`;
    if (target.column === null && target.row !== null)
      return `Row ${target.row + 1} · ↑ ↓`;
    return `${coordinateQuery} · Enter ↵`;
  }

  function chooseCoordinate(match: typeof target) {
    if (!match || match.row === null || match.column === null) return false;
    select(match.row * n + match.column, false);
    setDirection(match.direction);
    return true;
  }

  function appendCoordinate(text: string) {
    const typed = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const next = ((coordinateQuery ?? "") + typed).slice(0, 3);
    const match = parseBoardCoordinate(next, n);
    if (!match || match.ambiguous || !chooseCoordinate(match))
      setCoordinateQuery(next);
  }

  function closeCoordinateOverlay() {
    setCoordinateQuery(null);
    input.current?.blur();
  }

  function coordinateKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      closeCoordinateOverlay();
    } else if (event.key === "Backspace" || event.key === "Delete") {
      setCoordinateQuery(coordinateQuery?.slice(0, -1) ?? "");
    } else if (event.key === "Enter") {
      chooseCoordinate(target);
    } else if (event.key.startsWith("Arrow")) {
      if (target?.row === null && target.column !== null) {
        const column =
          target.column +
          Number(event.key === "ArrowRight") -
          Number(event.key === "ArrowLeft");
        if (column >= 0 && column < n)
          setCoordinateQuery(coordinate(column, n)[0]);
      } else if (target?.column === null && target.row !== null) {
        const row =
          target.row + Number(event.key === "ArrowDown") - Number(event.key === "ArrowUp");
        if (row >= 0 && row < n) setCoordinateQuery(String(row + 1));
      }
    } else return;
    event.preventDefault();
  }

  function focus() {
    setFocused(true);
    focusing.current = true;
    input.current?.focus({ preventScroll: true });
    focusing.current = false;
    input.current?.setSelectionRange(SENTINEL.length, SENTINEL.length);
  }
  function select(i: number, repeatTap?: boolean) {
    resetHistory();
    setCoordinateQuery(null);
    if (!locating && (repeatTap ?? (focused && i === selected))) toggleDirection();
    else {
      setSelected(i);
      setPendingBlank(false);
      setAtEnd(false);
    }
    onSelect?.();
    // Synchronous focus within the tap is needed to open the iPhone keyboard.
    focus();
  }
  function toggleDirection() {
    resetHistory();
    setDirection((d) => (d === "across" ? "down" : "across"));
    setAtEnd(false);
  }
  function neighbor(i: number, dr: number, dc: number) {
    const r = Math.floor(i / n) + dr,
      c = (i % n) + dc;
    return r >= 0 && r < n && c >= 0 && c < n ? r * n + c : null;
  }
  function move(dr: number, dc: number) {
    resetHistory();
    if (selected === null) return;
    const next = neighbor(selected, dr, dc);
    if (next !== null) {
      setSelected(next);
      setPendingBlank(false);
      setAtEnd(false);
    }
  }
  function save(next: string[], kind: EditKind) {
    if (!readOnly && next.some((letter, i) => letter !== board[i]))
      onChange(next, kind);
  }
  function erase(backspace = false) {
    if (selected === null) return;
    if (pendingBlank) {
      setPendingBlank(false);
      return;
    }
    let i = selected;
    if (backspace && !tile) {
      i =
        neighbor(
          i,
          direction === "down" ? -1 : 0,
          direction === "across" ? -1 : 0,
        ) ?? i;
    }
    const next = [...board];
    next[i] = "";
    save(next, "erase");
    setSelected(i);
    setAtEnd(false);
  }
  function enter(text: string) {
    if (selected === null) return;
    let i = selected,
      blank = pendingBlank,
      end = atEnd;
    const nextBoard = [...board];
    for (const char of text) {
      if (char === " ") {
        if (!end) blank = !blank;
        continue;
      }
      if (!/^[a-z.]$/i.test(char) || end) continue;
      if (char !== ".")
        nextBoard[i] = blank ? char.toLowerCase() : char.toUpperCase();
      blank = false;
      const next = neighbor(
        i,
        direction === "down" ? 1 : 0,
        direction === "across" ? 1 : 0,
      );
      if (next === null) end = true;
      else i = next;
    }
    save(nextBoard, "enter");
    setSelected(i);
    setPendingBlank(blank);
    setAtEnd(end);
  }
  function toggleBlank() {
    if (selected === null) return;
    if (tile) {
      const next = [...board];
      next[selected] = isBlank ? tile.toUpperCase() : tile.toLowerCase();
      save(next, "blank");
    } else setPendingBlank((v) => !v);
    focus();
  }

  return (
    <div
      className={`board-entry${toggleMark ? " selecting-move-squares" : ""}`}
    >
      <Board
        template={template}
        board={board}
        archivedBoard={archivedBoard}
        preview={preview}
        disabled={readOnly}
        selected={
          !readOnly && (focused || onCursorChange) && !preview && !toggleMark && !locating
            ? selected
            : null
        }
        markedSquares={moveFilter?.marks}
        selectingSquares={!!toggleMark}
        onSelect={toggleMark ?? select}
        entryDirection={direction}
        pendingBlank={pendingBlank}
        uncertain={uncertain}
        wordScores={readOnly || toggleMark || locating ? undefined : wordScores}
        keepInputFocus={!toggleMark}
        coordinateSelection={
          locating ? (target ?? { row: null, column: null }) : undefined
        }
        overlay={overlay}
      />
      <input
        ref={input}
        className="board-keyboard-input"
        aria-label={inputLabel}
        aria-describedby={helpId}
        aria-keyshortcuts={ref && !readOnly && !toggleMark ? "Alt+B" : undefined}
        disabled={readOnly || !!toggleMark}
        value={SENTINEL}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        enterKeyHint={onSolve ? "search" : undefined}
        spellCheck={false}
        onFocus={() => {
          setFocused(true);
          if (selected === null && !focusing.current)
            setSelected(template.start);
          onSelect?.();
        }}
        onBlur={() => {
          resetHistory();
          shiftHeld.current = false;
          setCoordinateQuery(null);
          setFocused(false);
          setPendingBlank(false);
        }}
        onChange={(e) => {
          const text = e.currentTarget.value.replaceAll(SENTINEL, "");
          if (locating) appendCoordinate(text);
          else if (!e.currentTarget.value) erase(true);
          else enter(text);
          e.currentTarget.value = SENTINEL;
          e.currentTarget.setSelectionRange(1, 1);
        }}
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData("text");
          if (locating) appendCoordinate(text);
          else enter(text);
        }}
        onKeyUp={(e) => {
          if (e.key === "Shift") shiftHeld.current = false;
        }}
        onKeyDown={(e) => {
          if (readOnly) return;
          if (e.key === "Shift") shiftHeld.current = true;
          if (e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey)
            return;
          if (locating) {
            coordinateKey(e);
            return;
          }
          if (
            ![
              "ArrowRight",
              "ArrowDown",
              "ArrowLeft",
              "ArrowUp",
              "Backspace",
              "Delete",
              "Escape",
              "Enter",
            ].includes(e.key)
          )
            return;
          e.preventDefault();
          switch (e.key) {
            case "ArrowRight":
              if (direction === "down") {
                resetHistory();
                setDirection("across");
                setAtEnd(false);
              } else move(0, 1);
              break;
            case "ArrowDown":
              if (direction === "across") {
                resetHistory();
                setDirection("down");
                setAtEnd(false);
              } else move(1, 0);
              break;
            case "ArrowLeft":
              move(0, -1);
              break;
            case "ArrowUp":
              move(-1, 0);
              break;
            case "Backspace":
              erase(true);
              break;
            case "Delete":
              erase();
              break;
            case "Enter":
              if (e.repeat) break;
              // iOS auto-capitalization can set shiftKey on the Search key.
              if (e.shiftKey && shiftHeld.current) toggleDirection();
              else if (onSolve) {
                e.currentTarget.blur();
                onSolve();
              }
              break;
            case "Escape":
              setSelected(null);
              setPendingBlank(false);
              setAtEnd(false);
              input.current?.blur();
          }
        }}
      />
      <div
        className={`direct-entry-tools${historyControls ? " with-board-history" : ""}`}
      >
        <div className="direct-entry-status" role="status">
          {status}
        </div>
        <div className="direct-entry-actions">
          <button
            className="text-button direction-button"
            disabled={readOnly || locating}
            aria-label="Toggle entry direction"
            title="Right/Down switches direction; Shift+Enter also toggles"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              toggleDirection();
              focus();
            }}
          >
            {direction === "across" ? (
              <ArrowRight size={16} />
            ) : (
              <ArrowDown size={16} />
            )}
            {direction === "across" ? "Across" : "Down"}
          </button>
          <button
            className={`text-button ${pendingBlank || isBlank ? "active" : ""}`}
            disabled={readOnly || locating || selected === null}
            aria-label={`Blank tile: ${pendingBlank || isBlank ? "on" : "off"}`}
            aria-pressed={pendingBlank || isBlank}
            onPointerDown={(e) => e.preventDefault()}
            onClick={toggleBlank}
          >
            {historyControls
              ? "Blank"
              : `Blank tile: ${pendingBlank || isBlank ? "on" : "off"}`}
          </button>
          <button
            className="icon-button"
            aria-label="Erase selected tile"
            title="Erase selected tile"
            disabled={readOnly || locating || selected === null || (!tile && !pendingBlank)}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              erase();
              focus();
            }}
          >
            <Trash2 size={15} />
          </button>
          {historyControls}
        </div>
        {!historyControls && help}
      </div>
      {historyControls && help}
    </div>
  );
}

export function BoardEntryHelp({
  id,
  hidden,
}: {
  id?: string;
  hidden?: boolean;
}) {
  return (
    <p id={id} className="direct-entry-help" hidden={hidden}>
      Tap again to turn · Space then letter = blank · . skips a square
    </p>
  );
}
