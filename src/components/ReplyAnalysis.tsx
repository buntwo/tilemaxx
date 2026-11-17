import { useState, type CSSProperties } from "react";
import { LoaderCircle } from "lucide-react";
import { scoreTotalsAtPosition } from "../../shared/game-scoring";
import { coordinate, type Game, type Move } from "../../shared/model";
import { placeTiles } from "../../shared/move-analysis";
import type { MoveDefense } from "../../shared/premium-defense";
import {
  REPLY_BUCKETS,
  REPLY_DETAIL_TIME_MS,
  REPLY_REFINED_SAMPLES,
  REPLY_SAMPLES,
  REPLY_SUMMARY_TIME_MS,
  replyColor,
  type ExactReply,
  type ReplyDistribution,
  type ReplyResult,
  type ReplySearchLimit,
} from "../../shared/reply-analysis";
import { SEARCH_LIMITS } from "../../shared/solver";
import { scoreTone, signedPoints } from "../score-tone";
import type { useReplyAnalysis } from "../useReplyAnalysis";
import Board from "./Board";
import Modal from "./Modal";
import MoveWord from "./MoveWord";
import { PremiumReplyNote } from "./PremiumDefense";
import ReplyHeatmap from "./ReplyHeatmap";

type Analysis = ReturnType<typeof useReplyAnalysis>;

function replyLimitMessage(
  limit: ReplySearchLimit,
  size: number,
  timeMs: number,
) {
  const reasons = {
    "analysis-time": `${timeMs / 1_000}-second analysis time limit`,
    "rack-time": `${SEARCH_LIMITS.maxMs / 1_000}-second per-rack time limit`,
    nodes: `${SEARCH_LIMITS.maxNodes.toLocaleString("en-US")} search node limit`,
    moves: `${SEARCH_LIMITS.maxMoves.toLocaleString("en-US")} legal move limit`,
  };
  const { word, row, col, direction } = limit.move;
  const square = coordinate(row * size + col, size);
  const rack = limit.rack
    ? `opponent rack ${limit.rack}`
    : "an empty opponent rack";
  const blanks = limit.rack.includes("?") ? " (? = blank)" : "";
  return `Hit the ${reasons[limit.reason]} after ${word} at ${square} ${direction} with ${rack}${blanks}.`;
}

