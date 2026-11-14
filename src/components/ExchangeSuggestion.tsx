import { Repeat2 } from "lucide-react";
import type { ExchangeAdvice } from "../../shared/exchange-advice";

export function exchangeAdviceDetail({ edge, comparedWith }: ExchangeAdvice) {
  return `Estimated +${Math.round(edge)} points vs. ${comparedWith ?? "passing"} through your next turn, including the opponent’s reply`;
}

export default function ExchangeSuggestion({
  advice,
  rack,
  onOpen,
  inHeader = false,
}: {
  advice: ExchangeAdvice;
  rack: string;
  onOpen: () => void;
  inHeader?: boolean;
}) {
  const tiles = advice.slots.map((slot) => rack[slot]).join("");
  const edge = `+${Math.round(advice.edge)} pts`;
  return (
    <button
      type="button"
      className={
        inHeader
          ? "button results-exchange-advice"
          : "text-button rack-exchange-advice"
      }
      title={exchangeAdviceDetail(advice)}
      aria-label={`Swap ${tiles} · ${edge}`}
      onClick={onOpen}
    >
      <Repeat2 size={13} aria-hidden="true" />
      {inHeader ? (
        <>
          <span className="results-exchange-tiles">
            <span className="results-exchange-verb">Swap </span>
            {tiles}
          </span>
          <span>
            <span className="results-exchange-separator">· </span>
            {edge}
          </span>
        </>
      ) : (
        <span>
          Swap {tiles} · {edge}
        </span>
      )}
    </button>
  );
}
