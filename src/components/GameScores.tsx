import { recordedMoveNotation } from "../../shared/notation";
import { Fragment, useMemo, useState } from "react";
import { ChevronDown, Pencil, Play, Plus, Trophy } from "lucide-react";
import { isBingo, type Game, type Player } from "../../shared/model";
import {
  correctTrackedMove,
  currentScoreStart,
  displayedGameScoring,
  emptyScoring,
  gameScoreTotals,
  isImportedPosition,
  nextPlayerToMove,
  pendingOpponentTurns,
  reviewTurns,
  tracksScores,
  summarizeGameScore,
} from "../../shared/game-scoring";
import { scoreTone, signedPoints } from "../score-tone";
import Modal from "./Modal";
import MoveWord, { BingoBadge } from "./MoveWord";
import { DefinitionWord } from "./MoveDefinitions";
import ScoreBreakdown from "./ScoreBreakdown";
import ScoreChart from "./ScoreChart";
import TurnReview from "./TurnReview";

export function ScorePlayerMarker({
  player,
  turn,
  winner,
}: {
  player: Player;
  turn?: Player;
  winner?: Player;
}) {
  const won = winner === player;
  if (!won && turn !== player) return null;
  const label = won
    ? player === "you"
      ? "You won"
      : "Opponent won"
    : player === "you"
      ? "Your turn"
      : "Opponent’s turn";
  return (
    <span
      className={won ? "score-player-marker" : "score-player-marker score-turn-chevron"}
      data-status={won ? "winner" : "turn"}
      role="img"
      aria-label={label}
    >
      {won && (
        <span className="bingo-badge score-winner">
          <Trophy size={10} aria-hidden="true" />
        </span>
      )}
    </span>
  );
}

