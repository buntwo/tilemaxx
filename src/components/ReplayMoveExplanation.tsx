import { isBingo, type BoardTemplate, type TurnPosition } from "../../shared/model";
import { moveLocation, moveNotation } from "../../shared/notation";
import { PLAYER_PROFILE_LABELS } from "../../shared/player-profiles";
import { isSimulatedStyle, SIMULATED_STYLE_LABELS } from "../../shared/simulated-styles";
import { STYLE_FACTORS, type StyleCandidate, type StyleEvaluation, type StyleExplanation } from "../../shared/style-explanation";
import { scoreTone } from "../score-tone";
import { formatStyleWeight, formatUtility } from "./MoveScoreTooltip";
import MoveWord from "./MoveWord";

function points(value: number) {
  return `${formatUtility(value)} ${value === 1 ? "point" : "points"}`;
}

function styleLabel({ style }: StyleExplanation) {
  return isSimulatedStyle(style) ? SIMULATED_STYLE_LABELS[style] : PLAYER_PROFILE_LABELS[style];
}

function explain(explanation: StyleExplanation, word: (candidate: StyleCandidate) => string) {
  const style = styleLabel(explanation);
  const alternative = explanation.alternative;
  if (explanation.kind === "exchange") {
    const trade = `Exchange ${explanation.tiles}`;
    if (!alternative) return `${trade} because ${style} spotted no playable move.`;
    if (explanation.edge !== undefined) {
      return `${trade} for an estimated ${points(explanation.edge)} more than ${word(alternative)} through your next turn.`;
    }
    const reason = {
      balance: "balance the rack", duplicates: "shed duplicates",
      awkward: "shed awkward tiles", leave: "improve the next rack",
    }[explanation.problem];
    return `${trade} to ${reason}. ${style} also considered ${word(alternative)} for ${points(alternative.move.score)}.`;
  }
  if (explanation.kind === "pass")
    return alternative ? `${style} favored passing over ${word(alternative)} for ${points(alternative.move.score)}.`
      : `${style} favored passing among the actions it checked.`;

  const { played, preferred, recommended } = explanation;
  if (preferred) return `You played ${word(played)} for ${points(played.move.score)}. ${style} recommended ${preferred === "pass" ? "passing" : "an exchange"}.`;
  if (!recommended) return `You chose ${word(played)} for ${points(played.move.score)} from the ${style} suggestions.`;
  const evaluation = played.evaluation;
  if (evaluation.selection === "winning-rack-out")
    return `${word(played)} used the remaining rack. ${style} saw that going out would win after the final rack adjustment.`;
  if (evaluation.selection === "known-rack")
    return `${style} checked both remaining racks and preferred ${word(played)} among the endgame moves it considered.`;
  if (!alternative)
    return `${style} recommended ${word(played)} for ${points(played.move.score)}${played.move.leave ? `, keeping ${played.move.leave}` : ""}.`;

  const other = alternative.evaluation;
  const sacrifice = alternative.move.score - played.move.score;
  const reply = evaluation.modeledReply;
  const otherReply = other.modeledReply;
  const gains: string[] = [];
  const better = (factor: keyof StyleEvaluation["factors"]) =>
    (evaluation.factors[factor] ?? 0) > (other.factors[factor] ?? 0);
  if (better("Rack leave")) gains.push("better rack leave");
  if (better("Premium lane risk")) gains.push("lower premium risk");
  if (reply !== undefined && otherReply !== undefined && otherReply - reply >= 0.01 && sacrifice > 0) {
    return `${word(played)} gave up ${points(sacrifice)} now and cut the modeled reply by ${formatUtility(otherReply - reply)}. ` +
      (gains.length ? `Its ${gains.join(" and ")} helped it come out ahead of ${word(alternative)}.` :
        `${style} preferred it to ${word(alternative)}.`);
  }
  if (evaluation.factors["Visibility weight"] !== undefined && evaluation.samples === undefined &&
    evaluation.factors["Endgame lookahead"] === undefined)
    return `${word(played)} came first in ${style}’s weighted draw. It scored ${points(played.move.score)}${played.move.leave ? ` and kept ${played.move.leave}` : ""}.`;
  const followUp = evaluation.modeledFollowUp;
  const otherFollowUp = other.modeledFollowUp;
  if (followUp !== undefined && otherFollowUp !== undefined && followUp - otherFollowUp >= 0.01)
    return `${word(played)} scored ${points(played.move.score)} and led to a modeled follow-up ${points(followUp - otherFollowUp)} higher than ${word(alternative)}.`;
  const bingoChance = evaluation.factors["Next-turn bingo chance"];
  const otherBingoChance = other.factors["Next-turn bingo chance"];
  if (bingoChance !== undefined && otherBingoChance !== undefined && bingoChance - otherBingoChance >= 0.01)
    return `${word(played)} gave ${style} a ${formatUtility(bingoChance)}% next-turn bingo chance, compared with ${formatUtility(otherBingoChance)}% after ${word(alternative)}.`;
  return `${style} preferred ${word(played)} for ${points(played.move.score)} over ${word(alternative)} for ${points(alternative.move.score)}.`;
}

