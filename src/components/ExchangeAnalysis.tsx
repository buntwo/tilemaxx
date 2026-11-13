import { useState } from "react";
import type { Game } from "../../shared/model";
import type { ExchangeResult } from "../../shared/exchange";
import { unseenTiles } from "../../shared/tile-pool";
import { usePractice } from "./usePractice";
import Modal from "./Modal";

export default function ExchangeAnalysis({
  game,
  slots,
  onClose,
}: {
  game: Game;
  slots: number[];
  onClose: () => void;
}) {
  const { total, excess } = unseenTiles(game, game.template);
  const estimated = Math.max(0, total - game.template.rackSize);
  const [bag, setBag] = useState(String(estimated));
  const { result, progress, error, run, reset } = usePractice<ExchangeResult>();
  const minimum = Math.max(
    estimated,
    slots.length,
    game.template.rules === "wwf" ? 1 : 7,
  );
  const valid =
    !excess.length &&
    bag !== "" &&
    Number.isInteger(Number(bag)) &&
    Number(bag) >= minimum &&
    Number(bag) <= total;
  return (
    <Modal
      title="Simulate exchange"
      subtitle={`Exchange ${slots.map((i) => game.rack[i]).join(" ")}`}
      onClose={onClose}
    >
      <div className="practice-body">
        <p>
          The exchange scores 0. This estimates your best next play on the
          unchanged board, before any opponent reply. Draws use the unseen pool
          and exclude the tiles you return.
        </p>
        <label>
          Tiles in bag
          <input
            type="number"
            min={estimated}
            max={total}
            value={bag}
            disabled={!!progress}
            onChange={(event) => {
              setBag(event.target.value);
              reset();
            }}
          />
        </label>
        {!!excess.length && (
          <p className="error">Check the board and rack tile counts first.</p>
        )}
        {!excess.length && !valid && (
          <p className="small muted">
            This exchange requires at least {minimum} tiles in the bag for this
            position.
          </p>
        )}
        {progress ? (
          <button className="button secondary" onClick={reset}>
            Cancel simulation
          </button>
        ) : (
          <button
            className="button primary"
            disabled={!valid}
            onClick={() =>
              run({
                kind: "exchange",
                dictionaryId: game.dictionaryId,
                exchange: {
                  board: game.board,
                  rack: game.rack,
                  slots,
                  bag: Number(bag),
                  template: game.template,
                },
              })
            }
          >
            Run simulation
          </button>
        )}
        {progress && (
          <p role="status">
            {progress.total
              ? `${progress.completed} / ${progress.total} refills checked`
              : "Preparing simulation…"}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <div aria-label="Exchange results">
            <p>
              <strong>{result.score.toFixed(1)} pts</strong> expected best score
              · <strong>{Math.round(result.bingo * 100)}%</strong> bingo chance
              · <strong>{Math.round(result.playable * 100)}%</strong> chance of
              a play
            </p>
            <p className="small muted">
              {result.exact
                ? "Exact weighted draws"
                : `${result.completed} of ${result.total} sampled refills`}
            </p>
            {!!result.examples.length && (
              <ul className="practice-results">
                {result.examples.map((example) => (
                  <li key={`${example.word}:${example.bingo}`}>
                    <strong>{example.word}</strong>
                    {example.bingo && " · Bingo"} · {example.score} pts{" "}
                    <small>with {example.rack}</small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
