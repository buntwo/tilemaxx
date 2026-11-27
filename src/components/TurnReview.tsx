import { moveLocation, trackedTurnLabel } from "../../shared/notation";
import { useEffect, useMemo, useRef, useState } from "react";
import { scorePlacement } from "../../shared/game-scoring";
import {
  isBingo,
  type BingoRules,
  type Game,
  type Move,
  type Player,
} from "../../shared/model";
import { reviewTurns, type ReviewSummary } from "../../shared/turn-review";
import { scoreTone } from "../score-tone";
import Board from "./Board";
import Modal from "./Modal";
import MoveWord from "./MoveWord";
import PolicyReview from "./PolicyReview";
import PolicyTimeline from "./PolicyTimeline";
import { usePolicyTimeline } from "./usePolicyTimeline";
import ScoreBreakdown from "./ScoreBreakdown";
import { usePractice } from "./usePractice";

function turnBingo(
  turn: ReturnType<typeof reviewTurns>[number],
  rules: BingoRules,
) {
  return (
    turn.move.bingo ??
    (!!turn.position && isBingo(rules, turn.position.tiles.length))
  );
}

const noPolicyTurns: ReturnType<typeof reviewTurns> = [];

export default function TurnReview({
  game,
  index: selected,
  onSelect,
  onClose,
}: {
  game: Game;
  index: number | null;
  onSelect: (index: number | null) => void;
  onClose: () => void;
}) {
  const turns = useMemo(() => reviewTurns(game), [game]);
  const [policyPlayer, setPolicyPlayer] = useState<Player>(
    () =>
      (selected === null ? undefined : turns[selected]?.move.player) ??
      (turns.some(({ move }) => move.player === "opponent")
        ? "opponent"
        : "you"),
  );
  const [preview, setPreview] = useState<Move>();
  const { result, progress, error, run, reset } = usePractice<
    Move[] | ReviewSummary
  >();
  useEffect(() => {
    reset();
    setPreview(undefined);
  }, [game, reset, selected]);
  const turn = selected === null ? undefined : turns[selected];
  const position = turn?.position;
  const template = position?.premiums
    ? { ...game.template, premiums: position.premiums }
    : game.template;
  const eligible = turns.flatMap(({ position, move, index }) =>
    !move.action && position?.rack && move.player === "you" ? [{ position, move, index }] : [],
  );
  const policyTurns = game.solo ? noPolicyTurns : turns;
  const timelines = {
    you: usePolicyTimeline(game.template, policyTurns, "you"),
    opponent: usePolicyTimeline(game.template, policyTurns, "opponent"),
  };
  const timeline = timelines[turn?.move.player ?? policyPlayer];
  const policyTurn = timeline.turns.find(({ index }) => index === selected);
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
      template,
      preview?.direction ?? position.direction,
    );
  }, [position, tiles, template, preview]);
  const reviewBody = useRef<HTMLDivElement>(null);
  const returnToTurn = useRef<number | null>(null);
  useEffect(() => {
    const body = reviewBody.current;
    if (!body) return;
    if (selected !== null) {
      body.querySelector<HTMLButtonElement>("[data-back-to-review]")?.focus();
      const dialog = body.closest("dialog");
      if (dialog) dialog.scrollTop = 0;
    } else if (returnToTurn.current !== null) {
      body
        .querySelector<HTMLButtonElement>(
          `[data-policy-turn="${returnToTurn.current}"]`,
        )
        ?.focus();
    }
  }, [selected]);
  function choose(index: number | null) {
    const nextTurn = index === null ? turn : turns[index];
    if (nextTurn) setPolicyPlayer(nextTurn.move.player);
    if (index === null) returnToTurn.current = selected;
    onSelect(index);
  }
  return (
    <Modal
      title={
        turn ? (
          <>
            Review move {turn.index + 1} ·{" "}
            {turn.move.action ? trackedTurnLabel(turn.move) : <MoveWord
              word={turn.move.word}
              bingo={turnBingo(turn, template)}
            />}
          </>
        ) : (
          "Review game"
        )
      }
      subtitle="Analysis uses this game’s current word list. Your live board and rack stay in place."
      wide
      onClose={onClose}
    >
      <div className="practice-body" ref={reviewBody}>
        {turn ? (
          <>
            <button
              className="button secondary"
              data-back-to-review
              onClick={() => choose(null)}
            >
              Back to game review
            </button>
            <p>
              {turn.move.player === "you" ? "You" : "Opponent"} ·{" "}
              {turn.move.score} recorded pts
              {turnBingo(turn, template) ? " · Bingo" : ""}
            </p>
            {!game.solo && policyTurn && (
              <PolicyReview
                key={policyTurn.key}
                player={timeline.player}
                analysisKey={policyTurn.key}
                dictionaryId={policyTurn.dictionaryId}
                input={policyTurn.input}
                saved={timeline.results[policyTurn.key]}
                saveResult={timeline.saveResult}
                queued={!!timeline.progress}
              />
            )}
            {position ? (
              <>
                <div className="turn-review-board">
                  <Board
                    board={position.board}
                    template={template}
                    preview={{ tiles: tiles ?? [] }}
                    previewPlayer={turn.move.player}
                    compact
                  />
                </div>
                {position.rack ? (
                  <p>
                    Rack before the move ·{" "}
                    <strong>{position.rack.replaceAll(".", "·")}</strong>
                  </p>
                ) : turn.move.player === "you" ? (
                  <p>Rack before the move is unknown.</p>
                ) : null}
                {breakdown && <ScoreBreakdown breakdown={breakdown} />}
                {!turn.move.action && position.rack && !progress && !alternatives && (
                  <button
                    className="button primary"
                    onClick={() =>
                      run({
                        kind: "turn",
                        template,
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
                              <strong>
                                <MoveWord
                                  move={move}
                                  rules={template}
                                />
                              </strong>{" "}
                              ·{" "}
                              <span
                                className={scoreTone(
                                  (turn.move.player === "you" ? 1 : -1) *
                                    (move.score - turn.move.score),
                                )}
                              >
                                {move.score} pts
                              </span>{" "}
                              · {moveLocation(move)}
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
            {game.solo ? (
              <ol className="practice-results" aria-label="Tracked plays">
                {turns.map((turn) => (
                  <li key={turn.index}>
                    <button
                      className="score-review-link"
                      data-policy-turn={turn.index}
                      onClick={() => choose(turn.index)}
                    >
                      {turn.index + 1} · {turn.move.action
                        ? trackedTurnLabel(turn.move)
                        : <MoveWord word={turn.move.word} bingo={turnBingo(turn, game.template)} />} · {turn.move.score} pts
                    </button>
                  </li>
                ))}
              </ol>
            ) : !!turns.length && (
              <PolicyTimeline
                timeline={timeline}
                onSelect={choose}
                onPlayerChange={setPolicyPlayer}
              />
            )}
            <p>
              {eligible.length} of{" "}
              {turns.filter(({ move }) => !move.action && move.player === "you").length} of
              your tracked turns have a saved board and rack to analyze.
            </p>
            {!!eligible.length && !progress && !summary && (
              <button
                className="button primary"
                onClick={() =>
                  run({
                    kind: "game",
                    solo: game.solo,
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
                  {" "}Point gaps compare immediate scores.
                  {!game.solo && " Reply estimates use a small sample of possible opponent racks."}
                </p>
                {summary.opportunities.length ? (
                  <ul className="practice-results">
                    {summary.opportunities.map((item) => (
                      <li key={item.index}>
                        <button
                          className="button secondary"
                          onClick={() => choose(item.index)}
                        >
                          Move {item.index + 1} ·{" "}
                          <MoveWord
                            word={item.word}
                            bingo={turnBingo(turns[item.index], template)}
                          />
                        </button>
                        {item.bingo && (
                          <p>
                            Missed bingo ·{" "}
                            <strong>
                              <MoveWord
                                move={item.bingo}
                                rules={template}
                              />
                            </strong>{" "}
                            for {item.bingo.score}
                          </p>
                        )}
                        {item.gap >= 8 && item.best && (
                          <p>
                            <strong className={scoreTone(item.gap)}>
                              +{item.gap} immediate points
                            </strong>{" "}
                            ·{" "}
                            <strong>
                              <MoveWord
                                move={item.best}
                                rules={template}
                              />
                            </strong>{" "}
                            for {item.best.score} vs. {item.score}
                          </p>
                        )}
                        {item.replyRisk && (
                          <p>
                            40+ point reply available in{" "}
                            <span className="value-bad">
                              {Math.round(item.replyRisk.actual * 100)}%
                            </span>{" "}
                            of samples, versus{" "}
                            <span className="value-good">
                              {Math.round(item.replyRisk.alternative * 100)}%
                            </span>
                            after{" "}
                            <strong>
                              <MoveWord
                                word={item.replyRisk.word}
                                bingo={item.replyRisk.bingo}
                              />
                            </strong>{" "}
                            ({item.replyRisk.trials} samples).
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
