import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Check, ChevronDown, GripVertical } from "lucide-react";
import type { Game } from "../../shared/model";

import { GameMetadata } from "./GameDetails";
import LayoutThumbnail from "./LayoutThumbnail";

export default function GamePicker({
  game,
  games,
  onChoose,
  onReorder,
}: {
  game?: Game;
  games: Game[];
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
    startY: number;
    moved: boolean;
    frame: number;
  } | null>(null);
  const [drop, setDrop] = useState<{ from: number; to: number }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function cancelDrag() {
    if (!drag.current) return;
    cancelAnimationFrame(drag.current.frame);
    drag.current = null;
    setDrop(undefined);
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
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const active = {
      pointer: event.pointerId,
      from,
      to: from,
      y: event.clientY,
      startY: event.clientY,
      moved: false,
      frame: 0,
    };
    drag.current = active;
    setDrop({ from, to: from });
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
    if (!active.moved && Math.abs(active.y - active.startY) < 5) return;
    active.moved = true;
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
            <span>{game?.name ?? "Select a game"}</span>
            <ChevronDown size={18} aria-hidden="true" />
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
                <LayoutThumbnail
                  board={option.board}
                  template={option.template}
                />
                <span className="game-picker-label">
                  <strong>{option.name}</strong>
                  <small>
                    <GameMetadata game={option} />
                  </small>
                </span>
                {option.id === game?.id && (
                  <Check size={16} aria-hidden="true" />
                )}
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
    </div>
  );
}
