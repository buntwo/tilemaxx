import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown, Play, Plus } from "lucide-react";
import type { scoreHistoryMoves } from "../../shared/game-scoring";
import type { BoardTemplate } from "../../shared/model";
import { trackedTurnLabel } from "../../shared/notation";
import type { MoveStrength, MoveStrengthResult } from "../../shared/move-strength";
import type { PracticeRequest } from "../practice.worker";
import { DefinitionWord } from "./MoveDefinitions";
import { BingoBadge } from "./MoveWord";
import { ScoreBreakdownContent } from "./ScoreBreakdown";
import { usePractice } from "./usePractice";
import { useScoreTooltip } from "./useScoreTooltip";

type HistoryMove = ReturnType<typeof scoreHistoryMoves>[number];

function MoveCell({
  move,
  onSelect,
  replayIndex,
}: {
  move: HistoryMove;
  onSelect: (number: number) => void;
  replayIndex?: number;
}) {
  return (
    <div className="score-move-play">
      <button
        type="button"
        className="score-review-link"
        aria-label={`${replayIndex === undefined ? "Review" : "Replay"} move ${move.number}: ${trackedTurnLabel(move)}`}
        aria-current={move.number === replayIndex ? "step" : undefined}
        onClick={() => onSelect(move.number)}
      >
        {move.action ? <span className="score-history-action">{trackedTurnLabel(move, "compact")}</span> :
        <DefinitionWord word={move.word} className="score-history-word">
          {move.notation}
        </DefinitionWord>}
      </button>
      {move.bingo && <BingoBadge className="score-history-bingo" />}
    </div>
  );
}

function StrengthMeter({ score, strength }: { score: number; strength: MoveStrength }) {
  const tooltipId = useId();
  const percent = Math.round(100 * score / strength.best);
  const band = percent <= 60 ? "green" : percent <= 80 ? "yellow" : "red";
  return (
    <>
      <button
        type="button"
        className="score-strength-trigger"
        aria-label={`Move strength ${percent}%`}
        aria-describedby={tooltipId}
        onClick={(event) => event.currentTarget.focus()}
      >
        <span className="score-strength-track" data-band={band} aria-hidden="true">
          <span className="score-strength-fill" style={{ height: `${percent}%` }} />
        </span>
      </button>
      <span className="score-strength-tooltip" role="tooltip" id={tooltipId}>
        {`${percent}% · ${score}/${strength.best} pts`}
      </span>
    </>
  );
}

