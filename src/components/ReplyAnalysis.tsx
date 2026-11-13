import { useState, type CSSProperties } from "react";
import { LoaderCircle } from "lucide-react";
import { pendingOpponentPlay, tracksScores } from "../../shared/game-scoring";
import { coordinate, type Game, type Move } from "../../shared/model";
import { placeTiles } from "../../shared/move-analysis";
import type { MoveDefense } from "../../shared/premium-defense";
import {
  REPLY_BUCKETS,
  REPLY_REFINED_SAMPLES,
  REPLY_SAMPLES,
  replyColor,
  type ExactReply,
  type ReplyDistribution,
  type ReplyResult,
} from "../../shared/reply-analysis";
import type { useReplyAnalysis } from "../useReplyAnalysis";
import Board from "./Board";
import Modal from "./Modal";
import { PremiumReplyNote } from "./PremiumDefense";
import ReplyHeatmap from "./ReplyHeatmap";

type Analysis = ReturnType<typeof useReplyAnalysis>;

export function signedPoints(points: number, decimals = 0) {
  const value = Math.abs(points).toFixed(decimals);
  return Number(value) === 0 ? value : `${points < 0 ? "−" : "+"}${value}`;
}

export function replyScoreTotals(game: Game) {
  const scoring = game.scoring;
  if (!scoring || !tracksScores(game)) return;
  const pending = pendingOpponentPlay(game);
  if (scoring.pendingBase && !pending) return;
  return {
    you: scoring.you.points,
    opponent: scoring.opponent.points + (pending?.score ?? 0),
  };
}

function endgameScores(
  move: Move,
  result: ExactReply,
  scores?: ReturnType<typeof replyScoreTotals>,
) {
  if (!scores) return;
  const after = { you: scores.you + move.score, opponent: scores.opponent };
  const you = after.you + result.yourAdjustment;
  const opponent =
    after.opponent + (result.reply?.score ?? 0) + result.opponentAdjustment;
  return { after, you, opponent, margin: you - opponent };
}

function replyMargin(result: ExactReply, margin?: number) {
  if (margin === undefined)
    return result.ends === "you"
      ? "Goes out"
      : result.reply
        ? `Best ${result.reply.score} pts`
        : result.ends
          ? "Game ends"
          : "Pass";
  if (!margin) return result.ends ? "Final tie" : "Tied";
  return `${result.ends ? (margin > 0 ? "Win" : "Lose") : margin > 0 ? "Lead" : "Trail"} ${signedPoints(margin)}`;
}

export function ReplyCell({
  move,
  result,
  scores,
}: {
  move: Move;
  result: ReplyResult;
  scores?: ReturnType<typeof replyScoreTotals>;
}) {
  const delta = result.difference;
  const tone =
    delta !== null && delta >= 0.05
      ? "defense-warning"
      : delta !== null && delta <= -0.05
        ? "defense-covered"
        : "reply-neutral";
  const final =
    result.kind === "empty-bag"
      ? endgameScores(move, result, scores)
      : undefined;
  return (
    <span className="reply-cell">
      <strong className={tone}>
        {delta === null
          ? "—"
          : signedPoints(delta, result.kind === "distribution" ? 1 : 0)}
      </strong>
      {result.kind === "distribution" ? (
        <span className="reply-mini" aria-hidden="true">
          {result.buckets.map((count, index) => (
            <span
              key={index}
              data-change={replyColor(result, index)}
              style={{ height: `${(count / result.count) * 100}%` }}
            />
          ))}
        </span>
      ) : (
        <small
          className={final && final.margin < 0 ? "defense-warning" : undefined}
        >
          {replyMargin(result, final?.margin)}
        </small>
      )}
    </span>
  );
}

