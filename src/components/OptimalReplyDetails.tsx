import { moveLocation } from "../../shared/notation";
import { useEffect, useRef, useState } from "react";
import type { EndgameLine } from "../../shared/endgame";
import { scoreTotalsAtPosition } from "../../shared/game-scoring";
import {
  isBingo,
  type Board as BoardState,
  type Game,
  type Move,
  type Player,
} from "../../shared/model";
import { placeTiles } from "../../shared/move-analysis";
import { scoreTone, signedPoints } from "../score-tone";
import Board from "./Board";
import MiniTiles from "./MiniTiles";
import MoveWord, { BingoBadge, MoveLetters } from "./MoveWord";
import type { useMoveDefinitions } from "./useMoveDefinitions";
import "./optimal-reply.css";

type Scores = EndgameLine["points"];
type Step = { board: BoardState; scores?: Scores } & (
  | { kind: "turn"; player: Player; move: Move | null; leave: string }
  | { kind: "adjustment"; points: Scores }
);

const scorePair = ({ you, opponent }: Scores) => `${you}–${opponent}`;

function ScoreWithMargin({ scores }: { scores: Scores }) {
  const margin = scores.you - scores.opponent;
  return (
    <span className="optimal-reply-score">
      <strong>{scorePair(scores)}</strong>
      <small className={scoreTone(margin)}>{signedPoints(margin)}</small>
    </span>
  );
}

