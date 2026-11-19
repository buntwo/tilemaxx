import { Repeat2 } from "lucide-react";
import type { ExchangeAdvice } from "../../shared/exchange-advice";
import type { PlayerExchangeAdvice } from "../../shared/player-exchange";
import { PLAYER_PROFILE_LABELS } from "../../shared/player-profiles";
import { scoreTone } from "../score-tone";

export type SwapAdvice = ExchangeAdvice | PlayerExchangeAdvice;

export function exchangeAdviceDetail(advice: SwapAdvice) {
  if (!("profile" in advice))
    return `Estimated +${Math.round(advice.edge)} points vs. ${advice.comparedWith ?? "passing"} through your next turn, including the opponent’s reply`;
  const name = PLAYER_PROFILE_LABELS[advice.profile];
  const move = advice.comparedWith;
  if (!move)
    return `${name} would exchange because it spotted no playable move.`;
  const play = `${move.word} for ${move.score} points`;
  if (advice.edge !== undefined)
    return `${name} estimates +${Math.round(advice.edge)} points through your next turn vs. ${play}, including the opponent’s reply.`;
  const reason = {
    balance: "balance the rack",
    duplicates: "shed duplicates",
    awkward: "shed awkward tiles",
    leave: "improve its next rack",
  }[advice.problem];
  return `${name} would exchange to ${reason}. Its best spotted play is ${play}.`;
}

export default function ExchangeSuggestion({
  advice,
  rack,
  onOpen,
  inHeader = false,
}: {
  advice: SwapAdvice;
  rack: string;
  onOpen: () => void;
  inHeader?: boolean;
}) {
  const tiles = advice.slots.map((slot) => rack[slot]).join("");
  const edge =
    "profile" in advice ? undefined : `+${Math.round(advice.edge)} pts`;
  return (
    <button
      type="button"
      className={
        inHeader
          ? "button results-exchange-advice"
          : "text-button rack-exchange-advice"
      }
      title={exchangeAdviceDetail(advice)}
      aria-label={`Swap ${tiles}${edge ? ` · ${edge}` : ""}`}
      onClick={onOpen}
    >
      <Repeat2 size={13} aria-hidden="true" />
      {inHeader ? (
        <>
          <span className="results-exchange-tiles">
            <span className="results-exchange-verb">Swap </span>
            {tiles}
          </span>
          {edge && (
            <span>
              <span className="results-exchange-separator">· </span>
              <span className={scoreTone(advice.edge ?? 0)}>{edge}</span>
            </span>
          )}
        </>
      ) : (
        <span>
          Swap {tiles}
          {edge && (
            <>
              {" "}
              · <span className={scoreTone(advice.edge ?? 0)}>{edge}</span>
            </>
          )}
        </span>
      )}
    </button>
  );
}