export default function TrackedMoveHistory({
  moves,
  template,
  dictionaryId,
  solo,
  replayIndex,
  onSelect,
  onEdit,
  onAdd,
  onStartReplay,
}: {
  moves: readonly HistoryMove[];
  template: BoardTemplate;
  dictionaryId: string;
  solo?: true;
  replayIndex?: number;
  onSelect: (number: number) => void;
  onEdit?: (number: number) => void;
  onAdd?: () => void;
  onStartReplay?: (returnFocus: HTMLButtonElement) => void;
}) {
  const [open, setOpen] = useState(false);
  const replaying = replayIndex !== undefined;
  const request = useMemo<Extract<PracticeRequest, { kind: "move-strength" }>>(() => ({
    kind: "move-strength",
    dictionaryId,
    template,
    turns: moves.flatMap(({ number, player, word, score, position, rackOut, action }) =>
      !action && position && (position.rack || position.observerRack !== undefined)
        ? [{ number, player, word, score, position, rackOut }]
        : [],
    ),
  }), [dictionaryId, moves, template]);
  const [activeRequest, setActiveRequest] = useState<typeof request>();
  const { result, progress, run, reset } = usePractice<MoveStrengthResult>();
  useEffect(() => {
    if (!open || !request.turns.length) return;
    setActiveRequest(request);
    run(request);
    return reset;
  }, [open, request, run, reset]);
  const strengths = activeRequest === request ? result : undefined;
  const calculating = activeRequest === request && !!progress;
  const scoreTooltip = useScoreTooltip<number>((number) => {
    const move = moves.find((entry) => entry.number === number);
    if (!move) return null;
    return (
      <>
        <strong>Score breakdown</strong>
        {move.breakdown ? <ScoreBreakdownContent breakdown={move.breakdown} /> : (
          <div className="score-breakdown-content">
            <p>{move.action ? trackedTurnLabel(move) : "Placement details unavailable"}</p>
            <div className="score-breakdown-line score-breakdown-total">
              <strong>{move.action ? "Total" : "Recorded total"}</strong>
              <strong>{move.score} pts</strong>
            </div>
          </div>
        )}
      </>
    );
  });
  return (
    <div className="score-history-section">
      {onStartReplay && (
        <button
          type="button"
          className="text-button score-history-replay"
          onClick={(event) => onStartReplay(event.currentTarget)}
        >
          <Play size={14} aria-hidden="true" /> Replay game
        </button>
      )}
      <details
        className="score-history"
        onToggle={(event) => {
          setOpen(event.currentTarget.open);
          if (!event.currentTarget.open) scoreTooltip.close();
        }}
      >
        <summary>
          <span>Tracked move history <small>({moves.length})</small></span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        {(!replaying || open) && (moves.length ? (
          <table aria-label="Tracked moves" aria-busy={calculating || undefined}>
            <thead>
              <tr>
                <th scope="col" className="score-move-number" aria-label="Move number">#</th>
                {!solo && <th scope="col" className="score-move-player" aria-label="Player">
                  <span className="score-history-full-heading">Player</span>
                  <span className="score-history-short-heading" aria-hidden="true">Who</span>
                </th>}
                <th scope="col">Play</th>
                <th scope="col" className="score-move-points" aria-label="Points">Pts</th>
                <th scope="col" className="score-move-crosses" aria-label="Crosses" title="Crosswords formed">
                  <span className="score-history-full-heading">Crosses</span>
                  <span className="score-history-short-heading" aria-hidden="true">Cr.</span>
                </th>
                <th scope="col" className="score-move-total" aria-label="Running total">Total</th>
                <th
                  scope="col"
                  className="score-move-strength"
                  aria-label="Move strength"
                  title="Points scored as a percentage of the highest possible score"
                >
                  <span className="score-history-full-heading">Strength</span>
                  <span className="score-history-short-heading" aria-hidden="true">Str.</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {moves.map((move) => {
                const strength = strengths?.[move.number];
                const mainPoints = move.breakdown?.words[0].score;
                const crosses = move.breakdown ? move.breakdown.words.length - 1 : move.action ? 0 : undefined;
                return (
                  <tr key={move.number} data-player={move.player}>
                    <td className="score-move-number">
                      {onEdit && !move.action ? (
                        <button
                          type="button"
                          className="score-edit-move"
                          aria-label={`Edit move ${move.number}: ${move.word}`}
                          title={`Edit move ${move.number}`}
                          onClick={() => onEdit(move.number)}
                        >
                          {move.number}
                        </button>
                      ) : <span className="score-move-index">{move.number}</span>}
                    </td>
                    {!solo && (
                      <td className="score-move-player">
                        {move.player === "you" ? "You" : <span aria-label="Opponent">Opp</span>}
                      </td>
                    )}
                    <td><MoveCell move={move} onSelect={onSelect} replayIndex={replayIndex} /></td>
                    <td className="score-move-points">
                      <button
                        className="score-history-points"
                        {...scoreTooltip.triggerProps(
                          move.number,
                          move.number,
                          `Score breakdown for move ${move.number}: ${move.score} points${mainPoints === undefined ? "" : `, ${mainPoints} from the main word`}`,
                        )}
                      >
                        {move.score}{mainPoints !== undefined && <> <small>({mainPoints})</small></>}
                      </button>
                    </td>
                    <td className="score-move-crosses">
                      {crosses ?? <span aria-label="Crosses unavailable">—</span>}
                    </td>
                    <td className="score-move-total">{move.total}</td>
                    <td className="score-move-strength">
                      {strength ? (
                        <StrengthMeter score={move.score} strength={strength} />
                      ) : <span aria-label="Move strength unavailable">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p>No tracked moves yet.</p>)}
        {onAdd && (
          <button type="button" className="button secondary score-action" onClick={onAdd}>
            <Plus size={14} aria-hidden="true" /> Add missed move
          </button>
        )}
      </details>
      {scoreTooltip.popup}
    </div>
  );
}
