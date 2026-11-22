import { useId, useState } from "react";
import {
  endGameManually,
  gameScoreTotals,
  scoreTotalsAtPosition,
  tracksScores,
  unplayedRackPoints,
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
  onEnd: (game: Game, archive: boolean) => void;
  onClose: () => void;
}) {
  const { solo } = game;
  const current = tracksScores(game)
    ? (scoreTotalsAtPosition(game) ?? gameScoreTotals(game.scoring))
    : undefined;
  const [you, setYou] = useState(current ? String(current.you) : "");
  const [opponent, setOpponent] = useState(
    current ? String(current.opponent) : "",
  );
  const [outcome, setOutcome] = useState<GameOutcome | "">("");
  const [deductUnplayed, setDeductUnplayed] = useState(true);
  const [archive, setArchive] = useState(true);
  const deductionNoteId = useId();
  const scores =
    you !== "" &&
    Number.isSafeInteger(Number(you)) &&
    (solo || (opponent !== "" && Number.isSafeInteger(Number(opponent))))
      ? { you: Number(you), opponent: solo ? 0 : Number(opponent) }
      : undefined;
  const rackPoints = bagEmpty ? unplayedRackPoints(game) : undefined;
  const deductionNote =
    game.template.rules === "crossplay"
      ? "Crossplay doesn’t deduct unplayed tiles."
      : !bagEmpty
        ? "Available when the bag is empty."
        : !rackPoints
          ? "Check the board and rack tile counts."
          : !rackPoints.you && !rackPoints.opponent
            ? "No unplayed tile points to deduct."
            : undefined;
  const deductions = deductUnplayed && !deductionNote ? rackPoints : undefined;
  const finalScores =
    scores && deductions
      ? {
          you: scores.you - deductions.you,
          opponent: scores.opponent - deductions.opponent,
        }
      : scores;
  const canSubmit = finalScores
    ? Number.isSafeInteger(finalScores.you) &&
      Number.isSafeInteger(finalScores.opponent)
    : you === "" && (solo || opponent === "");

  return (
    <Modal title="End game" subtitle={game.name} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit)
            onEnd(
              endGameManually(game, {
                manual: true,
                scores: finalScores,
                outcome: !solo && scores && outcome ? outcome : undefined,
              }),
              archive,
            );
        }}
      >
        <label>
          {deductions ? "Your score before deductions" : "Your final score"}
          <input
            type="number"
            step="1"
            value={you}
            onChange={(event) => setYou(event.target.value)}
          />
        </label>
        {!solo && (
          <>
            <label>
              {deductions
                ? "Opponent’s score before deductions"
                : "Opponent’s final score"}
              <input
                type="number"
                step="1"
                value={opponent}
                onChange={(event) => setOpponent(event.target.value)}
              />
            </label>
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
          </>
        )}
        <label className="score-checkbox">
          <input
            type="checkbox"
            checked={!!deductions}
            disabled={!!deductionNote}
            aria-describedby={deductionNote ? deductionNoteId : undefined}
            onChange={(event) => setDeductUnplayed(event.target.checked)}
          />
          Deduct unplayed tiles
        </label>
        {deductionNote && (
          <p className="score-checkbox-note" id={deductionNoteId}>
            {deductionNote}
          </p>
        )}
        <label className="score-checkbox">
          <input
            type="checkbox"
            checked={archive}
            onChange={(event) => setArchive(event.target.checked)}
          />
          Archive game
        </label>
        {deductions && finalScores && (
          <p className="small" role="status">
            Final score{" "}
            {solo ? finalScores.you : `${finalScores.you}–${finalScores.opponent}`}
          </p>
        )}
        {!current && (
          <p className="small muted">
            {solo
              ? "Leave your score blank to finish without a score."
              : "Leave both scores blank to finish without a score."}
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