export default function GameScores({
  game,
  onToggle,
  onRecord,
  onCorrection,
  onEditLastOpponentMove,
  onReplay,
  onChange,
}: {
  game: Game;
  onToggle: (enabled: boolean) => void;
  onRecord: () => void;
  onCorrection: () => void;
  onEditLastOpponentMove?: () => void;
  onReplay?: (returnFocus: HTMLButtonElement) => void;
  onChange: (game: Game) => void;
}) {
  const { solo } = game;
  const players = solo ? (["you"] as const) : (["you", "opponent"] as const);
  const tracking = tracksScores(game);
  const pending = pendingOpponentTurns(game);
  const multiplePending = pending.length > 1;
  const scoring = displayedGameScoring(game) ?? emptyScoring();
  const end = scoring.end;
  const rackOut = end && "out" in end ? end : undefined;
  const manual = end && "manual" in end ? end : undefined;
  const turn = nextPlayerToMove(game);
  const outcome = manual?.outcome ?? summarizeGameScore(game, scoring)?.outcome;
  const winner =
    outcome === "win" ? "you" : outcome === "loss" ? "opponent" : undefined;
  const adjusted = gameScoreTotals(scoring);
  const margin = adjusted.you - adjusted.opponent;
  const tone = scoreTone(margin);
  const totals = { you: 0, opponent: 0 };
  const turns = useMemo(() => reviewTurns(game), [game]);
  const history = turns.map((turn) => turn.move);
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
      player: move?.player ?? (solo ? "you" : "opponent"),
      bingo: move ? move.bingo : false,
      historyKey,
    });
    setError("");
  }
  const moves = turns.map(({ move, position }, index) => ({
    ...move,
    notation: recordedMoveNotation(move, position, game.template.size),
    bingo:
      move.bingo ??
      (position !== undefined && isBingo(game.template, position.tiles.length)),
    number: index + 1,
    total: (totals[move.player] += move.score),
  }));
  const newestMoves = [...moves].reverse();
  const chartMoves = moves.slice(currentScoreStart(game, history));
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
      {tracking || manual?.scores ? (
        <>
          <dl className="score-players" data-solo={solo}>
            {players.map((player) => {
              const { points, moves, best, bingos } = scoring[player];
              return (
                <div key={player} data-player={player}>
                  <dt>{player === "you" ? "You" : "Opponent"}</dt>
                  <dd className="score-total">
                    {adjusted[player]} <small>pts</small>
                    <ScorePlayerMarker
                      player={player}
                      turn={turn}
                      winner={winner}
                    />
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
          {scoring.incomplete && !manual?.scores ? (
            <p className="score-detail">
              Partial scores. Some plays are missing from the saved history.
            </p>
          ) : manual && !manual.scores ? (
            <p className="score-detail">
              Game ended. Showing points from saved moves.
            </p>
          ) : solo ? (
            end && <p className="score-detail">Game complete.</p>
          ) : (
            <p className={`score-margin ${tone ?? ""}`}>
              {signedPoints(margin)} pts
            </p>
          )}
          {rackOut && (
            <p className="score-detail">
              {rackOut.out === "you" ? "You went out." : "Opponent went out."}{" "}
              {rackOut.rackPoints > 0 && (
                <>
                  <span className={scoreTone(rackOut.out === "you" ? 1 : -1)}>
                    {rackOut.rackPoints} rack points
                  </span>{" "}
                  transferred to{" "}
                  {rackOut.out === "you" ? "you" : "the opponent"}.
                </>
              )}
            </p>
          )}
          {scoring.pendingBase && (
            <div className="score-pending">
              {pending.length ? (
                pending.map(({ base, play }, index) => (
                  <Fragment key={base.filter(Boolean).length}>
                    <p>
                      Opponent move{multiplePending ? ` ${index + 1}` : ""} ·{" "}
                      <strong>
                        <MoveWord word={play.word} bingo={play.bingo} /> ·{" "}
                        {play.score} pts
                      </strong>
                    </p>
                    <ScoreBreakdown breakdown={play} />
                  </Fragment>
                ))
              ) : solo ? (
                <p>
                  Keep these edits as a board correction, or undo them and use
                  Enter your play to record a scored move.
                </p>
              ) : (
                <p>
                  Board edits pending. For multiple opponent plays, undo to the
                  first and record it before entering the next. You can also fix
                  the entry or keep it as a correction.
                </p>
              )}
              <div>
                {!!pending.length && (
                  <button className="button secondary" onClick={onRecord}>
                    Record opponent {multiplePending ? "moves" : "move"}
                  </button>
                )}
                <button className="button secondary" onClick={onCorrection}>
                  Keep as correction
                </button>
              </div>
            </div>
          )}
        </>
      ) : manual ? (
        <p className="score-detail">Game ended.</p>
      ) : isImportedPosition(game) ? (
        <p className="score-detail">
          Screenshot imported. Turn tracking on to recover scores from saved
          moves and count future plays.
        </p>
      ) : null}
      {!!moves.length && (
        <div className="score-actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => setReview(null)}
          >
            Review game
          </button>
          {onEditLastOpponentMove && (
            <button
              type="button"
              className="button secondary"
              onClick={onEditLastOpponentMove}
            >
              Edit last opponent move
            </button>
          )}
        </div>
      )}
      {!!chartMoves.length && <ScoreChart moves={chartMoves} solo={solo} />}
      <div className="score-history-section">
        {onReplay && (
          <button
            type="button"
            className="text-button score-history-replay"
            onClick={(event) => onReplay(event.currentTarget)}
          >
            <Play size={14} aria-hidden="true" /> Replay game
          </button>
        )}
        <details className="score-history">
          <summary>
            <span>
              Tracked move history <small>({moves.length})</small>
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </summary>
        {moves.length ? (
          <table aria-label="Tracked moves">
            <thead>
              <tr>
                <th scope="col" aria-label="Move number">
                  #
                </th>
                <th scope="col">You</th>
                <th scope="col">Pts</th>
                {!solo && <th scope="col">Opponent</th>}
              </tr>
            </thead>
            <tbody>
              {newestMoves.map((move) => (
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
                            <DefinitionWord word={move.word}>{move.notation}</DefinitionWord>
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
                  {!solo && (
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
                              <DefinitionWord word={move.word}>{move.notation}</DefinitionWord>
                            </span>
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>No tracked moves yet.</p>
        )}
        <button
          type="button"
          className="button secondary score-action"
          onClick={() => openEditor()}
        >
          <Plus size={14} aria-hidden="true" /> Add missed move
        </button>
        </details>
      </div>
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
                  {newestMoves.map((move) => (
                    <option key={move.number} value={move.number - 1}>
                      Before #{move.number} {move.word}
                      {move.bingo ? " · 🏆 Bingo" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!solo && (
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
            )}
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
