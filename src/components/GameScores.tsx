import { ChevronDown, Trophy } from "lucide-react";
import { trackedMoveHistory, type Game } from "../../shared/model";
import {
  emptyScoring,
  isImportedPosition,
  pendingOpponentPlay,
  tracksScores,
} from "../../shared/game-scoring";

export default function GameScores({
  game,
  onToggle,
  onRecord,
  onCorrection,
}: {
  game: Game;
  onToggle: (enabled: boolean) => void;
  onRecord: () => void;
  onCorrection: () => void;
}) {
  const tracking = tracksScores(game);
  const play = pendingOpponentPlay(game);
  const scoring = game.scoring ?? emptyScoring();
  const totals = { you: 0, opponent: 0 };
  const moves = trackedMoveHistory(game)
    .map((move, index) => ({
      ...move,
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
                    {points} <small>pts</small>
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
          {scoring.pendingBase && (
            <div className="score-pending">
              <p>
                {play ? (
                  <>
                    Opponent move ·{" "}
                    <strong>
                      {play.word} · {play.score} pts
                    </strong>
                  </>
                ) : (
                  "Board edits pending. Enter one connected play or keep the edits as a correction."
                )}
              </p>
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
                    <td className="score-move-number">{move.number}</td>
                    <td>
                      {move.player === "you" && (
                        <div className="score-move-play">
                          <strong>{move.word}</strong>{" "}
                          <small className="score-move-total">
                            ({move.total})
                          </small>
                        </div>
                      )}
                    </td>
                    <td className="score-move-points">
                      {move.score}
                      {move.bingo && (
                        <span
                          className="bingo-badge score-history-bingo"
                          role="img"
                          aria-label="Bingo"
                          title="Bingo"
                        >
                          <Trophy size={12} aria-hidden="true" />
                        </span>
                      )}
                    </td>
                    <td>
                      {move.player === "opponent" && (
                        <div className="score-move-play">
                          <small className="score-move-total">
                            ({move.total})
                          </small>{" "}
                          <strong>{move.word}</strong>
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
      </details>
    </section>
  );
}
