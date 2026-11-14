import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowRight, Trash2 } from "lucide-react";
import Board from "./Board";
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

export default function BoardEntry({
  game,
  hideHelp,
  displayBoard,
  preview,
  onChange,
  onSelect,
}: {
  game: Game;
  hideHelp?: boolean;
  displayBoard?: BoardState;
  preview: Move | null;
  onChange: (game: Game) => void;
  onSelect: () => void;
}) {
  const history = useRef(new BoardEditHistory());
  const wordScores = useCallback(
    (index: number) => boardWordsAt(game, index),
    [game],
  );
  return (
    <BoardInput
      board={displayBoard ?? game.board}
      hideHelp={hideHelp}
      archivedBoard={game.archived ? game.archivedBoard : undefined}
      template={game.template}
      preview={preview}
      wordScores={displayBoard ? undefined : wordScores}
      onSelect={onSelect}
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
  board,
  archivedBoard,
  template,
  preview,
  onChange,
  onSelect,
  onBreak,
  onCursorChange,
  selection,
  uncertain,
  inputLabel = "Type on board",
  hideHelp = false,
  wordScores,
}: {
  board: BoardState;
  archivedBoard?: BoardState;
  template: BoardTemplate;
  preview?: Move | null;
  onChange: (board: BoardState, kind: EditKind) => void;
  onSelect?: () => void;
  onBreak?: () => void;
  onCursorChange?: (index: number | null) => void;
  selection?: { index: number };
  uncertain?: ReadonlySet<number>;
  inputLabel?: string;
  hideHelp?: boolean;
  wordScores?: (index: number) => ReturnType<typeof boardWordsAt>;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [direction, setDirection] = useState<Direction>("across");
  const [pendingBlank, setPendingBlank] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const focusing = useRef(false);
  const breakHistory = useRef(onBreak);
  breakHistory.current = onBreak;
  const resetHistory = () => breakHistory.current?.();
  useEffect(() => {
    const reset = () => {
      breakHistory.current?.();
      setFocused(false);
      setPendingBlank(false);
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

  function focus() {
    setFocused(true);
    focusing.current = true;
    input.current?.focus({ preventScroll: true });
    focusing.current = false;
    input.current?.setSelectionRange(SENTINEL.length, SENTINEL.length);
  }
  function select(i: number, repeatTap?: boolean) {
    resetHistory();
    if (repeatTap ?? (focused && i === selected)) toggleDirection();
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
    if (next.some((letter, i) => letter !== board[i])) onChange(next, kind);
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
    <div className="board-entry">
      <Board
        template={template}
        board={board}
        archivedBoard={archivedBoard}
        preview={preview}
        selected={(focused || onCursorChange) && !preview ? selected : null}
        onSelect={select}
        entryDirection={direction}
        pendingBlank={pendingBlank}
        uncertain={uncertain}
        wordScores={wordScores}
        keepInputFocus
      />
      <input
        ref={input}
        className="board-keyboard-input"
        aria-label={inputLabel}
        aria-describedby={helpId}
        value={SENTINEL}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        onFocus={() => {
          setFocused(true);
          if (selected === null && !focusing.current)
            setSelected(template.start);
          onSelect?.();
        }}
        onBlur={() => {
          resetHistory();
          setFocused(false);
          setPendingBlank(false);
        }}
        onChange={(e) => {
          const text = e.currentTarget.value.replaceAll(SENTINEL, "");
          if (!e.currentTarget.value) erase(true);
          else enter(text);
          e.currentTarget.value = SENTINEL;
          e.currentTarget.setSelectionRange(1, 1);
        }}
        onPaste={(e) => {
          e.preventDefault();
          enter(e.clipboardData.getData("text"));
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey)
            return;
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
              if (e.shiftKey && !e.repeat) toggleDirection();
              break;
            case "Escape":
              setSelected(null);
              setPendingBlank(false);
              setAtEnd(false);
              input.current?.blur();
          }
        }}
      />
      <div className="direct-entry-tools">
        <div className="direct-entry-status" role="status">
          {!focused || selected === null
            ? "Tap a square and type"
            : `${coordinate(selected, n)} · ${pendingBlank ? "Type a blank’s letter" : atEnd ? "Board edge — choose another square" : "Type to enter"}`}
        </div>
        <div className="direct-entry-actions">
          <button
            className="text-button direction-button"
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
            disabled={selected === null}
            aria-pressed={pendingBlank || isBlank}
            onPointerDown={(e) => e.preventDefault()}
            onClick={toggleBlank}
          >
            Blank tile: {pendingBlank || isBlank ? "on" : "off"}
          </button>
          <button
            className="icon-button"
            aria-label="Erase selected tile"
            title="Erase selected tile"
            disabled={selected === null || (!tile && !pendingBlank)}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              erase();
              focus();
            }}
          >
            <Trash2 size={15} />
          </button>
        </div>
        <BoardEntryHelp id={helpId} hidden={hideHelp} />
      </div>
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
