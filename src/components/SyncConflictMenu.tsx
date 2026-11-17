import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight, Info } from "lucide-react";
import type { Game } from "../../shared/model";
import { GameMetadata } from "./GameDetails";

type ConflictGame = Pick<
  Game,
  "id" | "name" | "profileId" | "platform" | "startedOn" | "archived"
> & { profileName?: string };

export default function SyncConflictMenu({
  games,
  onOpen,
}: {
  games: ConflictGame[];
  onOpen: (game: ConflictGame) => void;
}) {
  const [mode, setMode] = useState<"closed" | "hover" | "open">("closed");
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const expanded = mode !== "closed";

  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setMode("closed");
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [expanded]);

  return (
    <div
      ref={container}
      className="sync-conflicts"
      onPointerLeave={(event) => {
        if (
          event.pointerType === "mouse" &&
          !list.current?.contains(document.activeElement)
        ) {
          setMode((current) => (current === "hover" ? "closed" : current));
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setMode("closed");
      }}
      onKeyDown={(event) => {
        if (expanded && event.key === "Escape") {
          event.preventDefault();
          setMode("closed");
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="sync-status offline sync-conflict-trigger"
        aria-expanded={expanded}
        aria-controls={id}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") {
            setMode((current) => (current === "closed" ? "hover" : current));
          }
        }}
        onClick={() =>
          setMode((current) => (current === "open" ? "closed" : "open"))
        }
      >
        <Info size={14} aria-hidden="true" />
        Review changes
      </button>
      <div className="sync-conflict-popover" hidden={!expanded}>
        <ul ref={list} id={id} aria-label="Games with sync conflicts">
          {games.map((game) => (
            <li key={game.id}>
              <button
                type="button"
                className="sync-conflict-game"
                onClick={() => {
                  setMode("closed");
                  onOpen(game);
                }}
              >
                <strong>{game.name}</strong>
                <ArrowUpRight size={13} aria-hidden="true" />
                {(game.profileName ||
                  game.archived ||
                  game.platform ||
                  game.startedOn) && (
                  <small>
                    {game.profileName}
                    {game.profileName &&
                      (game.archived || game.platform || game.startedOn) &&
                      " · "}
                    {game.archived && "Archived"}
                    {game.archived &&
                      (game.platform || game.startedOn) &&
                      " · "}
                    {(game.platform || game.startedOn) && (
                      <GameMetadata game={game} />
                    )}
                  </small>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
