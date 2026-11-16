import type { OpponentPolicyResult } from "../../shared/opponent-policy";
import MoveWord from "./MoveWord";
import type { useOpponentPolicyTimeline } from "./useOpponentPolicyTimeline";

const HIGH_FIT = 0.8;
const LOW_RANDOM_FIT = 0.25;
const MIN_HIGHLIGHT_SAMPLES = 64;
const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

function percent(value: number) {
  return value > 0 && value < 0.001 ? "<0.1%" : percentFormatter.format(value);
}

function highFit(result: OpponentPolicyResult | undefined) {
  if (!result || result.kind === "unavailable" || !result.shortlist)
    return false;
  return (
    (result.kind === "exact" || result.samples >= MIN_HIGHLIGHT_SAMPLES) &&
    result.shortlist.fit >= HIGH_FIT &&
    result.shortlist.random <= LOW_RANDOM_FIT
  );
}

function fitText(result: OpponentPolicyResult) {
  if (result.kind === "unavailable")
    return result.limited ? "Search limit" : "Unavailable";
  if (!result.shortlist) return "Rack conflict";
  const { fit } = result.shortlist;
  if (fit === 0 && result.kind === "sampled") return "0 sample matches";
  return `${result.kind === "sampled" ? "≈" : ""}${percent(fit)}`;
}

export default function OpponentPolicyTimeline({
  timeline,
  onSelect,
}: {
  timeline: ReturnType<typeof useOpponentPolicyTimeline>;
  onSelect: (index: number) => void;
}) {
  const {
    turns,
    results,
    progress,
    error,
    remaining,
    reachedTimeLimit,
    analyze,
    cancel,
  } = timeline;
  const checked = turns.filter(({ key }) => results[key]).length;
  const high = turns.filter(({ key }) => highFit(results[key])).length;
  return (
    <section
      className="policy-fit practice-body"
      aria-labelledby="opponent-policy-timeline-heading"
    >
      <h3 id="opponent-policy-timeline-heading">Opponent policy timeline</h3>
      <p>
        Top 5 fit measures how often the played move makes the scoring shortlist
        on racks that could supply its tiles. The random column shows what share
        of legal placements make that shortlist.
      </p>
      <p>
        Highlights mark at least 80% fit when the shortlist covers at most 25%
        of legal placements. Use them to spot stretches worth reviewing.
      </p>
      {progress ? (
        <div className="policy-timeline-controls">
          <p role="status">
            {progress.total
              ? `Checked ${progress.completed} of ${progress.total} turns in this batch.`
              : "Loading word list…"}
          </p>
          <button className="button secondary" onClick={cancel}>
            Cancel timeline analysis
          </button>
        </div>
      ) : (
        <div className="policy-timeline-controls">
          {remaining > 0 && (
            <button className="button primary" onClick={analyze}>
              {checked > 0
                ? "Analyze remaining turns"
                : "Analyze all opponent turns"}
            </button>
          )}
          {checked > 0 && (
            <p role="status">
              {high} high-fit {high === 1 ? "turn" : "turns"} · {checked}{" "}
              checked
            </p>
          )}
        </div>
      )}
      {reachedTimeLimit && remaining > 0 && (
        <p role="status">Batch time limit reached. {remaining} turns remain.</p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <table
        className="policy-timeline-table"
        aria-label="Opponent moves by turn"
      >
        <thead>
          <tr>
            <th scope="col">Move</th>
            <th scope="col">Pts</th>
            <th scope="col">Top 5 fit</th>
            <th scope="col">Random</th>
          </tr>
        </thead>
        <tbody>
          {turns.map(({ key, move, index, input, bingo }) => {
            const result = results[key];
            const highlight = highFit(result);
            const shortlist =
              result && result.kind !== "unavailable"
                ? result.shortlist
                : undefined;
            const ruledOut =
              !!result?.topFiveRuledOut ||
              (result?.kind === "exact" && shortlist?.fit === 0);
            const fit = ruledOut
              ? "0% exact"
              : result
                ? fitText(result)
                : !input
                  ? "No saved placement"
                  : progress
                    ? "Queued"
                    : "Pending";
            return (
              <tr
                key={key}
                className={highlight ? "policy-timeline-high-fit" : undefined}
              >
                <th scope="row">
                  <button
                    className="score-review-link"
                    data-policy-turn={index}
                    onClick={() => onSelect(index)}
                  >
                    {index + 1} · <MoveWord word={move.word} bingo={bingo} />
                  </button>
                </th>
                <td>{move.score}</td>
                <td>
                  <span>{fit}</span>
                  {highlight && <strong>High fit</strong>}
                  {result?.kind === "sampled" &&
                    result.samples < MIN_HIGHLIGHT_SAMPLES && (
                      <small>{result.samples} samples</small>
                    )}
                </td>
                <td>
                  {shortlist
                    ? `${result?.kind === "sampled" ? "≈" : ""}${percent(shortlist.random)}`
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
