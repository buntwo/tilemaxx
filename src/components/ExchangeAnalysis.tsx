import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import type { Game } from "../../shared/model";
import { minimumExchangeBag, type ExchangeResult } from "../../shared/exchange";
import { unseenTiles } from "../../shared/tile-pool";
import { usePractice } from "./usePractice";

const exchangePercent = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 1,
});

function MiniTiles({ tiles }: { tiles: string }) {
  return (
    <span className="rack-exchange-letters">
      {[...tiles].map((tile, i) => (
        <span
          key={i}
          className={tile === "?" ? "blank" : undefined}
          role={tile === "?" ? "img" : undefined}
          aria-label={tile === "?" ? "Blank tile" : undefined}
        >
          {tile === "?" ? "" : tile}
        </span>
      ))}
    </span>
  );
}

function DrawOptions({
  draws,
}: {
  draws: ExchangeResult["examples"][number]["draws"];
}) {
  const showScores = draws.some(({ score }) => score !== draws[0].score);
  return (
    <div className="exchange-draw-options">
      {draws.map(({ tiles, score }, i) => (
        <span className="exchange-draw-option" key={tiles}>
          {i > 0 && <span>or</span>}
          {tiles ? <MiniTiles tiles={tiles} /> : <span>Uses kept tiles</span>}
          {showScores && (
            <span className="exchange-example-score">{score} pts</span>
          )}
        </span>
      ))}
    </div>
  );
}

export default function ExchangeAnalysis({
  game,
  slots,
  recommendation,
}: {
  game: Game;
  slots: number[];
  recommendation?: string;
}) {
  const { total, excess } = unseenTiles(game, game.template);
  const bag = Math.max(0, total - game.template.rackSize);
  const { result, progress, error, run, reset } = usePractice<ExchangeResult>();
  const minimum = minimumExchangeBag(game.template, slots.length);
  const valid = !excess.length && bag >= minimum;
  const { board, dictionaryId, rack, template } = game;
  // RackEntry keys this panel by the position and marked slots.
  const [request] = useState(() => ({
    kind: "exchange" as const,
    dictionaryId,
    exchange: { board, rack, slots, bag, template },
  }));
  useEffect(() => {
    if (valid) run(request);
  }, [valid, request, run]);
  return (
    <section
      className="rack-simulation practice-body"
      aria-label="Simulate exchange"
    >
      <div className="rack-simulation-heading">
        <h3>
          Exchange {slots.length} {slots.length === 1 ? "tile" : "tiles"}
        </h3>
        <MiniTiles tiles={slots.map((i) => rack[i]).join("")} />
        <span
          className="rack-simulation-bag"
          title="Assumes one opponent has up to a full rack"
        >
          {bag} estimated in bag
        </span>
      </div>
      {recommendation && <p className="small muted">{recommendation}.</p>}
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
            onClick={() => run(request)}
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
            <>
              <p className="small muted">
                Share of refills where the word was the top play or top bingo.
                Points show its best score.
              </p>
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
                      <span className="exchange-example-score">
                        {example.score} pts
                      </span>
                      {example.bingo && (
                        <span className="bingo-badge">
                          <Trophy size={10} aria-hidden="true" />
                          BINGO
                        </span>
                      )}
                      <span className="exchange-example-chance">
                        {result.exact ? "" : "≈"}
                        {example.chance < 0.001
                          ? "<0.1%"
                          : exchangePercent.format(example.chance)}
                      </span>
                    </div>
                    <DrawOptions draws={example.draws} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
