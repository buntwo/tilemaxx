import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { History } from "lucide-react";
import { opponentNameMatches } from "../../shared/game-index";
import { localDate, MAX_GAME_NOTES, type Game } from "../../shared/model";
import { gamePlatforms } from "../premium-palettes";

export function FullMoveHistoryIcon() {
  return (
    <span
      className="full-move-history"
      role="img"
      aria-label="Full move history"
      title="Full move history"
    >
      <History size={14} aria-hidden="true" />
    </span>
  );
}

export function GameMetadata({
  game,
  endedOn,
}: {
  game: Pick<Game, "platform" | "startedOn">;
  endedOn?: string;
}) {
  const date = endedOn ?? game.startedOn;
  return (
    <>
      {game.platform && <>{game.platform} · </>}
      {date ? (
        <time dateTime={date}>
          {endedOn && "Ended "}
          {new Date(date + "T00:00:00").toLocaleDateString(
            undefined,
            {
              month: "short",
              day: "numeric",
              year: "numeric",
            },
          )}
        </time>
      ) : (
        "Date not set"
      )}
    </>
  );
}

const platforms: string[] = gamePlatforms.map(({ name }) => name);

function OpponentField({
  suggestions,
  initialFocus,
}: {
  suggestions: readonly string[];
  initialFocus?: boolean;
}) {
  const field = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const matches = suggestions.filter((option) => opponentNameMatches(option, name));
  const expanded = open && matches.length > 0;
  const active = expanded ? matches[highlight] : undefined;
  const activeId = active ? `${listId}-${highlight}` : undefined;

  useEffect(() => {
    if (activeId)
      document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  const dismiss = useCallback(() => {
    setOpen(false);
    setHighlight(-1);
  }, []);

  useEffect(() => {
    if (!expanded) return;
    // A tap can blur the input before the suggestion receives its click.
    const dismissOutside = (event: Event) => {
      if (!field.current?.contains(event.target as Node)) dismiss();
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
    };
  }, [dismiss, expanded]);

  function choose(option: string) {
    setName(option);
    dismiss();
  }

  return (
    <div ref={field} className="opponent-field">
      <label>
        Opponent
        <input
          name="opponent"
          autoFocus
          data-initial-focus={initialFocus || undefined}
          maxLength={80}
          value={name}
          placeholder="Opponent name"
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-activedescendant={activeId}
          onChange={(event) => {
            setName(event.currentTarget.value);
            setHighlight(-1);
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape" && expanded) {
              event.preventDefault();
              dismiss();
            } else if (event.key === "Enter" && active) {
              event.preventDefault();
              choose(active);
            } else if (
              matches.length &&
              (event.key === "ArrowDown" || event.key === "ArrowUp")
            ) {
              event.preventDefault();
              setOpen(true);
              setHighlight(
                event.key === "ArrowDown"
                  ? (highlight + 1) % matches.length
                  : (highlight > 0 ? highlight : matches.length) - 1,
              );
            }
          }}
        />
      </label>
      {expanded && (
        <div
          className="opponent-suggestions"
          id={listId}
          role="listbox"
          aria-label="Recent opponents"
        >
          {matches.map((option, index) => (
            <button
              key={option}
              id={`${listId}-${index}`}
              type="button"
              tabIndex={-1}
              role="option"
              aria-selected={index === highlight}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function GameDetailFields({
  game,
  opponentSuggestions,
  onPlatformChange,
  children,
  collapseDetails = false,
  initialFocus,
}: {
  game?: Game;
  opponentSuggestions?: readonly string[];
  onPlatformChange?: (platform: string) => void;
  children?: ReactNode;
  collapseDetails?: boolean;
  initialFocus?: boolean;
}) {
  const savedPlatform = game?.platform ?? "";
  const [platform, setPlatform] = useState(() =>
    savedPlatform && !platforms.includes(savedPlatform)
      ? "other"
      : savedPlatform,
  );
  const [customPlatform, setCustomPlatform] = useState(() =>
    platform === "other" ? savedPlatform : "",
  );
  const isOther = platform === "other";
  const details = (
    <>
      <label>
        Date
        <input
          type="date"
          name="startedOn"
          defaultValue={game ? game.startedOn : localDate()}
          required={!game}
        />
      </label>
      <label>
        Notes
        <textarea
          name="notes"
          defaultValue={game?.notes}
          maxLength={MAX_GAME_NOTES}
          rows={3}
        />
      </label>
    </>
  );
  return (
    <>
      {opponentSuggestions ? (
        <OpponentField suggestions={opponentSuggestions} initialFocus={initialFocus} />
      ) : (
        <label>
          Opponent
          <input
            name="opponent"
            autoFocus
            maxLength={80}
            defaultValue={game?.name}
            placeholder="Opponent name"
          />
        </label>
      )}
      <label>
        Platform
        <select
          name={isOther ? undefined : "platform"}
          value={platform}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setPlatform(value);
            onPlatformChange?.(value);
          }}
        >
          <option value="">No platform</option>
          {platforms.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          <option value="other">Other…</option>
        </select>
      </label>
      {isOther && (
        <label>
          Custom platform
          <input
            name="platform"
            maxLength={80}
            value={customPlatform}
            onChange={(event) => setCustomPlatform(event.currentTarget.value)}
          />
        </label>
      )}
      {children}
      {collapseDetails ? (
        <details
          className="new-game-details"
          onInvalidCapture={(event) => {
            event.currentTarget.open = true;
          }}
        >
          <summary>Game details</summary>
          <div>{details}</div>
        </details>
      ) : details}
    </>
  );
}

export function readGameDetails(
  form: HTMLFormElement,
): Pick<Game, "name" | "platform" | "startedOn" | "notes"> {
  const fields = new FormData(form);
  return {
    name: String(fields.get("opponent") ?? "").trim() || "Unknown opponent",
    platform: String(fields.get("platform") ?? "").trim() || undefined,
    startedOn: String(fields.get("startedOn") ?? "") || undefined,
    notes: String(fields.get("notes") ?? "").trim() || undefined,
  };
}
