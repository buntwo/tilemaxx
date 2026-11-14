import { useMemo, useState } from "react";
import { scorePlacement } from "../../shared/game-scoring";
import { coordinate, type Game, type Move } from "../../shared/model";
import { reviewTurns, type ReviewSummary } from "../../shared/turn-review";
import Board from "./Board";
import Modal from "./Modal";
import ScoreBreakdown from "./ScoreBreakdown";
import { usePractice } from "./usePractice";

export default function TurnReview({
  game,
  index,
  onClose,
}: {
  game: Game;
  index: number | null;
  onClose: () => void;
}) {
  const turns = useMemo(() => reviewTurns(game), [game]);
  const [selected, setSelected] = useState(index);
  const [preview, setPreview] = useState<Move>();
  const { result, progress, error, run, reset } = usePractice<
    Move[] | ReviewSummary
  >();
  const turn = selected === null ? undefined : turns[selected];
  const position = turn?.position;
  const eligible = turns.flatMap(({ position, move, index }) =>
    position?.rack && move.player === "you" ? [{ position, move, index }] : [],
  );
  const alternatives = Array.isArray(result) ? result : undefined;
  const summary = result && !Array.isArray(result) ? result : undefined;
  const tiles = preview?.tiles ?? position?.tiles;
  const breakdown = useMemo(() => {
    if (!position || !tiles) return;
    const after = [...position.board];
    for (const { index, letter } of tiles) after[index] = letter;
    return scorePlacement(
      position.board,
      after,
      game.template,
      preview?.direction ?? position.direction,
    );
  }, [position, tiles, game.template, preview]);
  function choose(index: number | null) {
    reset();
    setPreview(undefined);
    setSelected(index);
  }
  return (
    <Modal
      title={
        turn
          ? `Review move ${turn.index + 1} · ${turn.move.word}`
          : "Review game"
      }
      subtitle="Review only. Your live board and rack stay in place."
      wide
      onClose={onClose}
    >
      <div className="practice-body">
        {turn ? (
          <>
            <button className="button secondary" onClick={() => choose(null)}>
              Back to game review
            </button>
            <p>
              {turn.move.player === "you" ? "You" : "Opponent"} ·{" "}
              {turn.move.score} recorded pts{turn.move.bingo ? " · Bingo" : ""}
            </p>
            {position ? (
              <>
                <div className="turn-review-board">
                  <Board
                    board={position.board}
                    template={game.template}
                    preview={{ tiles: tiles ?? [] }}
                    compact
                  />
                </div>
                {position.rack ? (
                  <p>
                    Rack before the move ·{" "}
                    <strong>{position.rack.replaceAll(".", "·")}</strong>
                  </p>
                ) : (
                  <p>
                    {turn.move.player === "opponent"
                      ? "Opponent rack is unknown."
                      : "Rack before the move is unknown."}
                  </p>
                )}
                {breakdown && <ScoreBreakdown breakdown={breakdown} />}
                {position.rack && !progress && !alternatives && (
                  <button
                    className="button primary"
                    onClick={() =>
                      run({
                        kind: "turn",
                        template: game.template,
                        turns: [{ ...turn, position }],
                      })
                    }
                  >
                    Find alternatives
                  </button>
                )}
                {alternatives && (
                  <div className="practice-body">
                    <button
                      className="button secondary"
                      onClick={() => setPreview(undefined)}
                    >
                      Show played move
                    </button>
                    {alternatives.length ? (
                      <ul className="practice-results">
                        {alternatives.map((move) => (
                          <li key={move.id}>
                            <button
                              className="button secondary"
                              aria-pressed={preview?.id === move.id}
                              onClick={() => setPreview(move)}
                            >
                              <strong>{move.word}</strong> · {move.score} pts ·{" "}
                              {coordinate(
                                move.row * game.template.size + move.col,
                                game.template.size,
                              )}{" "}
                              {move.direction}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No alternatives found in the selected word list.</p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p>This entry has no reliable saved board to replay.</p>
            )}
          </>
        ) : (
          <>
            <p>
              {eligible.length} of{" "}
              {turns.filter((turn) => turn.move.player === "you").length} of
              your tracked turns have a saved board and rack to analyze.
            </p>
            {!!eligible.length && !progress && !summary && (
              <button
                className="button primary"
                onClick={() =>
                  run({
                    kind: "game",
                    template: game.template,
                    turns: eligible,
                  })
                }
              >
                Find missed opportunities
              </button>
            )}
            {summary && (
              <>
                <p>
                  Checked {summary.checked} of {summary.total} eligible turns.
                  Point gaps compare immediate scores. Reply estimates use a
                  small sample of possible opponent racks.
                </p>
                {summary.opportunities.length ? (
                  <ul className="practice-results">
                    {summary.opportunities.map((item) => (
                      <li key={item.index}>
                        <button
                          className="button secondary"
                          onClick={() => choose(item.index)}
                        >
                          Move {item.index + 1} · {item.word}
                        </button>
                        {item.bingo && (
                          <p>
                            Missed bingo · <strong>{item.bingo.word}</strong>{" "}
                            for {item.bingo.score}
                          </p>
                        )}
                        {item.gap >= 8 && item.best && (
                          <p>
                            +{item.gap} immediate points ·{" "}
                            <strong>{item.best.word}</strong> for{" "}
                            {item.best.score} vs. {item.score}
                          </p>
                        )}
                        {item.replyRisk && (
                          <p>
                            40+ point reply available in{" "}
                            {Math.round(item.replyRisk.actual * 100)}% of
                            samples, versus{" "}
                            {Math.round(item.replyRisk.alternative * 100)}%
                            after <strong>{item.replyRisk.word}</strong> (
                            {item.replyRisk.trials} samples).
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    No missed bingos, gaps of 8+ points, or large reply-risk
                    differences found.
                  </p>
                )}
              </>
            )}
          </>
        )}
        {progress && (
          <>
            <p role="status">
              {progress.total
                ? `${progress.completed} / ${progress.total} turns checked`
                : "Preparing review…"}
            </p>
            <button className="button secondary" onClick={reset}>
              Cancel analysis
            </button>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
