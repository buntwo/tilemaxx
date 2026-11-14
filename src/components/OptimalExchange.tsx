import { useEffect, useState } from "react";
import { minimumExchangeBag } from "../../shared/exchange";
import type { Game } from "../../shared/model";
import type { OptimalExchangeResult } from "../../shared/optimal-exchange";
import { splitRack } from "../../shared/rack-entry";
import { unseenTiles } from "../../shared/tile-pool";
import type { PracticeRequest } from "../practice.worker";
import { exchangePercent, MiniTiles } from "./ExchangeAnalysis";
import { usePractice } from "./usePractice";

export default function OptimalExchange({
  game,
  bag,
  assumed,
  onClose,
  onUse,
}: {
  game: Game;
  bag: number;
  assumed: boolean;
  onClose: () => void;
  onUse: (slots: number[]) => void;
}) {
  const { rack, board, template, excludedRackSlots, dictionaryId } = game;
  const { available } = splitRack(game);
  const { excess } = unseenTiles(game, template);
  const minimum = minimumExchangeBag(template, 1);
  const unavailable = excess.length
    ? "Check the board and rack tile counts first."
    : !available
      ? "Enter at least one tile that is not held."
      : bag < minimum
        ? `An exchange needs at least ${minimum} ${minimum === 1 ? "tile" : "tiles"} in the bag.`
        : "";
  const [request] = useState<PracticeRequest>(() => ({
    kind: "optimal-exchange",
    dictionaryId,
    exchange: { rack, board, template, excludedRackSlots, bag },
  }));
  const { result, progress, error, run } = usePractice<OptimalExchangeResult>();
  useEffect(() => {
    if (!unavailable) run(request);
  }, [request, run, unavailable]);
  const best = result?.bestBySize.reduce((leader, option) =>
    option.chance > leader.chance ? option : leader,
  );
  return (
    <section
      className="rack-simulation practice-body"
      aria-label="Optimal Exchange"
    >
      <div className="rack-simulation-heading optimal-exchange-heading">
        <h3>Optimal Exchange</h3>
        <button type="button" className="text-button" onClick={onClose}>
          {progress ? "Cancel" : "Close"}
        </button>
      </div>
      <p className="small muted">
        Bingo chance on the current board · {bag}{" "}
        {assumed ? "estimated in bag" : "in bag"}
      </p>
      {unavailable && <p className="small muted">{unavailable}</p>}
      {progress && (
        <p role="status">
          {progress.completed
            ? `${progress.completed} shared draws checked`
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
                <th scope="col">Bingo chance</th>
                <th scope="col" aria-label="Use swap" />
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Keep your rack</th>
                <td>{result.keepBingo ? "100%" : "0%"}</td>
                <td />
              </tr>
              {result.bestBySize.map((option) => (
                <tr
                  key={option.slots.length}
                  className={
                    option === best && option.chance > Number(result.keepBingo)
                      ? "best-swap"
                      : undefined
                  }
                >
                  <th scope="row">
                    <span className="optimal-exchange-swap">
                      {option.slots.length}
                      <MiniTiles
                        tiles={option.slots.map((slot) => rack[slot]).join("")}
                      />
                    </span>
                  </th>
                  <td>
                    ≈{exchangePercent.format(option.chance)}
                    {option.close && <small>Close estimate</small>}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="text-button"
                      aria-label={`Mark ${option.slots.length} ${option.slots.length === 1 ? "tile" : "tiles"} for exchange`}
                      onClick={() => onUse(option.slots)}
                    >
                      Mark
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">
            {result.checked} swaps screened with {result.screeningDraws} shared
            draws.
            {result.refinementDraws > 0 &&
              ` Finalists compared on ${result.refinementDraws} fresh draws.`}
          </p>
        </>
      )}
    </section>
  );
}
