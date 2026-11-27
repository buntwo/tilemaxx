import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { BookOpenText, Trash2, X } from "lucide-react";
import Board from "./Board";
import BoardHistoryControls from "./BoardHistoryControls";
import MoveWord from "./MoveWord";
import OwnPlayRackConfirmation from "./OwnPlayRackConfirmation";
import { parseBoardCoordinate } from "./BoardCoordinates";
import { useDefinitionTooltip } from "./DefinitionTooltip";
import {
  BoardEditHistory,
  inferBoardEntryDirection,
} from "../../shared/board-entry";
import { boardWordsAt, boardWordsThrough } from "../../shared/game-scoring";
import { definitionLanguageForRules, type DefinitionLanguage } from "../../shared/definitions";
import { moveLocation } from "../../shared/notation";
import { missingRackLabel, prepareOwnPlay, type OwnPlayRackCorrection } from "../../shared/own-play";
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
  changeDraftHistory: (action: "undo" | "redo") => void;
};

type BoardInputHandle = Pick<BoardEntryHandle, "toggleCoordinateOverlay"> & {
  focusStartSquare: () => void;
};

type Draft = { board: BoardState; direction: Direction };
export type DraftHistory = { current: Draft; past: Draft[]; future: Draft[] };
type OwnPlayInput = {
  base: BoardState;
  board: BoardState;
  tiles: ReadonlySet<number>;
  missing: ReadonlyMap<number, string>;
  confirm: () => void;
  cancel: () => void;
};

export default function BoardEntry({
  ref,
  game,
  skipPlayedTiles,
  phoneLayout,
  hideHelp,
  readOnly,
  displayBoard,
  trialBase,
  preview,
  previewPlayer,
  definePreview,
  onChange,
  onSelect,
  onSolve,
  ownPlay,
  storedDraft,
  moveFilter,
  historyControls,
  turnActions,
  turnHint,
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
  trialBase?: BoardState;
  preview: Pick<Move, "tiles"> | null;
  previewPlayer?: Player;
  definePreview?: boolean;
  onChange: (game: Game) => void;
  onSelect: () => void;
  onSolve?: () => void;
  ownPlay?: {
    onPlay: (move: Move) => void;
    onRecordAnyway: (correction: OwnPlayRackCorrection) => void;
    onCancel: () => void;
    onFixRack: () => void;
  };
  storedDraft?: { current: DraftHistory | undefined };
  moveFilter?: MoveFilterSelection;
  historyControls?: ReactNode;
  turnActions?: ReactNode;
  turnHint?: string;
  statusAction?: ReactNode;
  overlay?: ReactNode;
}) {
  const history = useRef(new BoardEditHistory());
  const input = useRef<BoardInputHandle>(null);
  const recordAnyway = useRef<HTMLButtonElement>(null);
  const rackConfirmationId = useId();
  const [confirmingRack, setConfirmingRack] = useState(false);
  const [draftHistory, setDraftHistory] = useState<DraftHistory>(() => storedDraft?.current ?? ({
    current: { board: game.board, direction: "across" },
    past: [],
    future: [],
  }));
  const board = displayBoard ?? game.board;
  const trialTiles = useMemo(
    () => trialBase && new Set(board.flatMap((tile, index) => tile && !trialBase[index] ? [index] : [])),
    [board, trialBase],
  );
  const draft = ownPlay
    ? prepareOwnPlay(game, draftHistory.current.board, draftHistory.current.direction)
    : undefined;
  const placement = draft?.placement;
  const missing = !!draft?.missing.size;
  const move = missing ? undefined : placement;
  const checkingRack = missing && confirmingRack && !!placement;
  const displayMove = checkingRack ? placement : move;
  const enteringOwnPlay = !!ownPlay;

  useLayoutEffect(() => {
    if (storedDraft && enteringOwnPlay) storedDraft.current = draftHistory;
  }, [draftHistory, enteringOwnPlay, storedDraft]);
  useEffect(() => setConfirmingRack(false), [draftHistory.current, game.rack]);

  useLayoutEffect(() => {
    if (enteringOwnPlay) input.current?.focusStartSquare();
  }, [enteringOwnPlay]);
  useImperativeHandle(ref, () => ({
    toggleCoordinateOverlay: () => input.current?.toggleCoordinateOverlay() ?? false,
    changeDraftHistory,
  }));

  const wordScores = useCallback(
    (index: number) => boardWordsAt(game, index),
    [game],
  );

  function changeDraftHistory(action: "undo" | "redo") {
    setDraftHistory(({ current, past, future }) => {
      const next = (action === "undo" ? past : future).at(-1);
      if (!next) return { current, past, future };
      return action === "undo"
        ? { current: next, past: past.slice(0, -1), future: [...future, current] }
        : { current: next, past: [...past, current], future: future.slice(0, -1) };
    });
  }

  function confirm() {
    if (move) ownPlay?.onPlay(move);
  }

  function closeRackConfirmation() {
    setConfirmingRack(false);
    recordAnyway.current?.focus({ preventScroll: true });
  }

  return (
    <>
      <BoardInput
        ref={displayBoard ? undefined : input}
        board={draft ? draftHistory.current.board : board}
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
        trialTiles={trialTiles}
        template={game.template}
        preview={ownPlay ? null : preview}
        previewPlayer={previewPlayer}
        definePreview={definePreview}
        wordScores={displayBoard ? undefined : wordScores}
        definitionLanguage={displayBoard ? undefined : definitionLanguageForRules(game.template.rules)}
        onSelect={onSelect}
        onSolve={onSolve}
        moveFilter={moveFilter}
        historyControls={ownPlay ? (
          <BoardHistoryControls
            canUndo={draftHistory.past.length > 0}
            canRedo={draftHistory.future.length > 0}
            onUndo={() => changeDraftHistory("undo")}
            onRedo={() => changeDraftHistory("redo")}
          />
        ) : historyControls}
        turnActions={turnActions}
        turnHint={turnHint}
        statusAction={ownPlay ? undefined : statusAction}
        overlay={overlay}
        onBreak={() => history.current.reset()}
        ownPlay={draft && ownPlay ? {
          base: game.board,
          board: draft.board,
          tiles: new Set(draft.tiles.map(({ index }) => index)),
          missing: draft.missing,
          confirm,
          cancel: ownPlay.onCancel,
        } : undefined}
        onChange={(board, kind, direction) => {
          if (displayBoard) return;
          if (ownPlay) {
            setDraftHistory(({ current, past }) => ({
              current: { board, direction },
              past: [...past, current].slice(-100),
              future: [],
            }));
          } else {
            const next = history.current.apply(game, board, kind);
            if (next !== game) onChange(next);
          }
        }}
      />
      {draft && ownPlay && (
        <div className="own-play-actions" role="group" aria-label="Enter your play">
          <span aria-live="polite">
            {displayMove
              ? <><strong><MoveWord move={displayMove} rules={game.template} /></strong> · {displayMove.score} pts</>
              : draft.tiles.length && !placement
                ? "Place one connected word"
                : "Your play"}
          </span>
          <div className="own-play-buttons">
            {missing && (
              <button type="button" className="text-button" onClick={() => {
                setConfirmingRack(false);
                ownPlay.onFixRack();
              }}>Fix rack</button>
            )}
            {missing && placement && (
              <button
                ref={recordAnyway}
                type="button"
                className="text-button"
                aria-expanded={checkingRack}
                aria-controls={checkingRack ? rackConfirmationId : undefined}
                onClick={() => setConfirmingRack(!checkingRack)}
              >
                Record anyway
              </button>
            )}
            <button type="button" className="text-button" onClick={ownPlay.onCancel}>Cancel</button>
            <button className="button primary" type="button" disabled={!move} onClick={confirm}>Play</button>
          </div>
        </div>
      )}
      {ownPlay && checkingRack && (
        <OwnPlayRackConfirmation
          id={rackConfirmationId}
          game={game}
          placement={placement}
          onBack={closeRackConfirmation}
          onConfirm={ownPlay.onRecordAnyway}
        />
      )}
    </>
  );
}

