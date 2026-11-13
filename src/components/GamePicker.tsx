import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, GripVertical } from "lucide-react";
import type { GameSummary } from "../../shared/game-index";

import { GameMetadata } from "./GameDetails";
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
      <LayoutThumbnail thumbnail={game.thumbnail} />
      <span className="game-picker-label">
        <strong>{game.name}</strong>
        <small>
          <GameMetadata game={game} />
        </small>
      </span>
      {selected && <Check size={16} aria-hidden="true" />}
    </>
  );
}

export default function GamePicker({
  game,
  games,
  onChoose,
  onReorder,
}: {
  game?: GameSummary;
  games: GameSummary[];
  onChoose: (id: string) => void;
  onReorder: (ids: string[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
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

  useEffect(() => {
    if (!open) {
      cancelDrag();
      return;
    }
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
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
    if (!open) return;
    const selected = list.current?.querySelector<HTMLButtonElement>(
      '[aria-checked="true"]',
    );
    (selected ?? list.current?.querySelector("button"))?.focus();
  }, [open]);

  function choose(id: string) {
    setOpen(false);
    onChoose(id);
    trigger.current?.focus();
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
    const options = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]',
      ),
    ];
    const current = options.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
        break;
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        options[
          (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
            options.length
        ]?.focus();
        break;
      case "Home":
      case "End":
        event.preventDefault();
        options.at(event.key === "Home" ? 0 : -1)?.focus();
        break;
    }
  }

  return (
    <div
      className="game-title-picker"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <h1 aria-label={game?.name}>
        {games.length ? (
          <button
            type="button"
            className="game-picker-trigger"
            aria-label="Switch game"
            aria-expanded={open}
            aria-haspopup="menu"
            aria-controls={open ? id : undefined}
            ref={trigger}
            onClick={() => setOpen(!open)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setOpen(true);
              }
            }}
          >
            <span className="game-picker-title">
              {game?.name ?? "Select a game"}
            </span>
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
          </button>
        ) : (
          (game?.name ?? "No active games")
        )}
      </h1>
      {open && games.length > 0 && (
        <div
          className="game-picker-menu"
          role="menu"
          aria-label="Active games"
          id={id}
          ref={list}
          onKeyDown={handleKeys}
        >
          {games.map((option, index) => (
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
                onClick={() => choose(option.id)}
              >
                <GamePickerLabel
                  game={option}
                  number={index + 1}
                  selected={option.id === game?.id}
                />
              </button>
              {games.length > 1 && (
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