export function ReplySettings({ analysis }: { analysis: Analysis }) {
  const [bag, setBag] = useState("");
  const [scoreless, setScoreless] = useState("");
  const count = bag === "" ? analysis.minimumBag : Number(bag);
  const turns = scoreless === "" ? 0 : Number(scoreless);
  const valid =
    Number.isInteger(count) &&
    count >= analysis.minimumBag &&
    count <= analysis.unseen &&
    Number.isInteger(turns) &&
    turns >= 0 &&
    turns <= analysis.maxScorelessTurns;
  return (
    <details className="reply-settings">
      <summary>Reply settings</summary>
      <p>
        The bag estimate assumes one opponent who refilled their rack after
        playing. Enter the bag count if your position differs.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) analysis.setOptions(count, count ? 0 : turns);
        }}
      >
        <label>
          Tiles in bag
          <input
            type="number"
            min={analysis.minimumBag}
            max={analysis.unseen}
            placeholder={String(analysis.minimumBag)}
            value={bag}
            onChange={(event) => setBag(event.target.value)}
          />
        </label>
        {count === 0 && (
          <label>
            Prior scoreless turns
            <input
              type="number"
              min={0}
              max={analysis.maxScorelessTurns}
              placeholder="0"
              value={scoreless}
              onChange={(event) => setScoreless(event.target.value)}
            />
          </label>
        )}
        <button type="submit" className="button secondary" disabled={!valid}>
          Update reply analysis
        </button>
      </form>
    </details>
  );
}

function DistributionChart({
  result,
  move,
  reference,
}: {
  result: ReplyDistribution;
  move: Move;
  reference: Move;
}) {
  const compare = move.id !== reference.id;
  const max =
    Math.max(...result.buckets, ...result.reference.buckets) / result.count;
  const ceiling = max > 0.5 ? 100 : 50;
  const percent = (count: number) =>
    `${((100 * count) / result.count).toFixed(1)}%`;
  const height = (count: number) =>
    `${(10000 * count) / (ceiling * result.count)}%`;
  const share = (counts: number[]) => percent(counts[3] + counts[4]);
  const renderStat = (before: string, after: string) =>
    compare ? `${before} → ${after}` : after;
  const groups = REPLY_BUCKETS.map((bucket, i) => {
    const selected = percent(result.buckets[i]);
    const baseline = percent(result.reference.buckets[i]);
    return `${bucket} points, ${selected} after ${move.word}${compare ? `, ${baseline} after ${reference.word}` : ""}`;
  });
  return (
    <>
      <div className="reply-stats">
        <span>
          Avg. best reply{" "}
          <strong>
            {renderStat(
              result.reference.mean.toFixed(1),
              result.mean.toFixed(1),
            )}{" "}
            pts
          </strong>
        </span>
        <span>
          40+ reply{" "}
          <strong>
            {renderStat(share(result.reference.buckets), share(result.buckets))}
          </strong>
        </span>
      </div>
      <div className="reply-axis-label" aria-hidden="true">
        Share of racks
      </div>
      <div
        className="reply-chart"
        role="img"
        aria-label={`Best reply scores. ${groups.join(". ")}`}
      >
        <div className="reply-ticks" aria-hidden="true">
          {[ceiling, ceiling / 2, 0].map((tick, i) => (
            <span key={tick} style={{ bottom: `${100 - i * 50}%` }}>
              {tick}%
            </span>
          ))}
        </div>
        <div className="reply-gridlines" aria-hidden="true" />
        {REPLY_BUCKETS.map((bucket, i) => (
          <div
            key={bucket}
            className="reply-bin"
            aria-hidden="true"
            title={groups[i]}
            style={{ "--reply-column": i + 2 } as CSSProperties}
          >
            <span className="reply-bin-bars">
              {compare && (
                <span
                  className="reply-reference"
                  style={{ height: height(result.reference.buckets[i]) }}
                />
              )}
              <span
                data-change={replyColor(result, i)}
                style={{ height: height(result.buckets[i]) }}
              />
            </span>
            <span>{bucket}</span>
          </div>
        ))}
      </div>
      <p className="reply-chart-key">
        {compare && (
          <span>
            <i />
            Reference · After {reference.word}
          </span>
        )}
        <span>
          {result.count.toLocaleString()}{" "}
          {result.exact ? "possible" : "sampled"} racks
        </span>
      </p>
      <details className="reply-bin-values">
        <summary>Bucket percentages</summary>
        <ul>
          {groups.map((group) => (
            <li key={group}>{group}</li>
          ))}
        </ul>
      </details>
    </>
  );
}

