import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { minimumExchangeBag } from "../../shared/exchange";
import { minimumBingoTiles, type Game } from "../../shared/model";
import {
  EXCHANGE_REPLY_TRIALS,
  type OptimalExchangeResult,
} from "../../shared/optimal-exchange";
import { splitRack } from "../../shared/rack-entry";
import { unseenTiles } from "../../shared/tile-pool";
import type { PracticeRequest } from "../practice.worker";
import { scoreTone } from "../score-tone";
import { exchangePercent } from "./ExchangeAnalysis";
import MiniTiles from "./MiniTiles";
import { usePractice } from "./usePractice";

export default function OptimalExchange({
  game,
  bag,
  assumed,
  scorelessTurns = 0,
  restoredResult,
  onClose,
  onUse,
}: {
  game: Game;
  bag: number;
  assumed: boolean;
  scorelessTurns?: number;
  restoredResult?: OptimalExchangeResult;
  onClose: () => void;
  onUse: (
    swap: OptimalExchangeResult["bestSwaps"][number],
    result: OptimalExchangeResult,
  ) => void;
}) {
  const { rack, board, template, excludedRackSlots, dictionaryId } = game;
  const { available, held } = splitRack(game);
  const { excess } = unseenTiles(game, template);
  const minimum = minimumExchangeBag(template, 1);
  const bingoMinimum = minimumBingoTiles(template);
  const unavailable = excess.length
    ? "Check the board and rack tile counts first."
    : available.length < bingoMinimum
      ? `Optimal exchange needs at least ${bingoMinimum} playable rack tiles for a bingo.`
      : bag < minimum
        ? `An exchange needs at least ${minimum} ${minimum === 1 ? "tile" : "tiles"} in the bag.`
        : "";
  const [request] = useState<PracticeRequest>(() => ({
    kind: "optimal-exchange",
    dictionaryId,
    exchange: { rack, board, template, excludedRackSlots, bag, scorelessTurns },
  }));
  const heading = useRef<HTMLHeadingElement>(null);
  const {
    result: freshResult,
    progress,
    error,
    run,
  } = usePractice<OptimalExchangeResult>();
  const result = restoredResult ?? freshResult;
  useEffect(() => {
    if (restoredResult) heading.current?.focus({ preventScroll: true });
    else if (!unavailable) run(request);
  }, [request, restoredResult, run, unavailable]);
  return (
    <section
      className="rack-simulation practice-body"
      aria-label="Optimal exchange"
    >
      <div className="rack-simulation-heading optimal-exchange-heading">
        <h3 ref={heading} tabIndex={-1}>
          Optimal exchange
        </h3>
        <button type="button" className="text-button" onClick={onClose}>
          {progress ? "Cancel" : "Close"}
        </button>
      </div>
      <p className="small muted">
        {result && !result.refinementDraws
          ? "Bingo chance on the current board"
          : "Bingo chance after the opponent’s turn"}{" "}
        · {bag} {assumed ? "estimated in bag" : "in bag"}
      </p>
      {unavailable && <p className="small muted">{unavailable}</p>}
      {progress && (
        <p role="status">
          {progress.phase
            ? `${progress.completed} / ${progress.total} ${progress.phase === "replies" ? "reply scenarios checked" : "shared draws screened"}`
            : "Preparing exchange search…"}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {result && (
        <>
          <table className="optimal-exchange-options">
            <thead>
              <tr>
                <th scope="col">Swap</th>
                <th scope="col">Leave</th>
                <th scope="col">Bingo chance</th>
                <th scope="col" aria-label="Simulate swap" />
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" title="Bingo available now">
                  Keep your rack
                </th>
                <td>
                  <MiniTiles tiles={available} />
                </td>
                <td className={result.keepBingo ? "value-good" : undefined}>
                  {result.keepBingo ? "100%" : "0%"}
                </td>
                <td />
              </tr>
              {result.bestSwaps.map((option, index) => {
                const tiles = option.slots.map((slot) => rack[slot]);
                const { available: leave } = splitRack({
                  rack,
                  excludedRackSlots: [
                    ...(excludedRackSlots ?? []),
                    ...option.slots,
                  ],
                });
                const chance = exchangePercent.format(option.chance);
                const keepChance = Number(result.keepBingo);
                const tone =
                  option.chance === 1
                    ? "value-good"
                    : chance === exchangePercent.format(keepChance)
                      ? undefined
                      : scoreTone(option.chance - keepChance);
                return (
                  <tr
                    key={option.slots.join(",")}
                    className={
                      index === 0 && option.chance > Number(result.keepBingo)
                        ? "best-swap"
                        : undefined
                    }
                  >
                    <th scope="row">
                      <MiniTiles tiles={tiles.join("")} />
                    </th>
                    <td>
                      {leave ? (
                        <MiniTiles tiles={leave} />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className={tone}>≈{chance}</span>
                      {option.close && <small>Close estimate</small>}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="text-button optimal-exchange-simulate"
                        aria-label={`Simulate exchanging ${tiles
                          .map((tile) => (tile === "?" ? "blank" : tile))
                          .join(", ")}`}
                        onClick={() => onUse(option, result)}
                      >
                        <Play size={12} aria-hidden="true" /> Simulate
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="small muted">
            Keep your rack shows whether you have a bingo to play now.
          </p>
          {held && (
            <p className="small muted">
              Leave shows playable tiles. Held tiles stay on your rack.
            </p>
          )}
          <p className="small muted">
            {result.checked} swaps screened with {result.screeningDraws} shared
            draws.
            {result.refinementDraws > 0 &&
              ` ${result.finalists} finalists compared on ${result.refinementDraws} of ${EXCHANGE_REPLY_TRIALS} reply scenarios.`}
            {!result.refinementDraws &&
              " Reply search reached its limit. Swap odds use the current board."}
          </p>
        </>
      )}
    </section>
  );
}
