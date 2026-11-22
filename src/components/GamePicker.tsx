import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, GripVertical } from "lucide-react";
import { opponentNameMatches, type GameSummary } from "../../shared/game-index";

import { IncompleteMoveHistoryIcon, GameMetadata } from "./GameDetails";
import { describeGameScore } from "./GameScoreBadge";
import LayoutThumbnail from "./LayoutThumbnail";

function GamePickerLabel({
  game,
  number,
  selected,
}: {
  game: GameSummary;
  number: number;
  selected: boolean;
}) {
  return (
    <>
      <span className="game-picker-number" aria-hidden="true">
        {number}
      </span>
      <LayoutThumbnail thumbnail={game.thumbnail} platform={game.platform} />
      <span className="game-picker-label">
        <span className="game-picker-name-line">
          <strong className="game-picker-name">
            <span className="game-picker-opponent" title={game.name}>{game.name}</span>
            {!game.fullMoveHistory && <IncompleteMoveHistoryIcon />}
          </strong>
          {game.score && (
            <span className="game-picker-score" aria-hidden="true">
              {game.score.solo ? game.score.you : `${game.score.you}–${game.score.opponent}`}
            </span>
          )}
        </span>
        <small>
          <GameMetadata game={game} />
        </small>
      </span>
      {selected && <Check size={16} aria-hidden="true" />}
    </>
  );
}

export type GamePickerHandle = { focusSearch: () => boolean };