function ExactReplyDetails({
  game,
  move,
  result,
  analysis,
}: {
  game: Game;
  move: Move;
  result: ExactReply;
  analysis: Analysis;
}) {
  const totals = replyScoreTotals(game);
  const scores = endgameScores(move, result, totals);
  const { reply, highest, ends } = result;
  const afterMargin = scores && scores.after.you - scores.after.opponent;
  const summary = scores
    ? replyMargin(result, scores.margin)
    : replyMargin(result);
  const line =
    analysis.detail?.key === `reply-line:${move.id}`
      ? analysis.detail
      : undefined;
  const finalSpread =
    line?.line && totals
      ? totals.you - totals.opponent + line.line.spread
      : undefined;
  const scorePair = (you: number, opponent: number) => `${you}–${opponent}`;
  const replyText = reply
    ? `${reply.word} · ${reply.score} pts · ${coordinate(reply.row * game.template.size + reply.col, game.template.size)}${reply.direction === "across" ? "→" : "↓"}`
    : "Pass";
  const leadLabel =
    scores && !ends
      ? scores.margin < 0
        ? `They ${(afterMargin ?? 0) < 0 ? "stay ahead" : "can take the lead"} by ${-scores.margin}`
        : scores.margin === 0
          ? "They can tie the game"
          : `You stay ahead by ${scores.margin}`
      : summary;
  return (
    <div className="reply-exact">
      <h3>{leadLabel}</h3>
      <div className="reply-known-rack">
        <span>Opponent rack</span>
        <span aria-label={result.rack ? [...result.rack].join(" ") : "Empty"}>
          {[...result.rack].map((letter, index) => (
            <b key={index} aria-hidden="true">
              {letter}
            </b>
          ))}
          {!result.rack && "—"}
        </span>
      </div>
      <dl className="reply-steps">
        {scores && (
          <div>
            <dt>After your play</dt>
            <dd>{scorePair(scores.after.you, scores.after.opponent)}</dd>
          </div>
        )}
        {scores &&
          ends !== "you" &&
          (reply || !ends) &&
          (afterMargin ?? -1) >= 0 && (
            <div>
              <dt>Swing they need to go ahead</dt>
              <dd>{afterMargin! + 1} pts</dd>
            </div>
          )}
        {ends === "you" ? (
          <div>
            <dt>You go out</dt>
            <dd>
              {move.word} · {move.score} pts
            </dd>
          </div>
        ) : ends === "scoreless" && !reply ? (
          <div>
            <dt>Scoreless turn limit</dt>
            <dd>Game ends</dd>
          </div>
        ) : (
          <div>
            <dt>
              {ends === "opponent"
                ? "They go out"
                : "Strongest immediate reply"}
            </dt>
            <dd>{replyText}</dd>
          </div>
        )}
        {highest && highest.id !== reply?.id && (
          <div>
            <dt>Highest raw reply score</dt>
            <dd>
              {highest.word} · {highest.score} pts
            </dd>
          </div>
        )}
        {result.difference !== null && analysis.reference && (
          <div>
            <dt>Raw reply vs. {analysis.reference.word}</dt>
            <dd>{signedPoints(result.difference)} pts</dd>
          </div>
        )}
        {ends && (
          <div>
            <dt>Unplayed tiles</dt>
            <dd>
              You {signedPoints(result.yourAdjustment)} · Opponent{" "}
              {signedPoints(result.opponentAdjustment)}
            </dd>
          </div>
        )}
        {scores && (
          <div>
            <dt>{ends ? "Final score" : "After their reply"}</dt>
            <dd>{scorePair(scores.you, scores.opponent)}</dd>
          </div>
        )}
      </dl>
      {reply && (
        <Board
          compact
          template={game.template}
          board={placeTiles(game.board, move)}
          preview={reply}
        />
      )}
      {!ends && game.template.rules === "scrabble" && (
        <div className="reply-line">
          {!line?.line && (
            <button
              className="button secondary"
              type="button"
              disabled={line?.pending}
              onClick={() =>
                analysis.requestDetail(move, { kind: "reply-line" })
              }
            >
              {line?.pending ? (
                <>
                  <LoaderCircle size={14} className="spin" /> Checking endgame…
                </>
              ) : (
                "Calculate optimal endgame line"
              )}
            </button>
          )}
          {line?.error && <p role="status">{line.error}</p>}
          {line?.line && (
            <details open>
              <summary>
                Optimal endgame line
                {finalSpread !== undefined
                  ? ` · Final margin ${signedPoints(finalSpread)}`
                  : ""}
              </summary>
              <ol>
                {line.line.line.map((play, index) => (
                  <li key={index}>
                    {index % 2 === 0 ? "You" : "Opponent"} ·{" "}
                    {play ? `${play.word} · ${play.score} pts` : "Pass"}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReplyAnalysis({
  game,
  move,
  result,
  defense,
  analysis,
  onClose,
}: {
  game: Game;
  move: Move;
  result: ReplyResult;
  defense?: MoveDefense;
  analysis: Analysis;
  onClose: () => void;
}) {
  const [view, setView] = useState<"scores" | "heatmap">("scores");
  const detail =
    analysis.detail?.key === `reply-detail:${move.id}`
      ? analysis.detail
      : undefined;
  const distribution =
    detail?.result?.kind === "distribution"
      ? detail.result
      : result.kind === "distribution"
        ? result
        : undefined;
  return (
    <Modal
      title={`Reply after ${move.word}`}
      subtitle={
        result.kind === "empty-bag"
          ? analysis.bagAssumedEmpty
            ? "Bag assumed empty · Opponent rack from unseen tiles"
            : "Empty bag · Known opponent rack"
          : undefined
      }
      onClose={onClose}
    >
      {result.kind === "empty-bag" ? (
        <ExactReplyDetails
          game={game}
          move={move}
          result={result}
          analysis={analysis}
        />
      ) : (
        distribution &&
        analysis.reference && (
          <>
            <div
              className="reply-view-switch"
              role="group"
              aria-label="Reply detail view"
            >
              <button
                type="button"
                aria-pressed={view === "scores"}
                onClick={() => setView("scores")}
              >
                Scores
              </button>
              <button
                type="button"
                aria-pressed={view === "heatmap"}
                disabled={
                  view === "scores" && detail?.pending && !distribution.heatmap
                }
                onClick={() => {
                  setView("heatmap");
                  if (!distribution.heatmap && !detail?.pending) {
                    analysis.requestDetail(move, {
                      kind: "reply-detail",
                      samples:
                        distribution.count >= REPLY_REFINED_SAMPLES
                          ? REPLY_REFINED_SAMPLES
                          : REPLY_SAMPLES,
                      captureHeatmap: true,
                    });
                  }
                }}
              >
                Heatmap
              </button>
            </div>
            {view === "scores" ? (
              <DistributionChart
                result={distribution}
                move={move}
                reference={analysis.reference}
              />
            ) : distribution.heatmap ? (
              <ReplyHeatmap
                game={game}
                move={move}
                result={distribution}
                reference={analysis.reference}
              />
            ) : detail?.pending ? (
              <p role="status">Checking heatmap squares…</p>
            ) : null}
            {view === "scores" && defense && (
              <PremiumReplyNote
                game={game}
                defense={defense}
                opponentRackSize={analysis.unseen - analysis.bagSize}
              />
            )}
            {view === "scores" && (
              <p className="defense-help">
                Each rack uses its highest-scoring legal reply.
              </p>
            )}
            {!distribution.exact &&
              distribution.count < REPLY_REFINED_SAMPLES &&
              (view === "scores" || !!distribution.heatmap) && (
                <button
                  type="button"
                  className="button secondary reply-refine"
                  disabled={detail?.pending}
                  onClick={() =>
                    analysis.requestDetail(move, {
                      kind: "reply-detail",
                      samples: REPLY_REFINED_SAMPLES,
                      captureHeatmap: !!distribution.heatmap,
                    })
                  }
                >
                  {detail?.pending ? (
                    <>
                      <LoaderCircle className="spin" size={14} /> Refining
                      replies…
                    </>
                  ) : (
                    "Refine to 5,000 racks"
                  )}
                </button>
              )}
            {detail?.error && <p role="status">{detail.error}</p>}
          </>
        )
      )}
    </Modal>
  );
}
