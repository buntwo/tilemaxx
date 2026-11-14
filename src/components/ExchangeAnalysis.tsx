import { Trophy } from "lucide-react";
import type { Game } from "../../shared/model";
import type { ExchangeResult } from "../../shared/exchange";
import { unseenTiles } from "../../shared/tile-pool";
import { usePractice } from "./usePractice";

export default function ExchangeAnalysis({
  game,
  slots,
}: {
  game: Game;
  slots: number[];
}) {
  const { total, excess } = unseenTiles(game, game.template);
  const bag = Math.max(0, total - game.template.rackSize);
  const { result, progress, error, run, reset } = usePractice<ExchangeResult>();
  const minimum = Math.max(slots.length, game.template.rules === "wwf" ? 1 : 7);
  const valid = !excess.length && bag >= minimum;
  return (
    <section
      className="rack-simulation practice-body"
      aria-label="Simulate exchange"
    >
      <div className="rack-simulation-heading">
        <h3>
          Exchange {slots.length} {slots.length === 1 ? "tile" : "tiles"}
        </h3>
        <span className="rack-exchange-letters">
          {slots.map((i) => (
            <span key={i}>{game.rack[i]}</span>
          ))}
        </span>
        <span
          className="rack-simulation-bag"
          title="Assumes one opponent has up to a full rack"
        >
          {bag} estimated in bag
        </span>
      </div>
      {!!excess.length && (
        <p className="error">Check the board and rack tile counts first.</p>
      )}
      {!excess.length && !valid && (
        <p className="small muted">
          This exchange needs at least {minimum} tiles in the bag.
        </p>
      )}
      <div className="rack-simulation-actions">
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
                  bag,
                  template: game.template,
                },
              })
            }
          >
            {result ? "Run again" : "Run simulation"}
          </button>
        )}
      </div>
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
          <dl className="rack-simulation-stats">
            <div>
              <dt>Expected best score</dt>
              <dd>{result.score.toFixed(1)} pts</dd>
            </div>
            <div>
              <dt>Bingo chance</dt>
              <dd>{Math.round(result.bingo * 100)}%</dd>
            </div>
            <div>
              <dt>Chance of a play</dt>
              <dd>{Math.round(result.playable * 100)}%</dd>
            </div>
          </dl>
          <p className="small muted">
            {result.exact
              ? "Exact weighted draws"
              : `${result.completed} of ${result.total} sampled refills`}
          </p>
          {!!result.examples.length && (
            <ul className="practice-results exchange-examples">
              {result.examples.map((example) => (
                <li key={`${example.word}:${example.bingo}`}>
                  <div className="exchange-example-play">
                    <strong
                      className={
                        example.bingo ? "exchange-bingo-word" : undefined
                      }
                    >
                      {example.word}
                    </strong>
                    {example.bingo && (
                      <span className="bingo-badge">
                        <Trophy size={10} aria-hidden="true" />
                        BINGO
                      </span>
                    )}
                    <span className="exchange-example-score">
                      {example.score} pts
                    </span>
                  </div>
                  <small>with {example.rack}</small>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
