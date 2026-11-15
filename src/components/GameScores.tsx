import { useState } from "react";
import { ChevronDown, Pencil, Plus } from "lucide-react";
import {
  isBingo,
  trackedMoveHistory,
  type Game,
  type Player,
} from "../../shared/model";
import {
  correctTrackedMove,
  displayedGameScoring,
  emptyScoring,
  gameScoreTotals,
  isImportedPosition,
  pendingOpponentPlay,
  tracksScores,
} from "../../shared/game-scoring";
import { scoreTone } from "../score-tone";
import Modal from "./Modal";
import MoveWord, { BingoBadge } from "./MoveWord";
import ScoreBreakdown from "./ScoreBreakdown";
import TurnReview from "./TurnReview";

export default function GameScores({
  game,
  onToggle,
  onRecord,
  onCorrection,
  onChange,
}: {
  game: Game;
  onToggle: (enabled: boolean) => void;
  onRecord: () => void;
  onCorrection: () => void;
  onChange: (game: Game) => void;
}) {
  const tracking = tracksScores(game);
  const play = pendingOpponentPlay(game);
  const scoring = displayedGameScoring(game) ?? emptyScoring();
  const adjusted = gameScoreTotals(scoring);
  const margin = adjusted.you - adjusted.opponent;
  const totals = { you: 0, opponent: 0 };
  const history = trackedMoveHistory(game);
  const historyKey = JSON.stringify(history);
  const [editor, setEditor] = useState<{
    insert: boolean;
    index: number;
    word: string;
    score: string;
    player: Player;
    bingo?: boolean;
    historyKey: string;
  }>();
  const [error, setError] = useState("");
  const [review, setReview] = useState<number | null>();
  function openEditor(index?: number) {
    const move = index === undefined ? undefined : history[index];
    setEditor({
      insert: index === undefined,
      index: index ?? history.length,
      word: move?.word ?? "",
      score: move ? String(move.score) : "",
      player: move?.player ?? "opponent",
      bingo: move ? move.bingo : false,
      historyKey,
    });
    setError("");
  }
  const moves = history
    .map((move, index) => ({
      ...move,
      bingo:
        move.bingo ??
        (move.review !== undefined &&
          isBingo(game.template, move.review.tiles.length)),
      number: index + 1,
      total: (totals[move.player] += move.score),
    }))
    .reverse();
  return (
    <section className="panel score-panel" aria-label="Game scores">
      <div className="score-header">
        <h2>Game scores</h2>
        <label>
          <input
            type="checkbox"
            checked={tracking}
            onChange={(event) => onToggle(event.target.checked)}
          />{" "}
          Track scores
        </label>
      </div>
      {tracking ? (
        <>
          <dl className="score-players">
            {(["you", "opponent"] as const).map((player) => {
              const { points, moves, best, bingos } = scoring[player];
              return (
                <div key={player}>
                  <dt>{player === "you" ? "You" : "Opponent"}</dt>
                  <dd className="score-total">
                    {adjusted[player]} <small>pts</small>
                  </dd>
                  <dd className="score-detail">
                    {moves} {moves === 1 ? "move" : "moves"} · Avg{" "}
                    {moves ? (points / moves).toFixed(1) : "—"}
                  </dd>
                  <dd className="score-detail">
                    Best {moves ? best : "—"} · {bingos}{" "}
                    {bingos === 1 ? "bingo" : "bingos"}
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className={`score-detail ${scoreTone(margin) ?? ""}`}>
            {margin > 0
              ? `${scoring.end ? "Win" : "Lead"} by ${margin}`
              : margin < 0
                ? `${scoring.end ? "Lose" : "Trail"} by ${-margin}`
                : scoring.end
                  ? "Tie"
                  : "Tied"}
          </p>
          {scoring.end && (
            <p className="score-detail">
              {scoring.end.out === "you"
                ? "You went out."
                : "Opponent went out."}{" "}
              {scoring.end.rackPoints > 0 && (
                <>
                  <span
                    className={scoreTone(scoring.end.out === "you" ? 1 : -1)}
                  >
                    {scoring.end.rackPoints} rack points
                  </span>{" "}
                  transferred to{" "}
                  {scoring.end.out === "you" ? "you" : "the opponent"}.
                </>
              )}
            </p>
          )}
          {scoring.pendingBase && (
            <div className="score-pending">
              <p>
                {play ? (
                  <>
                    Opponent move ·{" "}
                    <strong>
                      <MoveWord word={play.word} bingo={play.bingo} /> ·{" "}
                      {play.score} pts
                    </strong>
                  </>
                ) : (
                  "Board edits pending. Enter one connected play or keep the edits as a correction."
                )}
              </p>
              {play && <ScoreBreakdown breakdown={play} />}
              <div>
                {play && (
                  <button className="button secondary" onClick={onRecord}>
                    Record opponent move
                  </button>
                )}
                <button className="button secondary" onClick={onCorrection}>
                  Keep as correction
                </button>
              </div>
            </div>
          )}
        </>
      ) : isImportedPosition(game) ? (
        <p className="score-detail">
          Screenshot imported. Turn tracking on to count moves from this
          position.
        </p>
      ) : null}
      <details className="score-history">
        <summary>
          <span>
            Tracked move history <small>({moves.length})</small>
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        {moves.length ? (
          <div className="score-history-scroll">
            <table aria-label="Tracked moves">
              <thead>
                <tr>
                  <th scope="col" aria-label="Move number">
                    #
                  </th>
                  <th scope="col">You</th>
                  <th scope="col">Pts</th>
                  <th scope="col">Opponent</th>
                </tr>
              </thead>
              <tbody>
                {moves.map((move) => (
                  <tr key={move.number}>
                    <td className="score-move-number">
                      <button
                        type="button"
                        className="score-edit-move"
                        aria-label={`Edit move ${move.number}: ${move.word}`}
                        onClick={() => openEditor(move.number - 1)}
                      >
                        {move.number}
                        <Pencil size={11} aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      {move.player === "you" && (
                        <div className="score-move-play">
                          <button
                            type="button"
                            className="score-review-link"
                            aria-label={`Review move ${move.number}: ${move.word}`}
                            onClick={() => setReview(move.number - 1)}
                          >
                            <span
                              className={
                                move.bingo ? "bingo-move-word" : undefined
                              }
                            >
                              {move.word}
                            </span>
                          </button>{" "}
                          <small className="score-move-total">
                            ({move.total})
                          </small>
                        </div>
                      )}
                    </td>
                    <td className="score-move-points">
                      {move.score}
                      {move.bingo && (
                        <BingoBadge className="score-history-bingo" />
                      )}
                    </td>
                    <td>
                      {move.player === "opponent" && (
                        <div className="score-move-play">
                          <small className="score-move-total">
                            ({move.total})
                          </small>{" "}
                          <button
                            type="button"
                            className="score-review-link"
                            aria-label={`Review move ${move.number}: ${move.word}`}
                            onClick={() => setReview(move.number - 1)}
                          >
                            <span
                              className={
                                move.bingo ? "bingo-move-word" : undefined
                              }
                            >
                              {move.word}
                            </span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No tracked moves yet.</p>
        )}
        <button
          type="button"
          className="button secondary score-add-move"
          onClick={() => openEditor()}
        >
          <Plus size={14} aria-hidden="true" /> Add missed move
        </button>
        {!!moves.length && (
          <button
            type="button"
            className="button secondary score-add-move"
            onClick={() => setReview(null)}
          >
            Review game
          </button>
        )}
      </details>
      {review !== undefined && (
        <TurnReview
          game={game}
          index={review}
          onClose={() => setReview(undefined)}
        />
      )}
      {editor && (
        <Modal
          title={
            editor.insert ? "Add missed move" : `Edit move ${editor.index + 1}`
          }
          subtitle="Updates score history only."
          onClose={() => setEditor(undefined)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (editor.historyKey !== historyKey) {
                setError(
                  "The move history changed. Close this dialog and open it again.",
                );
                return;
              }
              try {
                onChange(
                  correctTrackedMove(
                    game,
                    editor.index,
                    {
                      word: editor.word.trim().toUpperCase(),
                      score: Number(editor.score),
                      player: editor.player,
                      bingo: editor.bingo,
                    },
                    editor.insert,
                  ),
                );
                setEditor(undefined);
              } catch (error) {
                setError((error as Error).message);
              }
            }}
          >
            {editor.insert && history.length > 0 && (
              <label>
                Insert move
                <select
                  value={editor.index}
                  onChange={(event) =>
                    setEditor({ ...editor, index: Number(event.target.value) })
                  }
                >
                  <option value={history.length}>After the latest move</option>
                  {moves.map((move) => (
                    <option key={move.number} value={move.number - 1}>
                      Before #{move.number} {move.word}
                      {move.bingo ? " · 🏆 Bingo" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Player
              <select
                value={editor.player}
                onChange={(event) =>
                  setEditor({
                    ...editor,
                    player: event.target.value === "you" ? "you" : "opponent",
                  })
                }
              >
                <option value="you">You</option>
                <option value="opponent">Opponent</option>
              </select>
            </label>
            <label>
              Word
              <input
                required
                maxLength={25}
                autoCapitalize="characters"
                spellCheck={false}
                value={editor.word}
                onChange={(event) =>
                  setEditor({ ...editor, word: event.target.value })
                }
              />
            </label>
            <label>
              Points
              <input
                required
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={editor.score}
                onChange={(event) =>
                  setEditor({ ...editor, score: event.target.value })
                }
              />
            </label>
            <label className="score-edit-bingo">
              <input
                type="checkbox"
                checked={editor.bingo === true}
                onChange={(event) =>
                  setEditor({ ...editor, bingo: event.target.checked })
                }
              />{" "}
              Bingo
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <footer className="modal-footer">
              <button
                type="button"
                className="button secondary"
                onClick={() => setEditor(undefined)}
              >
                Cancel
              </button>
              <button className="button primary">
                {editor.insert ? "Add move" : "Save correction"}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </section>
  );
}
