import { useId } from "react";
import { History } from "lucide-react";
import {
  localDate,
  MAX_GAME_NOTES,
  RULE_NAMES,
  type Game,
} from "../../shared/model";

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
}: {
  game: Pick<Game, "platform" | "startedOn">;
}) {
  return (
    <>
      {game.platform && <>{game.platform} · </>}
      {game.startedOn ? (
        <time dateTime={game.startedOn}>
          {new Date(game.startedOn + "T00:00:00").toLocaleDateString(
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

export function GameDetailFields({ game }: { game?: Game }) {
  const platforms = useId();
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
        <input
          name="platform"
          list={platforms}
          maxLength={80}
          defaultValue={game?.platform}
          placeholder="Choose or type a platform"
        />
        <datalist id={platforms}>
          <option value="Scrabble GO" />
          <option value="Words With Friends" />
          <option value={RULE_NAMES.wordfeud} />
          <option value={RULE_NAMES.crossplay} />
          <option value={RULE_NAMES.lexulous} />
          <option value="In person" />
        </datalist>
      </label>
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