export default function GamePicker({
  ref,
  game,
  headingMetadata,
  games,
  onChoose,
  onReorder,
}: {
  ref?: Ref<GamePickerHandle>;
  game?: GameSummary;
  headingMetadata: string;
  games: GameSummary[];
  onChoose: (id: string) => void;
  onReorder: (ids: string[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filterLabel = games.some((game) => game.solo) ? "Filter by name" : "Filter by opponent";
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeadingOnClose = useRef(false);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<"search" | "option">(undefined);
  const id = useId();
  const visibleGames = games
    .map((option, index) => ({ option, index }))
    .filter(({ option }) => opponentNameMatches(option.name, query));
  const drag = useRef<{
    pointer: number;
    from: number;
    to: number;
    y: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    width: number;
    moved: boolean;
    frame: number;
  } | null>(null);
  const [drop, setDrop] = useState<{ from: number; to: number }>();
  const [dragPreview, setDragPreview] = useState<{
    index: number;
    left: number;
    top: number;
    width: number;
  }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function cancelDrag() {
    if (!drag.current) return;
    cancelAnimationFrame(drag.current.frame);
    drag.current = null;
    setDrop(undefined);
    setDragPreview(undefined);
  }

  function closePicker() {
    setOpen(false);
    setQuery("");
  }

  function updateQuery(value: string) {
    cancelDrag();
    if (list.current) list.current.scrollTop = 0;
    setQuery(value);
  }

  useEffect(() => {
    if (!open) {
      cancelDrag();
      return;
    }
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) closePicker();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  useEffect(
    () => () => {
      if (drag.current) cancelAnimationFrame(drag.current.frame);
    },
    [],
  );

  const gameIds = JSON.stringify(games.map((game) => game.id));
  useEffect(cancelDrag, [gameIds]);

  useEffect(() => {
    if (!open) {
      if (focusHeadingOnClose.current) {
        focusHeadingOnClose.current = false;
        heading.current?.focus({ preventScroll: true });
      }
      return;
    }
    const requested = focusOnOpen.current;
    focusOnOpen.current = undefined;
    if (requested === "option") {
      const selected = list.current?.querySelector<HTMLButtonElement>(
        '[aria-checked="true"]',
      );
      (selected ?? list.current?.querySelector("button"))?.focus();
    } else if (requested === "search" || !window.matchMedia?.("(pointer: coarse)").matches) {
      search.current?.focus();
    }
  }, [open]);

  useImperativeHandle(ref, () => ({
    focusSearch() {
      if (!games.length) return false;
      if (open) search.current?.focus();
      else {
        focusOnOpen.current = "search";
        setOpen(true);
      }
      return true;
    },
  }));

  function choose(id: string) {
    focusHeadingOnClose.current = true;
    closePicker();
    onChoose(id);
  }
  async function reorder(from: number, to: number) {
    if (saving || from === to || to < 0 || to >= games.length) return;
    const ids = games.map((game) => game.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    setSaving(true);
    setError("");
    try {
      await onReorder(ids);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function updateTarget(active: NonNullable<typeof drag.current>) {
    const rows = list.current?.querySelectorAll<HTMLElement>(
      ".game-picker-option",
    );
    if (!rows?.length) return;
    let target = rows.length - 1;
    for (let i = 0; i < rows.length; i++) {
      if (active.y < rows[i].getBoundingClientRect().bottom) {
        target = i;
        break;
      }
    }
    if (target === active.to) return;
    active.to = target;
    setDrop({ from: active.from, to: target });
  }
  function startDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    from: number,
  ) {
    if (saving || drag.current || event.button !== 0) return;
    const row = event.currentTarget
      .closest(".game-picker-option")
      ?.getBoundingClientRect();
    if (!row) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const active = {
      pointer: event.pointerId,
      from,
      to: from,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - row.left,
      offsetY: event.clientY - row.top,
      width: row.width,
      moved: false,
      frame: 0,
    };
    drag.current = active;
    const scroll = () => {
      if (drag.current !== active || !list.current) return;
      const { top, bottom } = list.current.getBoundingClientRect();
      const delta = active.y < top + 24 ? -8 : active.y > bottom - 24 ? 8 : 0;
      if (active.moved && delta) {
        list.current.scrollTop += delta;
        updateTarget(active);
      }
      active.frame = requestAnimationFrame(scroll);
    };
    active.frame = requestAnimationFrame(scroll);
  }
  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    active.y = event.clientY;
    if (!active.moved) {
      if (
        Math.hypot(event.clientX - active.startX, active.y - active.startY) < 5
      )
        return;
      active.moved = true;
      setDrop({ from: active.from, to: active.to });
    }
    setDragPreview({
      index: active.from,
      left: event.clientX - active.offsetX,
      top: active.y - active.offsetY,
      width: active.width,
    });
    updateTarget(active);
  }
  function finishDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    moveDrag(event);
    cancelDrag();
    void reorder(active.from, active.to);
  }
  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (
      !open ||
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    const inSearch = event.target === search.current;
    const options = [
      ...(list.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]',
      ) ?? []),
    ];
    const current = options.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        closePicker();
        trigger.current?.focus();
        break;
      case "Enter":
        if (inSearch) {
          event.preventDefault();
          if (visibleGames[0]) choose(visibleGames[0].option.id);
        }
        break;
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        if (current === -1) {
          options.at(event.key === "ArrowDown" ? 0 : -1)?.focus();
        } else {
          const next = current + (event.key === "ArrowDown" ? 1 : -1);
          (options[next] ?? search.current)?.focus();
        }
        break;
      case "Home":
      case "End":
        if (inSearch) break;
        event.preventDefault();
        options.at(event.key === "Home" ? 0 : -1)?.focus();
        break;
      default:
        if (!inSearch && event.key.length === 1 && event.key !== " " && event.key !== "?") {
          event.preventDefault();
          search.current?.focus();
          updateQuery(query + event.key);
        }
    }
  }

  return (
    <div
      className="game-title-picker"
      ref={root}
      onKeyDown={handleKeys}
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          closePicker();
      }}
    >
      <h1 ref={heading} tabIndex={-1} aria-label={game?.name}>
        {games.length ? (
          <button
            type="button"
            className="game-picker-trigger"
            aria-label="Switch game"
            aria-keyshortcuts="Alt+F"
            aria-description={
              [
                headingMetadata,
                game && !game.fullMoveHistory && "Incomplete move history",
              ].filter(Boolean).join(". ") || undefined
            }
            aria-expanded={open}
            aria-haspopup="menu"
            aria-controls={open ? id : undefined}
            ref={trigger}
            onClick={() => (open ? closePicker() : setOpen(true))}
            onKeyDown={(event) => {
              if (
                !open &&
                (event.key === "ArrowDown" || event.key === "ArrowUp")
              ) {
                event.preventDefault();
                focusOnOpen.current = "option";
                setOpen(true);
              }
            }}
          >
            <span className="game-picker-trigger-line">
              <span className="game-picker-title">
                {game?.name ?? "Select a game"}
              </span>
              {game && !game.fullMoveHistory && <IncompleteMoveHistoryIcon />}
              <ChevronRight
                className="game-picker-chevron"
                size={18}
                aria-hidden="true"
              />
              {open && (
                <span
                  className="game-picker-count"
                  aria-hidden="true"
                  title={`${games.length} active ${games.length === 1 ? "game" : "games"}`}
                >
                  {games.length}
                </span>
              )}
            </span>
          </button>
        ) : (
          (game?.name ?? "No active games")
        )}
      </h1>
      {open && games.length > 0 && (
        <div className="game-picker-menu">
          <input
            className="game-picker-search"
            ref={search}
            type="search"
            aria-label={filterLabel}
            aria-controls={id}
            placeholder={filterLabel}
            value={query}
            onChange={(event) => updateQuery(event.currentTarget.value)}
          />
          <div
            className="game-picker-results"
            role="menu"
            aria-label="Active games"
            id={id}
            ref={list}
          >
            {visibleGames.map(({ option, index }) => (
              <div
                role="none"
                key={option.id}
                className="game-picker-option"
                data-selected={option.id === game?.id || undefined}
                data-dragging={drop?.from === index || undefined}
                data-drop={
                  drop?.to === index && drop.from !== index
                    ? drop.from < index
                      ? "after"
                      : "before"
                    : undefined
                }
              >
                <button
                  type="button"
                  role="menuitemradio"
                  tabIndex={-1}
                  aria-checked={option.id === game?.id}
                  aria-description={option.score ? describeGameScore(option.score) : undefined}
                  onClick={() => choose(option.id)}
                >
                  <GamePickerLabel
                    game={option}
                    number={index + 1}
                    selected={option.id === game?.id}
                  />
                </button>
                {!query.trim() && games.length > 1 && (
                  <button
                    type="button"
                    role="menuitem"
                    className="game-picker-grip"
                    aria-label={`Reorder ${option.name}`}
                    title="Drag to reorder or use the arrow keys"
                    aria-disabled={saving || undefined}
                    onPointerDown={(event) => startDrag(event, index)}
                    onPointerMove={moveDrag}
                    onPointerUp={finishDrag}
                    onPointerCancel={cancelDrag}
                    onLostPointerCapture={cancelDrag}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowDown" && event.key !== "ArrowUp")
                        return;
                      event.preventDefault();
                      event.stopPropagation();
                      void reorder(
                        index,
                        index + (event.key === "ArrowDown" ? 1 : -1),
                      );
                    }}
                  >
                    <GripVertical size={18} aria-hidden="true" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {visibleGames.length === 0 && (
            <p className="game-picker-empty" role="status">
              No matching games.
            </p>
          )}
          {error && (
            <p role="alert" className="error game-picker-error">
              {error}
            </p>
          )}
        </div>
      )}
      {open &&
        dragPreview &&
        games[dragPreview.index] &&
        createPortal(
          <div
            className="game-picker-drag-preview"
            aria-hidden="true"
            style={{
              left: dragPreview.left,
              top: dragPreview.top,
              width: dragPreview.width,
            }}
          >
            <div className="game-picker-drag-label">
              <GamePickerLabel
                game={games[dragPreview.index]}
                number={dragPreview.index + 1}
                selected={games[dragPreview.index].id === game?.id}
              />
            </div>
            <span className="game-picker-drag-grip">
              <GripVertical size={18} />
            </span>
          </div>,
          document.body,
        )}
    </div>
  );
}
