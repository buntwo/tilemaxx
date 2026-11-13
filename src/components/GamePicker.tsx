import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { Game } from "../../shared/model";

import { GameMetadata } from "./GameDetails";
import LayoutThumbnail from "./LayoutThumbnail";

export default function GamePicker({
  game,
  games,
  onChoose,
}: {
  game?: Game;
  games: Game[];
  onChoose: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

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
  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    const options = [...event.currentTarget.querySelectorAll("button")];
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
          {games.map((option) => (
            <button
              type="button"
              key={option.id}
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
              {option.id === game?.id && <Check size={16} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