export default function OptimalReplyDetails({
  game,
  line,
  opponentRack,
  firstPlayer = "you",
  definitions,
}: {
  game: Game;
  line: EndgameLine;
  opponentRack: string;
  firstPlayer?: Player;
  definitions?: ReturnType<typeof useMoveDefinitions>;
}) {
  const totals = scoreTotalsAtPosition(game);
  const scoresWith = (points: Scores) =>
    totals && {
      you: totals.you + points.you,
      opponent: totals.opponent + points.opponent,
    };
  const final = scoresWith(line.points);
  const played = { you: 0, opponent: 0 };
  const racks = { you: game.rack, opponent: opponentRack };
  let board = game.board;
  const secondPlayer = firstPlayer === "you" ? "opponent" : "you";
  const steps = line.line.map<Step>((move, index) => {
    const player = index % 2 ? secondPlayer : firstPlayer;
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
  const lastMove = line.line.at(-1);
  const wentOut =
    game.template.rules !== "crossplay" && lastMove && !lastMove.leave;
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
  const selected = selection?.line === line ? selection.index : undefined;
  const step = selected === undefined ? undefined : steps[selected];
  const table = useRef<HTMLTableElement>(null);
  const hasDefinitions = !!definitions;
  useEffect(() => {
    function dismissOutside(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (hasDefinitions && target?.closest(".definition-tooltip, .definition-sheet")) return;
      const row = target?.closest("tbody tr");
      if (!row || !table.current?.contains(row)) setSelection(undefined);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setSelection(undefined);
    }
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [hasDefinitions]);
  const candidate = line.line[0];
  const { size } = game.template;

  return (
    <div className="optimal-reply">
      <div
        className={`optimal-reply-outcome${final ? " with-final-score" : ""}`}
      >
        {final && (
          <div className="optimal-reply-final">
            <span className="optimal-reply-label">Optimal final score</span>
            <ScoreWithMargin scores={final} />
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
          <table
            ref={table}
            className="optimal-reply-turns"
            aria-label="Optimal endgame line"
          >
            <thead>
              {totals && (
                <tr className="optimal-reply-start">
                  <td colSpan={3}>
                    Before{" "}
                    {candidate ? (
                      <MoveWord
                        move={candidate}
                        rules={game.template}
                      />
                    ) : (
                      "the pass"
                    )}
                  </td>
                  <td>
                    <ScoreWithMargin scores={totals} />
                  </td>
                </tr>
              )}
              <tr className="optimal-reply-headings">
                <th scope="col">Move</th>
                <th scope="col">Leave</th>
                <th scope="col">Pts</th>
                <th scope="col">Score</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((entry, index) => (
                <tr
                  key={index}
                  className={
                    entry.kind === "adjustment"
                      ? "optimal-reply-adjustment-row"
                      : entry.player === "opponent"
                        ? "optimal-reply-opponent-row"
                        : undefined
                  }
                  data-selected={index === selected || undefined}
                  onClick={() =>
                    setSelection(
                      index === selected ? undefined : { line, index },
                    )
                  }
                >
                  <td>
                    <button
                      type="button"
                      className="optimal-reply-turn"
                      aria-pressed={index === selected}
                      aria-describedby={definitions?.descriptionId(`step:${index}`)}
                    >
                      {entry.kind === "turn" ? (
                        <>
                          <strong className="optimal-reply-turn-word">
                            {entry.move ? (
                              <>
                                <span
                                  role="img"
                                  aria-label={entry.move.word}
                                  {...definitions?.wordProps(entry.move.word, `step:${index}`)}
                                  onContextMenu={definitions?.touch ? (event) => {
                                    if (definitions.ownsContextMenu(event.target))
                                      event.preventDefault();
                                  } : undefined}
                                >
                                  <MoveLetters
                                    move={entry.move}
                                    size={size}
                                    board={entry.board}
                                    showTileTitles={!definitions?.available}
                                  />
                                </span>
                                {isBingo(
                                  game.template,
                                  entry.move.tiles.length,
                                ) && <BingoBadge />}
                              </>
                            ) : (
                              "Pass"
                            )}
                          </strong>
                          <small className="optimal-reply-turn-note">
                            {entry.player === "you" ? "You" : "Opponent"}
                            {entry.move && ` · ${moveLocation(entry.move)}`}
                          </small>
                        </>
                      ) : (
                        <strong className="optimal-reply-final-label">
                          Final score
                        </strong>
                      )}
                    </button>
                  </td>
                  {entry.kind === "turn" ? (
                    <>
                      <td>
                        <span
                          className="optimal-reply-leave"
                          role="img"
                          aria-label={
                            entry.leave
                              ? `Leave: ${[...entry.leave].map((tile) => (tile === "?" ? "blank" : tile)).join(", ")}`
                              : entry.move
                                ? "Goes out"
                                : "Empty rack"
                          }
                        >
                          {entry.leave ? (
                            <MiniTiles
                              tiles={entry.leave}
                              opponent={entry.player === "opponent"}
                            />
                          ) : entry.move ? (
                            <span className="optimal-reply-goes-out">
                              (Goes out)
                            </span>
                          ) : (
                            "—"
                          )}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`optimal-reply-points ${scoreTone((entry.move?.score ?? 0) * (entry.player === "you" ? 1 : -1)) ?? ""}`}
                        >
                          {signedPoints(entry.move?.score ?? 0)}
                        </span>
                      </td>
                    </>
                  ) : (
                    <td colSpan={2}>
                      {(wentOut ||
                        entry.points.you !== 0 ||
                        entry.points.opponent !== 0) && (
                        <span className="optimal-reply-adjustment">
                          <strong>Rack adjustment</strong>
                          <small>
                            You{" "}
                            <span className={scoreTone(entry.points.you)}>
                              {signedPoints(entry.points.you)}
                            </span>
                            {" · "}Opp.{" "}
                            <span className={scoreTone(-entry.points.opponent)}>
                              {signedPoints(entry.points.opponent)}
                            </span>
                          </small>
                        </span>
                      )}
                    </td>
                  )}
                  <td className="optimal-reply-step-score">
                    {entry.scores ? (
                      <ScoreWithMargin scores={entry.scores} />
                    ) : (
                      <span title="Scores are not tracked">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <figure className="optimal-reply-board">
          <figcaption aria-live="polite">
            {!step ? (
              "Current board"
            ) : step.kind === "adjustment" ? (
              "Final board"
            ) : step.move ? (
              <>
                Board after{" "}
                <MoveWord
                  move={step.move}
                  rules={game.template}
                />
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
            board={step?.board ?? game.board}
            preview={step?.kind === "turn" ? step.move : undefined}
            previewPlayer={step?.kind === "turn" ? step.player : undefined}
          />
        </figure>
      </div>
    </div>
  );
}