function explainReanalysis(
  explanation: StyleExplanation,
  availablePlacement: boolean,
  word: (candidate: StyleCandidate) => string,
) {
  if (explanation.kind !== "play") return explain(explanation, word);
  const style = styleLabel(explanation);
  const { preferred, played, alternative, recommended } = explanation;
  if (recommended) return explain(explanation, word);
  const rank = played.evaluation.rank;
  const recorded = !availablePlacement ? "The current word list and rack settings excluded the recorded placement."
    : rank === undefined ? "The recorded placement fell outside this run’s ranking."
    : `This run ranked the recorded ${word(played)} #${rank}.`;
  const result = preferred ? `${style} favored ${preferred === "pass" ? "passing" : "an exchange"} in this run.`
    : alternative ? `${style} ranked ${word(alternative)} first in this run.`
    : `${style} returned no ranked placement in this run.`;
  return `${recorded} ${result}`;
}

function FactorValue({ label, value }: { label: string; value: number }) {
  const weight = label === "Visibility weight" || label === "Appeal multiplier";
  const unit = label === "Next-turn bingo chance" ? "%" : "";
  const prefix = label === "Appeal multiplier" ? "×" : "";
  return <dd className={weight ? undefined : scoreTone(value)}>{prefix}{weight ? formatStyleWeight(value) : formatUtility(value)}{unit}</dd>;
}

function StyleBreakdown({ evaluation, exchangeEdge, word }: { evaluation?: StyleEvaluation; exchangeEdge?: number; word?: string }) {
  const factors = { ...evaluation?.factors, "Expected exchange edge": exchangeEdge };
  const entries = STYLE_FACTORS.flatMap((label) => {
    const value = factors[label];
    return value === undefined ? [] : [{ label, value }];
  });
  if (!entries.length) return null;
  return (
    <details className="replay-style-breakdown">
      <summary>Style breakdown{word && ` · ${word}`}</summary>
      <dl>
        {entries.map(({ label, value }) => (
          <div key={label}><dt>{label}</dt><FactorValue {...{ label, value }} /></div>
        ))}
        {evaluation?.modeledReply !== undefined && evaluation.factors["Expected opponent reply"] === undefined && (
          <div><dt>Modeled opponent reply</dt><dd className={scoreTone(-evaluation.modeledReply)}>{formatUtility(evaluation.modeledReply)}</dd></div>
        )}
        {evaluation?.modeledFollowUp !== undefined && (
          <div><dt>Modeled follow-up</dt><dd className={scoreTone(evaluation.modeledFollowUp)}>{formatUtility(evaluation.modeledFollowUp)}</dd></div>
        )}
        {evaluation?.total !== undefined && (
          <div className="replay-style-total">
            <dt>{evaluation.factors["Visibility weight"] !== undefined ? "Appeal points" : "Utility"}</dt>
            <dd className={scoreTone(evaluation.total)}>{formatUtility(evaluation.total)}</dd>
          </div>
        )}
      </dl>
    </details>
  );
}

