import { useState } from "react";
import { History } from "lucide-react";
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

export function GameDetailFields({
  game,
  onPlatformChange,
}: {
  game?: Game;
  onPlatformChange?: (platform: string) => void;
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
  return (
    <>
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
