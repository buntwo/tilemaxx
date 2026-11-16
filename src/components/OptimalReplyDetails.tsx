import { useState } from "react";
import type { EndgameLine } from "../../shared/endgame";
import { scoreTotalsAtPosition } from "../../shared/game-scoring";
import {
  coordinate,
  type Board as BoardState,
  type Game,
  type Move,
  type Player,
} from "../../shared/model";
import { placeTiles } from "../../shared/move-analysis";
import { finalMarginLabel, scoreTone, signedPoints } from "../score-tone";
import Board from "./Board";
import MoveWord from "./MoveWord";
import "./optimal-reply.css";

type Scores = EndgameLine["points"];
type Step = { board: BoardState; scores?: Scores } & (
  | { kind: "turn"; player: Player; move: Move | null; leave: string }
  | { kind: "adjustment"; points: Scores }
);

const scorePair = ({ you, opponent }: Scores) => `${you}–${opponent}`;

function leadLabel(margin: number) {
  return margin > 0
    ? `Ahead by ${margin}`
    : margin < 0
      ? `Behind by ${-margin}`
      : "Tied";
}

export default function OptimalReplyDetails({
  game,
  line,
  opponentRack,
}: {
  game: Game;
  line: EndgameLine;
  opponentRack: string;
}) {
  const totals = scoreTotalsAtPosition(game);
  const scoresWith = (points: Scores) =>
    totals && {
      you: totals.you + points.you,
      opponent: totals.opponent + points.opponent,
    };
  const final = scoresWith(line.points);
  const finalMargin = final && final.you - final.opponent;
  const played = { you: 0, opponent: 0 };
  const racks = { you: game.rack, opponent: opponentRack };
  let board = game.board;
  const steps = line.line.map<Step>((move, index) => {
    const player = index % 2 ? "opponent" : "you";
    const before = board;
    if (move) {
      played[player] += move.score;
      board = placeTiles(board, move);
      racks[player] = move.leave;
    }
    return {
      kind: "turn",
      player,
      move,
      leave: racks[player],
      board: before,
      scores: scoresWith(played),
    };
  });
  const adjustment = {
    you: line.points.you - played.you,
    opponent: line.points.opponent - played.opponent,
  };
  if (adjustment.you || adjustment.opponent)
    steps.push({
      kind: "adjustment",
      points: adjustment,
      board,
      scores: final,
    });

  const [selection, setSelection] = useState<{
    line: EndgameLine;
    index: number;
  }>();
  const selected =
    selection?.line === line ? selection.index : line.line.length > 1 ? 1 : 0;
  const step = steps[selected];
  const candidate = line.line[0];
  const { size } = game.template;

  return (
    <div className="optimal-reply">
      <div
        className={`optimal-reply-outcome${final ? " with-final-score" : ""}`}
      >
        {final && finalMargin !== undefined && (
          <div>
            <span className="optimal-reply-label">Optimal final score</span>
            <div className="optimal-reply-final">
              <div className="optimal-reply-score-pair">
                <span>
                  <strong>{final.you}</strong>
                  <small>You</small>
                </span>
                <span aria-hidden="true">–</span>
                <span>
                  <strong>{final.opponent}</strong>
                  <small>Opponent</small>
                </span>
              </div>
              <strong className={scoreTone(finalMargin)}>
                {finalMarginLabel(finalMargin)}
              </strong>
            </div>
          </div>
        )}
        <div className="optimal-reply-swing">
          <span className="optimal-reply-label">Optimal swing</span>
          <strong className={scoreTone(line.spread)}>
            {signedPoints(line.spread)} <small>pts</small>
          </strong>
        </div>
      </div>
      <div className="optimal-reply-layout">
        <div>
          <h4>Optimal endgame line</h4>
          {totals && (
            <div className="optimal-reply-start">
              <span>
                Before{" "}
                {candidate ? (
                  <MoveWord move={candidate} rules={game.template} />
                ) : (
                  "the line"
                )}
              </span>
              <strong>{scorePair(totals)}</strong>
            </div>
          )}
          <ol className="optimal-reply-turns">
            {steps.map((entry, index) => {
              const scores = entry.scores;
              const margin = scores && scores.you - scores.opponent;
              return (
                <li key={index}>
                  <button
                    type="button"
                    className="optimal-reply-turn"
                    aria-pressed={index === selected}
                    onClick={() => setSelection({ line, index })}
                  >
                    {entry.kind === "turn" ? (
                      <>
                        <span className="optimal-reply-turn-label">
                          <strong>
                            {entry.move ? (
                              <MoveWord
                                move={entry.move}
                                rules={game.template}
                              />
                            ) : (
                              "Pass"
                            )}
                          </strong>
                          <small>
                            {entry.player === "you" ? "You" : "Opponent"}
                            {entry.move &&
                              ` · ${coordinate(entry.move.row * size + entry.move.col, size)} ${entry.move.direction}`}
                          </small>
                        </span>
                        <span
                          className="optimal-reply-leave"
                          role="img"
                          aria-label={
                            entry.leave
                              ? `Leave: ${[...entry.leave]
                                  .map((tile) => (tile === "?" ? "blank" : tile))
                                  .join(", ")}`
                              : "Empty rack"
                          }
                          title={entry.leave ? "Rack leave" : "Empty rack"}
                        >
                          {entry.leave.replaceAll("?", "□") || "—"}
                        </span>
                        <span
                          className={`optimal-reply-points ${scoreTone((entry.move?.score ?? 0) * (entry.player === "you" ? 1 : -1)) ?? ""}`}
                        >
                          {signedPoints(entry.move?.score ?? 0)}
                        </span>
                      </>
                    ) : (
                      <span className="optimal-reply-turn-label rack-adjustment">
                        <strong>Rack adjustment</strong>
                        <small>
                          You{" "}
                          <span className={scoreTone(entry.points.you)}>
                            {signedPoints(entry.points.you)}
                          </span>
                          {" · "}Opponent{" "}
                          <span className={scoreTone(-entry.points.opponent)}>
                            {signedPoints(entry.points.opponent)}
                          </span>
                        </small>
                      </span>
                    )}
                    {scores && margin !== undefined && (
                      <span className="optimal-reply-step-score">
                        <strong>{scorePair(scores)}</strong>
                        <small className={scoreTone(margin)}>
                          {index === steps.length - 1
                            ? finalMarginLabel(margin)
                            : leadLabel(margin)}
                        </small>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <figure className="optimal-reply-board">
          <figcaption aria-live="polite">
            {step.kind === "adjustment" ? (
              "Final board"
            ) : step.move ? (
              <>
                Board after <MoveWord move={step.move} rules={game.template} />
              </>
            ) : step.player === "you" ? (
              "Board after your pass"
            ) : (
              "Board after opponent passes"
            )}
          </figcaption>
          <Board
            compact
            template={game.template}
            board={step.board}
            preview={step.kind === "turn" ? step.move : undefined}
          />
        </figure>
      </div>
    </div>
  );
}
