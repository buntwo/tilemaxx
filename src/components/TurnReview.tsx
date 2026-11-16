import { useCallback, useMemo, useState } from "react";
import { scorePlacement } from "../../shared/game-scoring";
import {
  coordinate,
  isBingo,
  type BingoRules,
  type Game,
  type Move,
} from "../../shared/model";
import type {
  OpponentPolicyInput,
  OpponentPolicyResult,
} from "../../shared/opponent-policy";
import { reviewTurns, type ReviewSummary } from "../../shared/turn-review";
import { scoreTone } from "../score-tone";
import Board from "./Board";
import Modal from "./Modal";
import MoveWord from "./MoveWord";
import OpponentPolicyReview from "./OpponentPolicyReview";
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
  const template = position?.premiums
    ? { ...game.template, premiums: position.premiums }
    : game.template;
  const eligible = turns.flatMap(({ position, move, index }) =>
    position?.rack && move.player === "you" ? [{ position, move, index }] : [],
  );
  const [policyResults, setPolicyResults] = useState<
    Record<string, OpponentPolicyResult>
  >({});
  const savePolicyResult = useCallback(
    (key: string, result: OpponentPolicyResult) => {
      setPolicyResults((results) => ({ ...results, [key]: result }));
    },
    [],
  );
  const opponentTurns = useMemo(
    () =>
      turns.flatMap(({ move, index, position }) => {
        if (move.player !== "opponent") return [];
        const input: OpponentPolicyInput | undefined = position && {
          position: {
            board: position.board,
            tiles: position.tiles,
            observerRack: position.observerRack,
          },
          template: position.premiums
            ? { ...game.template, premiums: position.premiums }
            : game.template,
          word: move.word,
        };
        const key = JSON.stringify([index, game.dictionaryId, input]);
        return [{ move, index, input, key }];
      }),
    [turns, game.template, game.dictionaryId],
  );
  const opponentTurn = opponentTurns.find(({ index }) => index === selected);
  const checkedOpponentTurns = opponentTurns.filter(
    ({ key }) =>
      policyResults[key] && policyResults[key].kind !== "unavailable",
  ).length;
  const topOneRuledOut = opponentTurns.filter(
    ({ key }) => policyResults[key]?.higherScoringPlacement,
  ).length;
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
  function choose(index: number | null) {
    reset();
    setPreview(undefined);
    setSelected(index);
  }
  return (
    <Modal
      title={
        turn ? (
          <>
            Review move {turn.index + 1} ·{" "}
            <MoveWord word={turn.move.word} bingo={turnBingo(turn, template)} />
            {opponentTurn && (
              <OpponentPolicyReview
                key={opponentTurn.key}
                analysisKey={opponentTurn.key}
                dictionaryId={game.dictionaryId}
                input={opponentTurn.input}
                savedResult={policyResults[opponentTurn.key]}
                saveResult={savePolicyResult}
              />
            )}
          </>
        ) : (
          "Review game"
        )
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
              {turn.move.score} recorded pts
              {turnBingo(turn, template) ? " · Bingo" : ""}
            </p>
            {position ? (
              <>
                <div className="turn-review-board">
                  <Board
                    board={position.board}
                    template={template}
                    preview={{ tiles: tiles ?? [] }}
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
                {position.rack && !progress && !alternatives && (
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
                                <MoveWord move={move} rules={template} />
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
                              ·{" "}
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
                              <MoveWord move={item.bingo} rules={template} />
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
                              <MoveWord move={item.best} rules={template} />
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
            {!!opponentTurns.length && (
              <section
                className="policy-fit practice-body"
                aria-label="Opponent turns"
              >
                <h3>Opponent turns</h3>
                {!!(checkedOpponentTurns || topOneRuledOut) && (
                  <p>
                    Policy fit calculated for {checkedOpponentTurns} of{" "}
                    {opponentTurns.length} turns.
                    {topOneRuledOut > 0 &&
                      ` Top 1 by points was ruled out on ${topOneRuledOut}.`}
                  </p>
                )}
                <ul className="practice-results">
                  {opponentTurns.map(({ index, move, input, key }) => (
                    <li key={index}>
                      <button
                        className="button secondary"
                        onClick={() => choose(index)}
                      >
                        Move {index + 1} ·{" "}
                        <MoveWord
                          word={move.word}
                          bingo={turnBingo(turns[index], template)}
                        />
                      </button>
                      {(!input ||
                        policyResults[key]?.kind === "unavailable") && (
                        <small>Policy fit unavailable</small>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
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
