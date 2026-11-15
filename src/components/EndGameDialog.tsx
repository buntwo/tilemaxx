import { useState } from "react";
import {
  endGameManually,
  gameScoreTotals,
  scoresAfterRackDeductions,
  scoreTotalsAtPosition,
  tracksScores,
} from "../../shared/game-scoring";
import type { Game, GameOutcome } from "../../shared/model";
import Modal from "./Modal";

export default function EndGameDialog({
  game,
  bagEmpty,
  onEnd,
  onClose,
}: {
  game: Game;
  bagEmpty: boolean;
  onEnd: (game: Game) => void;
  onClose: () => void;
}) {
  const current = tracksScores(game)
    ? (scoreTotalsAtPosition(game) ?? gameScoreTotals(game.scoring))
    : undefined;
  const [you, setYou] = useState(current ? String(current.you) : "");
  const [opponent, setOpponent] = useState(
    current ? String(current.opponent) : "",
  );
  const [outcome, setOutcome] = useState<GameOutcome | "">("");
  const [deductionsApplied, setDeductionsApplied] = useState(false);
  const scores =
    you !== "" &&
    opponent !== "" &&
    Number.isSafeInteger(Number(you)) &&
    Number.isSafeInteger(Number(opponent))
      ? { you: Number(you), opponent: Number(opponent) }
      : undefined;
  const canSubmit = scores || (you === "" && opponent === "");
  const deducted =
    scores && bagEmpty && scoresAfterRackDeductions(game, scores);

  return (
    <Modal title="End game" subtitle={game.name} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit)
            onEnd(
              endGameManually(game, {
                manual: true,
                scores,
                outcome: scores && outcome ? outcome : undefined,
              }),
            );
        }}
      >
        <label>
          Your final score
          <input
            type="number"
            step="1"
            value={you}
            onChange={(event) => setYou(event.target.value)}
          />
        </label>
        <label>
          Opponent’s final score
          <input
            type="number"
            step="1"
            value={opponent}
            onChange={(event) => setOpponent(event.target.value)}
          />
        </label>
        {scores &&
          deducted &&
          (deducted.you !== scores.you ||
            deducted.opponent !== scores.opponent) && (
            <button
              className="text-button"
              type="button"
              disabled={deductionsApplied}
              onClick={() => {
                setYou(String(deducted.you));
                setOpponent(String(deducted.opponent));
                setDeductionsApplied(true);
              }}
            >
              {deductionsApplied
                ? "Unplayed tiles deducted"
                : "Deduct unplayed tiles"}
            </button>
          )}
        <label>
          Result
          <select
            value={scores ? outcome : ""}
            disabled={!scores}
            onChange={(event) =>
              setOutcome(event.target.value as GameOutcome | "")
            }
          >
            <option value="">From final scores</option>
            <option value="win">You win</option>
            <option value="loss">Opponent wins</option>
            <option value="tie">Tie</option>
          </select>
        </label>
        {!current && (
          <p className="small muted">
            Leave both scores blank to finish without a score.
          </p>
        )}
        <footer className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={!canSubmit}>
            End game
          </button>
        </footer>
      </form>
    </Modal>
  );
}
