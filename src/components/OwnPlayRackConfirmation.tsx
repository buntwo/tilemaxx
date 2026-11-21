import { useId, useState } from "react";
import {
  prepareOwnPlayRackCorrection,
  type OwnPlayRackCorrection,
} from "../../shared/own-play";
import type { Game, Move } from "../../shared/model";

export default function OwnPlayRackConfirmation({
  id,
  game,
  placement,
  onBack,
  onConfirm,
}: {
  id: string;
  game: Game;
  placement: Move;
  onBack: () => void;
  onConfirm: (correction: OwnPlayRackCorrection) => void;
}) {
  const inputId = useId();
  const helpId = useId();
  const errorId = useId();
  const [leave, setLeave] = useState(placement.leave);
  const correction = prepareOwnPlayRackCorrection(game, placement, leave);
  const error = "error" in correction ? correction.error : "";

  return (
    <form
      id={id}
      className="own-play-rack-confirmation"
      aria-labelledby={inputId + "-label"}
      onSubmit={(event) => {
        event.preventDefault();
        if ("before" in correction) onConfirm(correction);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onBack();
        }
      }}
    >
      <label htmlFor={inputId} id={inputId + "-label"}>Rack after play</label>
      <div className="own-play-rack-field">
        <input
          id={inputId}
          type="text"
          value={leave}
          onChange={(event) => setLeave(event.currentTarget.value.toUpperCase())}
          aria-describedby={error ? `${helpId} ${errorId}` : helpId}
          aria-invalid={!!error}
          placeholder="No tiles left"
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          enterKeyHint="done"
          spellCheck={false}
        />
        <button type="button" className="text-button" onClick={onBack}>Back</button>
        <button type="submit" className="button primary" disabled={!!error}>Confirm play</button>
      </div>
      <small id={helpId}>Tiles left before drawing. Use ? for a blank.</small>
      {error && <small id={errorId} className="own-play-rack-error" role="status">{error}</small>}
    </form>
  );
}