export default function ReplayMoveExplanation({
  explanation, position, template, canPreview, previewing, onPreview, reanalysis,
}: {
  explanation: StyleExplanation;
  position?: TurnPosition;
  template: BoardTemplate;
  canPreview: boolean;
  previewing: boolean;
  onPreview: () => void;
  reanalysis?: { availablePlacement: boolean; estimatedBag: boolean };
}) {
  const played = explanation.kind === "play" ? explanation.played : undefined;
  const alternative = explanation.alternative;
  const evaluation = played?.evaluation ?? (explanation.kind === "pass" ? explanation.evaluation : undefined);
  const alternativeBreakdown = !!(reanalysis && alternative && !Object.keys(evaluation?.factors ?? {}).length);
  const breakdown = alternativeBreakdown ? alternative?.evaluation : evaluation;
  const notation = (candidate: StyleCandidate) => moveNotation(candidate.move, template.size, position?.board);
  const showReply = [played, alternative].some((candidate) => candidate?.evaluation.modeledReply !== undefined);
  const showUtility = [played, alternative].some((candidate) => candidate?.evaluation.total !== undefined);
  const word = (candidate: StyleCandidate) => (
    <MoveWord word={candidate.move.word} notation={notation(candidate)} bingo={isBingo(template, candidate.move.tiles.length)} />
  );
  const rows = [...(played ? [{ candidate: played, alternative: false }] : []),
    ...(alternative ? [{ candidate: alternative, alternative: true }] : [])];
  return (
    <>
      <p className="replay-explanation-source">
        {styleLabel(explanation)}{reanalysis ? " · Current word list" : explanation.kind === "play" && !explanation.recommended
          ? evaluation?.rank ? ` · You chose rank #${evaluation.rank}` : " · You chose this setup"
          : " recommendation"}
        {reanalysis?.estimatedBag && " · Estimated bag"}
        {explanation.provisional && " · Provisional"}
        {evaluation?.exact ? " · Exact" : evaluation?.samples ? (
          evaluation.followUpSamples === undefined
            ? ` · ${evaluation.samples} samples`
            : ` · ${evaluation.samples} replies${evaluation.followUpSamples ? ` · ${evaluation.followUpSamples} follow-up draws` : ""}`
        ) : ""}
      </p>
      <p>{reanalysis ? explainReanalysis(explanation, reanalysis.availablePlacement, notation) : explain(explanation, notation)}</p>
      {alternative && (
        <table className="replay-style-comparison" aria-label="Move comparison">
          <thead><tr>
            <th scope="col">Placement</th><th scope="col">Score</th>
            {showReply && <th scope="col">Est. reply</th>}
            {showUtility && <th scope="col">{breakdown?.factors["Visibility weight"] !== undefined ? "Appeal" : "Utility"}</th>}
          </tr></thead>
          <tbody>
            {rows.map(({ candidate, alternative }) => {
              const location = `${moveLocation(candidate.move)} ${candidate.move.direction}`;
              return (
                <tr key={alternative ? "alternative" : "played"} data-previewing={alternative && previewing || undefined}>
                  <th scope="row">
                    {alternative ? (
                      <button type="button" className="button secondary replay-preview-alternative"
                        aria-pressed={previewing} disabled={!canPreview} data-move-preview-action
                        aria-label={`Preview alternative ${candidate.move.word} at ${location}`}
                        onClick={onPreview}>
                        {word(candidate)} <small>{location}</small>
                      </button>
                    ) : <>{word(candidate)} <small>{location}</small></>}
                  </th>
                  <td>{candidate.move.score}</td>
                  {showReply && <td>{candidate.evaluation.modeledReply === undefined ? "–" : formatUtility(candidate.evaluation.modeledReply)}</td>}
                  {showUtility && <td>{candidate.evaluation.total === undefined ? "–" : formatUtility(candidate.evaluation.total)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <StyleBreakdown evaluation={breakdown} word={alternativeBreakdown && alternative ? notation(alternative) : undefined}
        exchangeEdge={explanation.kind === "exchange" ? explanation.edge : undefined} />
    </>
  );
}
