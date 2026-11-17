import type { Player } from "../../shared/model";
import {
  opponentShortlistStatus,
  type OpponentPolicyResult,
} from "../../shared/opponent-policy";
import {
  SHORTLIST_FIT_THRESHOLD,
  SHORTLIST_RANDOM_THRESHOLD,
} from "../../shared/shortlist-confidence";
import MoveWord from "./MoveWord";
import type { usePolicyTimeline } from "./usePolicyTimeline";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

function percent(value: number) {
  return value > 0 && value < 0.001 ? "<0.1%" : percentFormatter.format(value);
}

function fitText(result: OpponentPolicyResult) {
  if (result.kind === "unavailable")
    return result.limited ? "Search limit" : "Unavailable";
  if (!result.shortlist) return "Rack conflict";
  const { fit } = result.shortlist;
  if (fit === 0 && result.kind === "sampled") return "0 sample matches";
  return `${result.kind === "sampled" ? "≈" : ""}${percent(fit)}`;
}

export default function PolicyTimeline({
  timeline,
  onSelect,
  onPlayerChange,
}: {
  timeline: ReturnType<typeof usePolicyTimeline>;
  onSelect: (index: number) => void;
  onPlayerChange: (player: Player) => void;
}) {
  const {
    player,
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
  const high = turns.filter(
    ({ key }) => opponentShortlistStatus(results[key]?.result) === "high",
  ).length;
  return (
    <section
      className="policy-fit practice-body"
      aria-labelledby="policy-timeline-heading"
    >
      <h3 id="policy-timeline-heading">Policy timeline</h3>
      <div
        className="policy-timeline-controls"
        role="group"
        aria-label="Policy timeline player"
      >
        {(
          [
            ["opponent", "Opponent plays"],
            ["you", "Your plays"],
          ] as const
        ).map(([side, label]) => (
          <button
            key={side}
            type="button"
            className={`button ${player === side ? "primary" : "secondary"}`}
            aria-pressed={player === side}
            onClick={() => onPlayerChange(side)}
          >
            {label}
          </button>
        ))}
      </div>
      {player === "you" && (
        <p>
          Opponent’s view. Estimates use the board and the tiles you played.
        </p>
      )}
      <p>
        Top 5 fit measures how often the played move makes the scoring shortlist
        on racks that could supply its tiles. The random column shows what share
        of legal placements make that shortlist.
      </p>
      <p>
        Highlights require at least {percent(SHORTLIST_FIT_THRESHOLD)} fit and
        at most {percent(SHORTLIST_RANDOM_THRESHOLD)} Random. Borderline means
        the sampled ranges still leave a highlight in question.
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
                : player === "you"
                  ? "Analyze all your turns"
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
      {turns.length === 0 ? (
        <p>
          {player === "you"
            ? "You have no recorded plays."
            : "The opponent has no recorded plays."}
        </p>
      ) : (
        <table
          className="policy-timeline-table"
          aria-label={
            player === "you" ? "Your moves by turn" : "Opponent moves by turn"
          }
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
              const result = results[key]?.result;
              const status = opponentShortlistStatus(result);
              const highlight = status === "high";
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
                      {index + 1} · <MoveWord word={move.word} bingo={bingo} position={input?.position} size={input?.template.size} />
                    </button>
                  </th>
                  <td>{move.score}</td>
                  <td>
                    <span>{fit}</span>
                    {highlight && <strong>High fit</strong>}
                    {status === "borderline" && <small>Borderline</small>}
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
      )}
    </section>
  );
}
