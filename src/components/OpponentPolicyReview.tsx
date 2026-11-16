import { useEffect } from "react";
import {
  OPPONENT_POLICY_LABELS,
  type OpponentPolicyInput,
  type OpponentPolicyResult,
  type PolicyProbabilities,
} from "../../shared/opponent-policy";
import { usePractice } from "./usePractice";

function describeRack(
  rack: Extract<OpponentPolicyResult, { rack: unknown }>["rack"],
) {
  if (rack.source === "exact")
    return `Exact opponent rack ${rack.opponentRack || "(empty)"} inferred from the board and your recorded rack ${rack.observerRack}. The remaining tiles fit on the opponent’s rack.`;
  const draw = `${rack.rackSize} of ${rack.unseen} unseen tiles drawn without replacement.`;
  return rack.source === "observer"
    ? `Board and your recorded rack ${rack.observerRack} excluded. ${draw}`
    : `Board-only prior. Your rack at this turn is unknown. ${draw}`;
}

function displayProbability(value: number, exact: boolean) {
  if (value === 0) return exact ? "0% (exact)" : "0 sample matches";
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumSignificantDigits: 3,
  }).format(value);
}

export default function OpponentPolicyReview({
  input,
  dictionaryId,
  analysisKey,
  savedResult,
  saveResult,
  queued,
}: {
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
  const refine =
    displayed?.kind === "unavailable"
      ? displayed.limited
      : displayed?.kind === "sampled" &&
        displayed.samples < displayed.sampleTarget;
  const waiting = queued && !displayed && !!input;

  return (
    <section
      className="policy-fit practice-body"
      aria-label="Opponent policy fit"
    >
      <h3>Opponent policy fit</h3>
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
          <p role="status">Checking possible opponent racks…</p>
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
            {displayed.kind === "sampled" &&
              displayed.samples < displayed.sampleTarget &&
              "The search limit was reached. "}
            {describeRack(displayed.rack)}
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
          <p>
            Chance each policy would choose this exact placement under the rack
            assumptions shown.
          </p>
          <dl className="policy-fit-values">
            {(
              Object.keys(
                OPPONENT_POLICY_LABELS,
              ) as (keyof PolicyProbabilities)[]
            ).map((policy) => (
              <div key={policy}>
                <dt>{OPPONENT_POLICY_LABELS[policy]}</dt>
                <dd>
                  {displayProbability(
                    displayed.probabilities[policy],
                    displayed.kind === "exact" ||
                      !!displayed.topFiveRuledOut ||
                      (policy === "topOne" && !!finding),
                  )}
                </dd>
              </div>
            ))}
          </dl>
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