export function ReplyLimitNotice({
  analysis,
  size,
}: {
  analysis: Analysis;
  size: number;
}) {
  const { limit, skippedLimits } = analysis;
  if (limit)
    return (
      <div className="reply-controls" role="status">
        {replyLimitMessage(limit, size, REPLY_SUMMARY_TIME_MS)}
      </div>
    );
  const skipped = Object.entries(skippedLimits ?? {});
  if (!skipped.length) return null;
  if (skipped.length === 1)
    return (
      <div className="reply-controls" role="status">
        {replyLimitMessage(skipped[0][1], size, REPLY_SUMMARY_TIME_MS)}
      </div>
    );
  return (
    <div className="reply-controls">
      <details className="reply-limit-list">
        <summary>{skipped.length} opponent reply searches hit a limit</summary>
        <ul>
          {skipped.map(([id, limit]) => (
            <li key={id}>{replyLimitMessage(limit, size, REPLY_SUMMARY_TIME_MS)}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function endgameScores(
  move: Move,
  result: ExactReply,
  scores?: ReturnType<typeof scoreTotalsAtPosition>,
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
  const standing = result.ends
    ? margin > 0
      ? "Win"
      : "Lose"
    : margin > 0
      ? "Lead"
      : "Trail";
  return `${standing} by ${Math.abs(margin)}`;
}

export function ReplyCell({
  move,
  result,
  scores,
}: {
  move: Move;
  result: ReplyResult;
  scores?: ReturnType<typeof scoreTotalsAtPosition>;
}) {
  const delta = result.difference;
  const decimals = result.kind === "distribution" ? 1 : 0;
  const tone =
    delta === null ? undefined : scoreTone(-Number(delta.toFixed(decimals)));
  const final =
    result.kind === "empty-bag"
      ? endgameScores(move, result, scores)
      : undefined;
  return (
    <span className="reply-cell">
      <strong className={tone ?? "reply-neutral"}>
        {delta === null ? "—" : signedPoints(delta, decimals)}
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
        <small className={scoreTone(final?.margin) ?? "reply-neutral"}>
          {replyMargin(result, final?.margin)}
        </small>
      )}
    </span>
  );
}

export function ReplySettings({ analysis }: { analysis: Analysis }) {
  const [bag, setBag] = useState("");
  const [scoreless, setScoreless] = useState("");
  const [finalReply, setFinalReply] = useState<boolean>();
  const opponentHasFinalTurn = finalReply ?? analysis.opponentHasFinalTurn;
  const count = bag === "" ? analysis.minimumBag : Number(bag);
  const turns = count || analysis.crossplay ? 0 : Number(scoreless);
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
          if (valid) analysis.setOptions(count, turns, opponentHasFinalTurn);
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
        {count === 0 &&
          (analysis.crossplay ? (
            <label className="endgame-final-turn">
              <input
                type="checkbox"
                checked={opponentHasFinalTurn}
                onChange={(event) => setFinalReply(event.target.checked)}
              />
              Opponent has a final turn
            </label>
          ) : (
            <label>
              {analysis.passesOnly
                ? "Prior consecutive passes"
                : "Prior scoreless turns"}
              <input
                type="number"
                min={0}
                max={analysis.maxScorelessTurns}
                placeholder="0"
                value={scoreless}
                onChange={(event) => setScoreless(event.target.value)}
              />
            </label>
          ))}
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
  rules,
}: {
  result: ReplyDistribution;
  move: Move;
  reference: Move;
  rules: Game["template"];
}) {
  const compare = move.id !== reference.id;
  const max =
    Math.max(...result.buckets, ...result.reference.buckets) / result.count;
  const ceiling = max > 0.5 ? 100 : 50;
  const percent = (count: number) =>
    `${((100 * count) / result.count).toFixed(1)}%`;
  const height = (count: number) =>
    `${(10000 * count) / (ceiling * result.count)}%`;
  const share = (counts: number[]) => counts[3] + counts[4];
  const renderStat = (before: string, after: string, change: number) => (
    <>
      {compare && `${before} → `}
      <span
        className={compare && before !== after ? scoreTone(change) : undefined}
      >
        {after}
      </span>
    </>
  );
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
              result.reference.mean - result.mean,
            )}{" "}
            pts
          </strong>
        </span>
        <span>
          40+ reply{" "}
          <strong>
            {renderStat(
              percent(share(result.reference.buckets)),
              percent(share(result.buckets)),
              share(result.reference.buckets) - share(result.buckets),
            )}
          </strong>
        </span>
        <span title={`Share of checked racks with a best reply above ${move.score} points`}>
          Chance they outscore this play{" "}
          <strong>{percent(result.outscored)}</strong>
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
      <div className="reply-chart-meta">
        <p className="reply-chart-key">
          {compare && (
            <span>
              <i />
              Reference · After <MoveWord move={reference} rules={rules} />
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
      </div>
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
  const totals = scoreTotalsAtPosition(game);
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
  const scorePair = (you: number, opponent: number) => `${you}–${opponent}`;
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
      <h4 className={scoreTone(scores?.margin)}>{leadLabel}</h4>
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
            <dd className={scoreTone(afterMargin)}>
              {scorePair(scores.after.you, scores.after.opponent)}
            </dd>
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
              <MoveWord move={move} rules={game.template} /> ·{" "}
              <span className={scoreTone(move.score)}>{move.score} pts</span>
            </dd>
          </div>
        ) : ends === "scoreless" && !reply ? (
          <div>
            <dt>{analysis.passesOnly ? "Pass limit" : "Scoreless turn limit"}</dt>
            <dd>Game ends</dd>
          </div>
        ) : ends === "final-turns" && !analysis.opponentHasFinalTurn ? (
          <div>
            <dt>Your final turn</dt>
            <dd>Game ends</dd>
          </div>
        ) : (
          <div>
            <dt>
              {ends === "final-turns"
                ? "Their final turn"
                : ends === "opponent"
                  ? "They go out"
                  : "Strongest immediate reply"}
            </dt>
            <dd>
              {reply ? (
                <>
                  <MoveWord move={reply} rules={game.template} /> ·{" "}
                  <span className={scoreTone(-reply.score)}>
                    {reply.score} pts
                  </span>{" "}
                  ·{" "}
                  {coordinate(
                    reply.row * game.template.size + reply.col,
                    game.template.size,
                  )}
                  {reply.direction === "across" ? "→" : "↓"}
                </>
              ) : (
                "Pass"
              )}
            </dd>
          </div>
        )}
        {highest && highest.id !== reply?.id && (
          <div>
            <dt>Highest raw reply score</dt>
            <dd>
              <MoveWord move={highest} rules={game.template} /> ·{" "}
              <span className={scoreTone(-highest.score)}>
                {highest.score} pts
              </span>
            </dd>
          </div>
        )}
        {result.difference !== null && analysis.reference && (
          <div>
            <dt>
              Raw reply vs.{" "}
              <MoveWord move={analysis.reference} rules={game.template} />
            </dt>
            <dd className={scoreTone(-result.difference)}>
              {signedPoints(result.difference)} pts
            </dd>
          </div>
        )}
        {ends && ends !== "final-turns" && (
          <div>
            <dt>Unplayed tiles</dt>
            <dd>
              You{" "}
              <span className={scoreTone(result.yourAdjustment)}>
                {signedPoints(result.yourAdjustment)}
              </span>{" "}
              · Opponent{" "}
              <span className={scoreTone(-result.opponentAdjustment)}>
                {signedPoints(result.opponentAdjustment)}
              </span>
            </dd>
          </div>
        )}
        {scores && (
          <div>
            <dt>{ends ? "Final score" : "After their reply"}</dt>
            <dd className={scoreTone(scores.margin)}>
              {scorePair(scores.you, scores.opponent)}
            </dd>
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
      {!ends && (
        <div className="reply-line">
          <button
            className="button secondary"
            type="button"
            disabled={line?.pending}
            onClick={() => analysis.requestDetail(move, { kind: "reply-line" })}
          >
            {line?.pending ? (
              <>
                <LoaderCircle size={14} className="spin" /> Checking endgame…
              </>
            ) : (
              "Calculate optimal endgame line"
            )}
          </button>
          {line?.error && <p role="status">{line.error}</p>}
        </div>
      )}
    </div>
  );
}

export function ReplyPreview({
  game,
  move,
  result,
  defense,
  analysis,
  onHeatmap,
}: {
  game: Game;
  move: Move;
  result: ReplyResult;
  defense?: MoveDefense;
  analysis: Analysis;
  onHeatmap: () => void;
}) {
  if (result.kind === "empty-bag")
    return (
      <ExactReplyDetails
        game={game}
        move={move}
        result={result}
        analysis={analysis}
      />
    );
  const detail =
    analysis.detail?.key === `reply-detail:${move.id}`
      ? analysis.detail
      : undefined;
  const distribution =
    detail?.result?.kind === "distribution" ? detail.result : result;
  const warning = detail?.limit
    ? replyLimitMessage(detail.limit, game.template.size, REPLY_DETAIL_TIME_MS)
    : detail?.error;
  if (!analysis.reference) return null;
  return (
    <>
      <DistributionChart
        result={distribution}
        move={move}
        reference={analysis.reference}
        rules={game.template}
      />
      <div className="inline-reply-actions">
        <button
          type="button"
          className="button secondary reply-refine"
          onClick={onHeatmap}
        >
          Heatmap
        </button>
        {!distribution.exact && distribution.count < REPLY_REFINED_SAMPLES && (
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
            {detail?.pending ? "Refining replies…" : "Refine to 5,000 racks"}
          </button>
        )}
      </div>
      {defense && (
        <PremiumReplyNote
          game={game}
          defense={defense}
          opponentRackSize={analysis.unseen - analysis.bagSize}
        />
      )}
      {warning && <p role="status">{warning}</p>}
    </>
  );
}

export default function ReplyHeatmapDialog({
  game,
  move,
  result,
  reference,
  pending,
  error,
  limit,
  onClose,
  onRetry,
}: {
  game: Game;
  move: Move;
  result: ReplyDistribution;
  reference: Move;
  pending?: boolean;
  error?: string;
  limit?: ReplySearchLimit;
  onClose: () => void;
  onRetry: () => void;
}) {
  const warning = limit
    ? replyLimitMessage(limit, game.template.size, REPLY_DETAIL_TIME_MS)
    : error;
  return (
    <Modal
      title={
        <>
          Reply heatmap after <MoveWord move={move} rules={game.template} />
        </>
      }
      onClose={onClose}
    >
      {result.heatmap ? (
        <ReplyHeatmap
          game={game}
          move={move}
          result={result}
          reference={reference}
        />
      ) : pending ? (
        <p role="status">Checking heatmap squares…</p>
      ) : (
        <>
          {warning && <p role="status">{warning}</p>}
          <button type="button" className="button secondary" onClick={onRetry}>
            Retry heatmap
          </button>
        </>
      )}
    </Modal>
  );
}
