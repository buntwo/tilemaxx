import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Pencil, Play, Plus } from "lucide-react";
import type { scoreHistoryMoves } from "../../shared/game-scoring";
import type { BoardTemplate } from "../../shared/model";
import type { MoveStrengthResult } from "../../shared/move-strength";
import type { PracticeRequest } from "../practice.worker";
import { DefinitionWord } from "./MoveDefinitions";
import { BingoBadge } from "./MoveWord";
import { usePractice } from "./usePractice";

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
  const total = <small className="score-move-total">({move.total})</small>;
  return (
    <div className="score-move-play">
      {move.player === "opponent" && <>{total}{" "}</>}
      <button
        type="button"
        className="score-review-link"
        aria-label={`${replayIndex === undefined ? "Review" : "Replay"} move ${move.number}: ${move.word}`}
        aria-current={move.number === replayIndex ? "step" : undefined}
        onClick={() => onSelect(move.number)}
      >
        <span className={move.bingo ? "bingo-move-word" : undefined}>
          <DefinitionWord word={move.word}>{move.notation}</DefinitionWord>
        </span>
      </button>
      {move.player === "you" && <>{" "}{total}</>}
    </div>
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
    turns: moves.flatMap(({ number, player, word, score, position, rackOut }) =>
      position && (position.rack || position.observerRack !== undefined)
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
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>
          <span>Tracked move history <small>({moves.length})</small></span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        {(!replaying || open) && (moves.length ? (
          <table aria-label="Tracked moves" aria-busy={calculating || undefined}>
            <thead>
              <tr>
                <th scope="col" aria-label="Move number">#</th>
                <th scope="col">You</th>
                <th scope="col">Pts</th>
                <th
                  scope="col"
                  className="score-move-strength"
                  aria-label="Move strength"
                  title="Points scored as a percentage of the highest possible score"
                >Strength</th>
                {!solo && <th scope="col">Opponent</th>}
              </tr>
            </thead>
            <tbody>
              {moves.map((move) => {
                const strength = strengths?.[move.number];
                return (
                  <tr key={move.number}>
                    <td className="score-move-number">
                      {onEdit ? (
                        <button
                          type="button"
                          className="score-edit-move"
                          aria-label={`Edit move ${move.number}: ${move.word}`}
                          onClick={() => onEdit(move.number)}
                        >
                          {move.number}
                          <Pencil size={11} aria-hidden="true" />
                        </button>
                      ) : <span className="score-move-index">{move.number}</span>}
                    </td>
                    <td>
                      {move.player === "you" && <MoveCell move={move} onSelect={onSelect} replayIndex={replayIndex} />}
                    </td>
                    <td className="score-move-points">
                      {move.score}
                      {move.bingo && <BingoBadge className="score-history-bingo" />}
                    </td>
                    <td className="score-move-strength">
                      {strength ? (
                        <span title={`${move.score} of ${strength.best} possible points`}>
                          {strength.percent}%
                        </span>
                      ) : "—"}
                    </td>
                    {!solo && (
                      <td>
                        {move.player === "opponent" && <MoveCell move={move} onSelect={onSelect} replayIndex={replayIndex} />}
                      </td>
                    )}
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
    </div>
  );
}
