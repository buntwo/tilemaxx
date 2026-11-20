import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { Trash2 } from "lucide-react";
import Board from "./Board";
import { parseBoardCoordinate } from "./BoardCoordinates";
import { useDefinitionTooltip } from "./DefinitionTooltip";
import {
  BoardEditHistory,
  inferBoardEntryDirection,
} from "../../shared/board-entry";
import { boardWordsAt, boardWordsThrough } from "../../shared/game-scoring";
import { definitionLanguageForRules, type DefinitionLanguage } from "../../shared/definitions";
import { moveLocation } from "../../shared/notation";
import { rackLetters } from "../../shared/rack-entry";
import {
  coordinate,
  type Board as BoardState,
  type BoardTemplate,
  type Game,
  type Move,
  type Player,
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
  skipPlayedTiles,
  phoneLayout,
  hideHelp,
  readOnly,
  displayBoard,
  preview,
  previewPlayer,
  onChange,
  onSelect,
  onSolve,
  moveFilter,
  historyControls,
  statusAction,
  overlay,
}: {
  ref?: Ref<BoardEntryHandle>;
  game: Game;
  skipPlayedTiles: boolean;
  phoneLayout?: boolean;
  hideHelp?: boolean;
  readOnly?: boolean;
  displayBoard?: BoardState;
  preview: Move | null;
  previewPlayer?: Player;
  onChange: (game: Game) => void;
  onSelect: () => void;
  onSolve?: () => void;
  moveFilter?: MoveFilterSelection;
  historyControls?: ReactNode;
  statusAction?: ReactNode;
  overlay?: ReactNode;
}) {
  const history = useRef(new BoardEditHistory());
  const board = displayBoard ?? game.board;
  const wordScores = useCallback(
    (index: number) => boardWordsAt(game, index),
    [game],
  );
  return (
    <BoardInput
      ref={displayBoard ? undefined : ref}
      board={board}
      directionForSquare={(index) =>
        inferBoardEntryDirection(
          board,
          index,
          game.template,
          rackLetters(game.rack).length,
        )
      }
      hideHelp={hideHelp}
      skipPlayedTiles={skipPlayedTiles}
      phoneLayout={phoneLayout}
      readOnly={readOnly}
      archivedBoard={game.archived ? game.archivedBoard : undefined}
      template={game.template}
      preview={preview}
      previewPlayer={previewPlayer}
      wordScores={displayBoard ? undefined : wordScores}
      definitionLanguage={displayBoard ? undefined : definitionLanguageForRules(game.template.rules)}
      onSelect={onSelect}
      onSolve={onSolve}
      moveFilter={moveFilter}
      historyControls={historyControls}
      statusAction={statusAction}
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
  previewPlayer,
  onChange,
  onSelect,
  onSolve,
  onBreak,
  onCursorChange,
  directionForSquare,
  selection,
  uncertain,
  inputLabel = "Type on board",
  hideHelp = false,
  readOnly = false,
  skipPlayedTiles = false,
  phoneLayout = false,
  showTileEditButtons = false,
  wordScores,
  definitionLanguage,
  moveFilter,
  historyControls,
  statusAction,
  overlay,
}: {
  ref?: Ref<BoardEntryHandle>;
  board: BoardState;
  archivedBoard?: BoardState;
  template: BoardTemplate;
  preview?: Move | null;
  previewPlayer?: Player;
  onChange: (board: BoardState, kind: EditKind) => void;
  onSelect?: () => void;
  onSolve?: () => void;
  onBreak?: () => void;
  onCursorChange?: (index: number | null) => void;
  directionForSquare?: (index: number) => Direction;
  selection?: { index: number };
  uncertain?: ReadonlySet<number>;
  inputLabel?: string;
  hideHelp?: boolean;
  readOnly?: boolean;
  skipPlayedTiles?: boolean;
  phoneLayout?: boolean;
  showTileEditButtons?: boolean;
  wordScores?: (index: number) => ReturnType<typeof boardWordsAt>;
  definitionLanguage?: DefinitionLanguage;
  moveFilter?: MoveFilterSelection;
  historyControls?: ReactNode;
  statusAction?: ReactNode;
  overlay?: ReactNode;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [direction, setDirection] = useState<Direction>("across");
  const [pendingBlank, setPendingBlank] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const [coordinateQuery, setCoordinateQuery] = useState<string | null>(null);
  const [defining, setDefining] = useState(false);
  const entry = useRef<HTMLDivElement>(null);
  const coordinatePrefix = useRef<string | null>(null);
  // Backspace reverses an automatic jump without erasing the intervening tiles.
  const skippedSteps = useRef(new Map<number, number>());
  const input = useRef<HTMLInputElement>(null);
  const focusing = useRef(false);
  const shiftHeld = useRef(false);
  const breakHistory = useRef(onBreak);
  breakHistory.current = onBreak;
  const resetHistory = () => {
    coordinatePrefix.current = null;
    skippedSteps.current.clear();
    breakHistory.current?.();
  };
  useEffect(() => {
    const reset = () => {
      breakHistory.current?.();
      coordinatePrefix.current = null;
      skippedSteps.current.clear();
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
  const cursor = focused && selected !== null
    ? moveLocation({ row: Math.floor(selected / n), col: selected % n, direction })
    : "";
  const toggleMark = readOnly ? undefined : moveFilter?.onToggle;
  const locating = coordinateQuery !== null && !readOnly && !toggleMark;
  const lookupLanguage = readOnly || toggleMark || locating ? undefined : definitionLanguage;
  const definitions = useDefinitionTooltip(lookupLanguage, board);
  const canDefine =
    !!lookupLanguage &&
    (phoneLayout
      ? board.some(Boolean)
      : selected !== null && boardWordsThrough(board, n, selected).length > 0);
  useLayoutEffect(() => setDefining(false), [board, phoneLayout, lookupLanguage]);
  useEffect(() => {
    if (!defining) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !entry.current?.contains(event.target))
        setDefining(false);
    }
    function escape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setDefining(false);
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [defining]);
  const target = locating ? parseBoardCoordinate(coordinateQuery, n) : null;
  const instruction = pendingBlank
    ? "Type a blank’s letter"
    : atEnd
      ? historyControls
        ? "Board edge"
        : "Board edge — choose another square"
      : historyControls
        ? "Space: blank · .: skip"
        : "Type to enter";
  const status = defining
    ? "Tap a tile in a word"
    : locating
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
    if (readOnly || toggleMark) {
      coordinatePrefix.current = null;
      setCoordinateQuery(null);
    }
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
    return true;
  }

  function updateCoordinate(query: string) {
    const match = parseBoardCoordinate(query, n);
    if (chooseCoordinate(match)) {
      // Select H1 immediately. The very next digit can still complete H10, H11, etc.
      coordinatePrefix.current = match?.ambiguous ? query : null;
    } else {
      setCoordinateQuery(query);
    }
  }

  function typeBoardInput(text: string) {
    const prefix = coordinatePrefix.current;
    coordinatePrefix.current = null;
    if (locating) {
      const typed = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
      updateCoordinate((coordinateQuery + typed).slice(0, 3));
    } else if (prefix && /^\d$/.test(text)) {
      updateCoordinate(prefix + text);
    } else {
      enter(text);
    }
  }

  function deleteCoordinateDigit() {
    const query = coordinatePrefix.current ?? coordinateQuery;
    if (query === null) return false;
    coordinatePrefix.current = null;
    updateCoordinate(query.slice(0, -1));
    return true;
  }

  function closeCoordinateOverlay() {
    setCoordinateQuery(null);
    input.current?.blur();
  }

  function coordinateKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      closeCoordinateOverlay();
    } else if (event.key === "Backspace" || event.key === "Delete") {
      deleteCoordinateDigit();
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
      setDirection(directionForSquare?.(i) ?? direction);
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
    coordinatePrefix.current = null;
    if (selected === null) return;
    if (pendingBlank) {
      setPendingBlank(false);
      return;
    }
    let i = selected;
    if (backspace && !tile) {
      const from = skippedSteps.current.get(i);
      skippedSteps.current.delete(i);
      i =
        from ??
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
    const dr = direction === "down" ? 1 : 0;
    const dc = direction === "across" ? 1 : 0;
    for (const char of text) {
      if (char === " ") {
        if (!end) blank = !blank;
        continue;
      }
      if (!/^[a-z.]$/i.test(char) || end) continue;
      if (char !== ".")
        nextBoard[i] = blank ? char.toLowerCase() : char.toUpperCase();
      blank = false;
      const adjacent = neighbor(i, dr, dc);
      let next = adjacent;
      if (skipPlayedTiles && char !== ".") {
        while (next !== null && nextBoard[next]) next = neighbor(next, dr, dc);
      }
      if (next === null) end = true;
      else {
        if (next !== adjacent) skippedSteps.current.set(next, i);
        i = next;
      }
    }
    save(nextBoard, "enter");
    setSelected(i);
    setPendingBlank(blank);
    setAtEnd(end);
  }
  function toggleBlank() {
    coordinatePrefix.current = null;
    if (selected === null) return;
    if (tile) togglePlacedBlank(selected);
    else setPendingBlank((v) => !v);
    focus();
  }
  function togglePlacedBlank(index: number) {
    const letter = board[index];
    if (!letter) return;
    const next = [...board];
    next[index] = letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase();
    save(next, "blank");
  }

  function openDefinition(anchor: HTMLButtonElement, index: number) {
    const words = boardWordsThrough(board, n, index);
    if (!words.length) return false;
    if (defining) {
      definitions.openSheet(anchor, words, `Words at ${coordinate(index, n)}`);
      setDefining(false);
    } else {
      definitions.open(anchor, words);
    }
    return true;
  }

  function define() {
    if (phoneLayout) {
      input.current?.blur();
      setDefining((current) => !current);
      return;
    }
    if (selected === null) return;
    const anchor = entry.current?.querySelector<HTMLButtonElement>(
      `button[data-cell="${selected}"]`,
    );
    if (anchor) openDefinition(anchor, selected);
  }

  return (
    <div
      ref={entry}
      className={`board-entry${toggleMark ? " selecting-move-squares" : ""}`}
    >
      <Board
        template={template}
        board={board}
        archivedBoard={archivedBoard}
        preview={preview}
        previewPlayer={previewPlayer}
        disabled={readOnly}
        selected={
          !readOnly && (focused || onCursorChange) && !preview && !toggleMark && !locating && !defining
            ? selected
            : null
        }
        markedSquares={moveFilter?.marks}
        selectingSquares={!!toggleMark}
        onSelect={toggleMark ?? select}
        onTileHold={readOnly || toggleMark || locating || defining ? undefined : (index) => {
          resetHistory();
          togglePlacedBlank(index);
        }}
        entryDirection={direction}
        pendingBlank={pendingBlank}
        uncertain={uncertain}
        wordScores={readOnly || toggleMark || locating ? undefined : wordScores}
        defining={defining}
        definedSquare={
          definitions.anchor ? Number(definitions.anchor.dataset.cell) : undefined
        }
        onDefine={lookupLanguage ? openDefinition : undefined}
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
        disabled={readOnly || !!toggleMark || defining}
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
          if (!e.currentTarget.value) {
            if (!deleteCoordinateDigit()) erase(true);
          } else typeBoardInput(text);
          e.currentTarget.value = SENTINEL;
          e.currentTarget.setSelectionRange(1, 1);
        }}
        onPaste={(e) => {
          e.preventDefault();
          typeBoardInput(e.clipboardData.getData("text"));
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
          if (
            (e.key === "Backspace" || e.key === "Delete") &&
            deleteCoordinateDigit()
          )
            return;
          const hadCoordinatePrefix = coordinatePrefix.current !== null;
          coordinatePrefix.current = null;
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
              else if (onSolve && !hadCoordinatePrefix) {
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
        {statusAction}
        <div className="direct-entry-status" role="status">
          {status}
        </div>
        <div className="direct-entry-actions">
          {showTileEditButtons && (
            <>
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
            </>
          )}
          {(definitionLanguage || historyControls) && (
            <button
              type="button"
              className="text-button board-define"
              disabled={!canDefine}
              onPointerDown={(event) => {
                if (!phoneLayout) event.preventDefault();
              }}
              onClick={define}
            >
              {defining ? "Cancel" : "Define"}
            </button>
          )}
          {historyControls}
        </div>
        {!historyControls && help}
      </div>
      {historyControls && help}
      {definitions.popup}
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
      Tap again to turn · Hold a tile to toggle blank · Space then letter = blank · . skips a square
    </p>
  );
}
