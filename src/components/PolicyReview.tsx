import { useEffect } from "react";
import type { Player } from "../../shared/model";
import {
  OPPONENT_POLICY_LABELS,
  opponentShortlistStatus,
  type OpponentPolicyInput,
  type OpponentPolicyResult,
  type PolicyProbabilities,
} from "../../shared/opponent-policy";
import { SHORTLIST_SAMPLE_CHECKPOINTS } from "../../shared/shortlist-confidence";
import { usePractice } from "./usePractice";

function describeRack(
  rack: Extract<OpponentPolicyResult, { rack: unknown }>["rack"],
  player: Player,
) {
  const observer = player === "you" ? "the opponent’s" : "your";
  if (rack.source === "exact")
    return `${player === "you" ? "Your exact rack" : "Exact opponent rack"} ${rack.opponentRack || "(empty)"} inferred from the board and ${observer} recorded rack ${rack.observerRack}.`;
  const draw = `${rack.rackSize} of ${rack.unseen} unseen tiles drawn without replacement.`;
  return rack.source === "observer"
    ? `Board and ${observer} recorded rack ${rack.observerRack} excluded. ${draw}`
    : `Board-only prior. ${player === "you" ? "The opponent’s" : "Your"} rack at this turn is unknown. ${draw}`;
}

function displayProbability(value: number, exact: boolean) {
  if (value === 0) return exact ? "0% (exact)" : "0 sample matches";
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumSignificantDigits: 3,
  }).format(value);
}

function PolicyEstimates({
  result,
  probabilities,
}: {
  result: Extract<OpponentPolicyResult, { probabilities: PolicyProbabilities }>;
  probabilities: PolicyProbabilities;
}) {
  return (
    <dl className="policy-fit-values">
      {(
        Object.keys(OPPONENT_POLICY_LABELS) as (keyof PolicyProbabilities)[]
      ).map((policy) => (
        <div key={policy}>
          <dt>{OPPONENT_POLICY_LABELS[policy]}</dt>
          <dd>
            {displayProbability(
              probabilities[policy],
              result.kind === "exact" ||
                !!result.topFiveRuledOut ||
                (policy === "topOne" && !!result.higherScoringPlacement),
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const boundPercent = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

function displayRange({ lower, upper }: { lower: number; upper: number }) {
  return `${boundPercent.format(Math.floor(lower * 1000) / 1000)}–${boundPercent.format(Math.ceil(upper * 1000) / 1000)}`;
}

export default function PolicyReview({
  player,
  input,
  dictionaryId,
  analysisKey,
  savedResult,
  saveResult,
  queued,
}: {
  player: Player;
  input?: OpponentPolicyInput;
  dictionaryId: string;
  analysisKey: string;
  savedResult?: OpponentPolicyResult;
  saveResult: (key: string, result: OpponentPolicyResult) => void;
  queued: boolean;
}) {
  const { result, error, progress, run, reset } =
    usePractice<OpponentPolicyResult>();
  const displayed = savedResult ?? result;
  useEffect(() => {
    if (result) saveResult(analysisKey, result);
  }, [analysisKey, result, saveResult]);

  const unavailable = !input
    ? "No saved placement. Policy fit requires a board before the move and the tiles played."
    : !input.position.tiles.length
      ? "Policy fit is available for tile placements only."
      : displayed?.kind === "unavailable"
        ? displayed.reason
        : undefined;
  const finding = displayed?.higherScoringPlacement;
  const refine = displayed?.limited;
  const borderline = opponentShortlistStatus(displayed) === "borderline";
  const waiting = queued && !displayed && !!input;
  const title = player === "you" ? "Your policy fit" : "Opponent policy fit";

  return (
    <section className="policy-fit practice-body" aria-label={title}>
      <h3>{title}</h3>
      {player === "you" && (
        <p>
          Opponent’s view. Estimates use the board and the tiles you played.
        </p>
      )}
      {waiting && <p role="status">Queued in timeline analysis.</p>}
      {input &&
        !waiting &&
        !progress &&
        ((!unavailable && !displayed) || refine) && (
          <button
            className="button secondary"
            onClick={() =>
              run({ kind: "opponent-policy", dictionaryId, input })
            }
          >
            {refine ? "Retry with more time" : "Analyze policy fit"}
          </button>
        )}
      {progress && (
        <>
          <p role="status">Checking compatible racks…</p>
          <button className="button secondary" onClick={reset}>
            Cancel policy analysis
          </button>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {unavailable && <p>Unavailable. {unavailable}</p>}
      {displayed && displayed.kind !== "unavailable" && (
        <>
          <p>
            {displayed.kind === "exact"
              ? "Exact calculation. "
              : `Estimated from ${displayed.samples.toLocaleString()} completed rack samples that could supply the played tiles. `}
            {displayed.limited && "The search limit was reached. "}
            {describeRack(displayed.rack, player)}
          </p>
          {displayed.shortlist ? (
            <p>
              Top 5 fit{" "}
              <strong>
                {displayProbability(
                  displayed.shortlist.fit,
                  displayed.kind === "exact" || !!displayed.topFiveRuledOut,
                )}
              </strong>
              {" · "}Random placement{" "}
              <strong>
                {displayProbability(
                  displayed.shortlist.random,
                  displayed.kind === "exact",
                )}
              </strong>
            </p>
          ) : (
            <p>
              No possible rack could supply the recorded tiles under these
              assumptions.
            </p>
          )}
          {displayed.confidence ? (
            <p>
              {borderline && <strong>Borderline. </strong>}
              95% sampling ranges at{" "}
              {displayed.confidence.samples.toLocaleString()} rack samples. Top
              5 fit {displayRange(displayed.confidence.fit)} · Random{" "}
              {displayRange(displayed.confidence.random)}.
            </p>
          ) : (
            borderline && (
              <p>
                <strong>Borderline. </strong>
                The first confidence check needs{" "}
                {SHORTLIST_SAMPLE_CHECKPOINTS[0]} samples.
              </p>
            )
          )}
          {displayed.conditionalProbabilities && (
            <>
              <p>
                Chance each policy would choose this exact placement on a rack
                that could supply the played tiles.
              </p>
              <PolicyEstimates
                result={displayed}
                probabilities={displayed.conditionalProbabilities}
              />
            </>
          )}
          <details className="policy-fit-raw">
            <summary>Raw policy estimates</summary>
            <p>
              Chance each policy would choose this exact placement across all
              possible racks. The chance of holding the played tiles is{" "}
              {displayProbability(displayed.compatibleRackChance, true)}.
            </p>
            <PolicyEstimates
              result={displayed}
              probabilities={displayed.probabilities}
            />
          </details>
        </>
      )}
      {displayed?.topFiveRuledOut && (
        <p>
          Top 5 by points is ruled out. The played tiles alone allow at least
          five higher-scoring placements.
        </p>
      )}
      {finding && (
        <p>
          Top 1 by points is ruled out. The same tiles could play{" "}
          <strong>
            {finding.word} for {finding.score} points
          </strong>{" "}
          instead of {displayed.playedScore}.
        </p>
      )}
    </section>
  );
}