export function BoardInput({
  ref,
  board,
  archivedBoard,
  trialTiles,
  template,
  preview,
  previewPlayer,
  definePreview,
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
  ownPlay,
  moveFilter,
  historyControls,
  turnActions,
  turnHint,
  statusAction,
  overlay,
}: {
  ref?: Ref<BoardInputHandle>;
  board: BoardState;
  archivedBoard?: BoardState;
  trialTiles?: ReadonlySet<number>;
  template: BoardTemplate;
  preview?: Pick<Move, "tiles"> | null;
  previewPlayer?: Player;
  definePreview?: boolean;
  onChange: (board: BoardState, kind: EditKind, direction: Direction) => void;
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
  ownPlay?: OwnPlayInput;
  moveFilter?: MoveFilterSelection;
  historyControls?: ReactNode;
  turnActions?: ReactNode;
  turnHint?: string;
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
  const definitionBoard = useMemo(() => {
    if (!definePreview || !preview) return board;
    const shown = board.slice();
    for (const { index, letter } of preview.tiles) shown[index] = letter;
    return shown;
  }, [board, preview, definePreview]);
  const definitions = useDefinitionTooltip(lookupLanguage, definitionBoard);
  const canDefine = !!lookupLanguage && definitionBoard.some(Boolean);
  useLayoutEffect(() => setDefining(false), [definitionBoard, phoneLayout, lookupLanguage]);
  useLayoutEffect(() => {
    if (locating && !defining && document.activeElement !== input.current) focus();
  }, [locating, defining]);
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
  const directionHint = direction === "across" ? "Down" : "Across";
  const repeatHint = `${phoneLayout ? "Tap" : "Click"} again: ${directionHint}`;
  const instruction = pendingBlank
    ? "Type a blank’s letter"
    : atEnd
      ? historyControls
        ? "Board edge"
        : "Board edge — choose another square"
      : historyControls
        ? ownPlay
          ? `${skipPlayedTiles ? "" : "Period: skip · "}${repeatHint}`
          : `Space: blank${skipPlayedTiles ? "" : " · Period: skip"} · ${repeatHint}`
        : "Type to enter";
  const missing = ownPlay && !defining && !locating && missingRackLabel(ownPlay.missing);
  const status = defining
    ? `${phoneLayout ? "Tap" : "Click"} a tile in a word`
    : locating
      ? coordinateStatus()
      : readOnly
        ? "Board locked"
        : missing
          ? <>{cursor && `${cursor} · `}<span className="board-rack-warning">Missing {missing}</span></>
          : cursor
            ? `${cursor} · ${instruction}`
            : ownPlay
              ? `${phoneLayout ? "Tap" : "Click"} a square to enter your play`
              : "Tap a square and type";
  const help = <BoardEntryHelp id={helpId} hidden={hideHelp} />;

  useImperativeHandle(ref, () => ({
    focusStartSquare() {
      entry.current?.querySelector<HTMLButtonElement>(`[data-cell="${template.start}"]`)
        ?.focus({ preventScroll: true });
    },
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
      if (!defining) focus();
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
      onChange(next, kind, direction);
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
    if (!ownPlay?.base[i]) {
      next[i] = "";
      save(next, "erase");
    }
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
      const existing = ownPlay?.base[i];
      if (char !== ".") {
        if (existing && existing.toUpperCase() !== char.toUpperCase()) continue;
        if (!existing)
          nextBoard[i] = blank ? char.toLowerCase() : char.toUpperCase();
      }
      blank = false;
      const adjacent = neighbor(i, dr, dc);
      let next = adjacent;
      if (skipPlayedTiles) {
        const played = ownPlay?.base ?? nextBoard;
        while (next !== null && played[next]) next = neighbor(next, dr, dc);
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
    if (!letter || ownPlay?.base[index]) return;
    const shown = ownPlay?.board[index] ?? letter;
    const next = [...board];
    next[index] = shown === shown.toLowerCase() ? shown.toUpperCase() : shown.toLowerCase();
    save(next, "blank");
  }

  function openDefinition(anchor: HTMLButtonElement, index: number) {
    const words = boardWordsThrough(definitionBoard, n, index);
    if (!words.length) return false;
    if (defining && phoneLayout) {
      definitions.openSheet(anchor, words, `Words at ${coordinate(index, n)}`);
    } else {
      definitions.open(anchor, words);
    }
    setDefining(false);
    return true;
  }

  function toggleDefine() {
    input.current?.blur();
    setDefining((current) => !current);
  }

  return (
    <div
      ref={entry}
      className={`board-entry${toggleMark ? " selecting-move-squares" : ""}`}
    >
      <Board
        template={template}
        board={ownPlay?.board ?? (defining ? definitionBoard : board)}
        archivedBoard={archivedBoard}
        trialTiles={trialTiles}
        draftTiles={ownPlay?.tiles}
        missingRackTiles={ownPlay?.missing}
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
        enterKeyHint={ownPlay ? "done" : onSolve ? "search" : undefined}
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
              else if (!hadCoordinatePrefix) {
                if (ownPlay) ownPlay.confirm();
                else if (onSolve) {
                  e.currentTarget.blur();
                  onSolve();
                }
              }
              break;
            case "Escape":
              if (ownPlay) {
                ownPlay.cancel();
                break;
              }
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
        <div className="direct-entry-status" role="status" data-missing-rack={!!missing || undefined}>
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
          {turnActions}
          {(definitionLanguage || historyControls) && (
            <BoardDefineButton disabled={!canDefine} defining={defining} onClick={toggleDefine} />
          )}
          {historyControls}
        </div>
        {turnHint && <div className="board-turn-hint">{turnHint}</div>}
        {!historyControls && help}
      </div>
      {historyControls && help}
      {definitions.popup}
    </div>
  );
}

export function BoardDefineButton({ disabled, defining = false, onClick }: {
  disabled: boolean;
  defining?: boolean;
  onClick?: () => void;
}) {
  const label = defining ? "Cancel" : "Define";
  return (
    <button type="button" className="text-button board-define" aria-label={label} title={label}
      disabled={disabled} onClick={onClick}>
      {defining
        ? <X className="board-define-cancel-icon" size={15} aria-hidden="true" />
        : <BookOpenText size={15} aria-hidden="true" />}
      <span className="board-control-label">{label}</span>
    </button>
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
