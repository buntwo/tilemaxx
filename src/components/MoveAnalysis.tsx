import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChartNoAxesCombined, X } from "lucide-react";
import {
  endgameStreaks,
  type EndgameLine,
  type EndgameSettings,
} from "../../shared/endgame";
import { scoreTotalsAtPosition } from "../../shared/game-scoring";
import { type Game, type Move, coordinate } from "../../shared/model";
import { unseenTiles } from "../../shared/tile-pool";
import { rackLetters } from "../../shared/rack-entry";
import {
  ANALYSIS_TRIALS,
  MAX_ENDGAME_BUDGET_MULTIPLIER,
  REFINED_TRIALS,
  type AnalysisResult,
  type AnalysisRequest,
  type AnalysisProgress,
  type OpponentModel,
  type MoveForecast,
  addedTiles,
  endgameAnalysisLimits,
  isEndgameBudgetMultiplier,
  placeTiles,
} from "../../shared/move-analysis";
import { scoreTone } from "../score-tone";
import Board from "./Board";
import Modal from "./Modal";
import MoveWord from "./MoveWord";
import { useGameCalculation } from "./GameCalculations";

type WorkerMessage =
  | { progress: AnalysisProgress }
  | { result: AnalysisResult }
  | { error: string };
const percent = (value: number) => `${Math.round(value * 100)}%`;
const points = (value: number) => value.toFixed(1);

function formatFinalScore(
  endgame: EndgameLine | null | undefined,
  totals: ReturnType<typeof scoreTotalsAtPosition>,
) {
  if (!endgame || !totals) return;
  const you = totals.you + endgame.points.you;
  const opponent = totals.opponent + endgame.points.opponent;
  const margin = you - opponent;
  const outcome =
    margin > 0 ? `Win by ${margin}` : margin < 0 ? `Lose by ${-margin}` : "Tie";
  return { label: `${you}–${opponent} · ${outcome}`, margin };
}

export default function MoveAnalysis({
  game,
  candidates,
  onRemove,
  endgameSettings,
}: {
  game: Game;
  candidates: Move[];
  onRemove: (move: Move) => void;
  endgameSettings: EndgameSettings;
}) {
  const { total, excess } = unseenTiles(game, game.template);
  const minBag = Math.max(0, total - game.template.rackSize);
  const [bagText, setBagText] = useState(String(minBag));
  const [model, setModel] = useState<OpponentModel>("strong");
  const [infer, setInfer] = useState(false);
  const [scoreless, setScoreless] = useState(endgameSettings.scorelessTurns);
  const [opponentHasFinalTurn, setOpponentHasFinalTurn] = useState(
    endgameSettings.opponentHasFinalTurn ?? true,
  );
  const [endgameBudgetText, setEndgameBudgetText] = useState("1");
  const budgetHintId = useId();
  const [result, setResult] = useState<AnalysisResult>();
  const totals = result?.forecasts.some(({ endgame }) => endgame)
    ? scoreTotalsAtPosition(game)
    : undefined;
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<AnalysisProgress>();
  useGameCalculation(!!progress);
  const [example, setExample] = useState<{ move: Move; reply: Move }>();
  const worker = useRef<Worker | null>(null);
  const seed = useRef(0);
  const key = JSON.stringify(candidates.map((move) => move.id));
  const bagSize = Number(bagText);
  const bagValid =
    bagText !== "" &&
    Number.isInteger(bagSize) &&
    bagSize >= minBag &&
    bagSize <= total;
  const { size, rackSize } = game.template;
  const previous = game.past.at(-1)?.board;
  const canInfer =
    bagValid &&
    bagSize > 0 &&
    total - bagSize === rackSize &&
    !!previous &&
    addedTiles(previous, game.board, rackSize).length > 0;
  const inferenceKey = canInfer && infer ? previous.join(".") : "";
  const streak = endgameStreaks[game.template.rules];
  const endgame = bagValid && bagSize === 0 && (total > 0 || !streak);
  const endgameBudget = endgame ? Number(endgameBudgetText) : 1;
  const budgetValid = isEndgameBudgetMultiplier(endgameBudget);
  const { positionLimit, timeLimitMs } = endgameAnalysisLimits(
    endgameBudget,
    candidates.length,
  );
  const position = (move: Move) =>
    `${coordinate(move.row * size + move.col, size)}${move.direction === "across" ? " →" : " ↓"}`;

  function stop() {
    worker.current?.terminate();
    worker.current = null;
  }
  useEffect(() => {
    setProgress(undefined);
    setResult(undefined);
    setError("");
    setExample(undefined);
    return stop;
  }, [key, bagText, inferenceKey, scoreless, endgameBudget]);

  function run(trials: number) {
    setError("");
    setProgress({ phase: "scenarios", completed: 0, total: trials });
    if (trials === ANALYSIS_TRIALS)
      seed.current = Math.floor(Math.random() * 0x1_0000_0000);
    if (!worker.current) {
      const active = new Worker(
        new URL("../analysis.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = active;
      active.onmessage = (event: MessageEvent<WorkerMessage>) => {
        if (worker.current !== active) return;
        const response = event.data;
        if ("progress" in response) {
          setProgress(response.progress);
        } else {
          setProgress(undefined);
          if ("result" in response) setResult(response.result);
          else setError(response.error);
        }
      };
      active.onerror = () => {
        if (worker.current !== active) return;
        stop();
        setProgress(undefined);
        setError("The analysis stopped unexpectedly. Try again.");
      };
    }
    worker.current.postMessage({
      dictionaryId: game.dictionaryId,
      board: game.board,
      rack: game.rack,
      template: game.template,
      candidates,
      bagSize,
      seed: seed.current,
      trials,
      previousBoard: canInfer && infer ? previous : undefined,
      scorelessTurns: endgame && streak ? scoreless : 0,
      opponentHasFinalTurn,
      endgameBudgetMultiplier: endgame ? endgameBudget : undefined,
    } satisfies AnalysisRequest & { dictionaryId: string });
  }

  function viewReply(forecast: MoveForecast) {
    const reply = forecast.models[model].example ?? forecast.availableExample;
    if (reply) setExample({ move: forecast.move, reply });
  }

  return (
    <section className="move-analysis" aria-label="Move analysis">
      <p>
        Select up to three moves below. The first is the reference for blocking
        comparisons.
      </p>
      <div className="analysis-picks">
        {candidates.map((move) => (
          <button
            type="button"
            className="button secondary"
            key={move.id}
            onClick={() => onRemove(move)}
            aria-label={`Remove ${move.word} at ${position(move)} from comparison`}
          >
            <MoveWord move={move} rules={game.template} /> {position(move)}{" "}
            <X size={12} />
          </button>
        ))}
      </div>
      <div className="analysis-controls">
        <label>
          Tiles in bag
          <input
            type="number"
            min={minBag}
            max={total}
            inputMode="numeric"
            value={bagText}
            onChange={(event) => setBagText(event.target.value)}
          />
        </label>
        <label>
          Opponent model
          <select
            value={model}
            onChange={(event) => setModel(event.target.value as OpponentModel)}
          >
            <option value="strong">Strong</option>
            <option value="casual">Casual</option>
          </select>
        </label>
        {progress ? (
          <div className="analysis-running">
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                stop();
                setProgress(undefined);
              }}
            >
              Cancel analysis
            </button>
            <span className="analysis-counter" role="status">
              {progress.completed} / {progress.total} {progress.phase}
            </span>
          </div>
        ) : (
          <button
            type="button"
            className="button primary"
            onClick={() => run(result ? REFINED_TRIALS : ANALYSIS_TRIALS)}
            disabled={
              !candidates.length ||
              !bagValid ||
              !budgetValid ||
              !!excess.length ||
              result?.target === REFINED_TRIALS
            }
          >
            <ChartNoAxesCombined size={15} />{" "}
            {result ? "Refine estimates" : "Run analysis"}
          </button>
        )}
      </div>
      {canInfer && (
        <label className="analysis-option">
          <input
            type="checkbox"
            checked={infer}
            onChange={(event) => setInfer(event.target.checked)}
          />
          Treat last board edit as opponent’s play
        </label>
      )}
      {endgame && (
        <div className="analysis-controls">
          {streak ? (
            <label>
              {streak.passesOnly
                ? "Prior consecutive passes"
                : "Prior scoreless turns"}
              <select
                value={scoreless}
                onChange={(event) => setScoreless(Number(event.target.value))}
              >
                {Array.from({ length: streak.limit }, (_, count) => (
                  <option key={count}>{count}</option>
                ))}
              </select>
            </label>
          ) : (
            <label className="endgame-final-turn">
              <input
                type="checkbox"
                checked={opponentHasFinalTurn}
                onChange={(event) => setOpponentHasFinalTurn(event.target.checked)}
              />
              Opponent has a final turn
            </label>
          )}
          <label>
            Endgame budget (×)
            <input
              type="number"
              min={1}
              max={MAX_ENDGAME_BUDGET_MULTIPLIER}
              inputMode="numeric"
              value={endgameBudgetText}
              disabled={!!progress}
              aria-invalid={!budgetValid || undefined}
              aria-describedby={budgetHintId}
              onChange={(event) => setEndgameBudgetText(event.target.value)}
            />
          </label>
          <span className="analysis-budget-hint" id={budgetHintId}>
            {budgetValid
              ? `${positionLimit.toLocaleString()} positions or ${(timeLimitMs / 1_000).toLocaleString()} s per move`
              : `Enter a whole number from 1 to ${MAX_ENDGAME_BUDGET_MULTIPLIER}.`}
          </span>
        </div>
      )}
      {excess.length > 0 ? (
        <p className="error">
          Check the board and rack. Some entries exceed the starting tile
          counts.
        </p>
      ) : !bagValid ? (
        <p className="error">
          Enter a bag count from {minBag} to {total}. The other tiles must fit
          on one rack.
        </p>
      ) : (
        <p>
          {total - bagSize} opponent tiles assumed.{" "}
          {rackLetters(game.rack).length < rackSize &&
            bagSize > 0 &&
            "Check that your rack is complete. "}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="analysis-results">
          <p role="status">
            {result.trials} shared scenarios
            {result.trials < result.target &&
              ` · analysis limit reached before ${result.target}`}
            .
            {result.inferred &&
              ` Weighted by last play (about ${Math.round(result.effectiveTrials)} effective samples).`}
            {result.bagSize > 0 &&
              result.effectiveTrials < 30 &&
              " Few effective samples. Treat the estimates as rough."}
            {result.bagSize > 0 &&
              result.effectiveTrials >= 30 &&
              ` Sampling uncertainty can be around ±${Math.ceil(98 / Math.sqrt(result.effectiveTrials))} points for a percentage near 50%.`}
          </p>
          <Comparison
            result={result}
            model={model}
            position={position}
            totals={totals}
            rules={game.template}
          />
          <div className="analysis-cards">
            {result.forecasts.map((forecast) => {
              const { move } = forecast;
              const finalScore = formatFinalScore(forecast.endgame, totals);
              const reply = forecast.models[model];
              const exampleReply = reply.example ?? forecast.availableExample;
              return (
                <article
                  key={move.id}
                  className="analysis-card"
                  aria-label={`Analysis for ${move.word} at ${position(move)}`}
                >
                  <details>
                    <summary>
                      <MoveWord move={move} rules={game.template} />{" "}
                      {position(move)} details
                    </summary>
                    {!!forecast.bingoDraws.length && (
                      <p>
                        Bingo draws on this board include{" "}
                        {forecast.bingoDraws
                          .map((draw) => draw.replaceAll("?", "□"))
                          .join(", ")}
                        .
                      </p>
                    )}
                    {forecast.endgameLimit && <p>{forecast.endgameLimit}</p>}
                    {forecast.endgame && (
                      <div className="analysis-endgame">
                        <p className={scoreTone(forecast.endgame.spread)}>
                          Optimal endgame swing{" "}
                          {forecast.endgame.spread > 0 ? "+" : ""}
                          {forecast.endgame.spread}
                        </p>
                        {finalScore && (
                          <p className={scoreTone(finalScore.margin)}>
                            Final score {finalScore.label}
                          </p>
                        )}
                        <table
                          className="analysis-line"
                          aria-label="Optimal endgame line"
                        >
                          <thead>
                            <tr>
                              <th scope="col">Player</th>
                              <th scope="col">Play</th>
                              <th scope="col">Position</th>
                              <th scope="col">Points</th>
                            </tr>
                          </thead>
                          <tbody>
                            {forecast.endgame.line.map((step, turn) => (
                              <tr key={turn}>
                                <th scope="row">
                                  {turn % 2 ? "Opponent" : "You"}
                                </th>
                                <td>
                                  {step ? (
                                    <MoveWord
                                      move={step}
                                      rules={game.template}
                                    />
                                  ) : (
                                    "Pass"
                                  )}
                                </td>
                                <td>{step ? position(step) : "—"}</td>
                                <td
                                  className={scoreTone(
                                    (turn % 2 ? -1 : 1) * (step?.score ?? 0),
                                  )}
                                >
                                  {step?.score ?? 0}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {exampleReply && (
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => viewReply(forecast)}
                      >
                        Preview{" "}
                        {reply.example ? "modeled reply" : "available threat"}{" "}
                        <MoveWord move={exampleReply} rules={game.template} /> ·{" "}
                        <span className={scoreTone(-exampleReply.score)}>
                          {exampleReply.score} pts
                        </span>
                      </button>
                    )}
                  </details>
                </article>
              );
            })}
          </div>
        </div>
      )}
      <details className="analysis-assumptions">
        <summary>How the estimates work</summary>
        <p>
          Two-player model. We sample the opponent’s rack and your refill from
          the unseen tiles. Bingo after your play uses the board before the
          reply. Exact odds enumerate weighted draws when there are at most two
          tiles to draw and the search fits the time budget. Using the last play
          weights possible racks toward those where that play makes sense.
        </p>
        <p>
          Strong picks by score plus estimated leave value while the bag has
          tiles. Casual favors familiar words and chooses among three replies.
          Both pass if no play is available. The simulation omits exchanges.
          Expected point swing is this move’s score minus the modeled reply plus
          your highest available next score. Empty-bag search assumes optimal
          play on both sides and applies the game's final-scoring rules.
        </p>
      </details>
      {example && (
        <Modal
          title={
            <>
              <MoveWord move={example.reply} rules={game.template} /> ·{" "}
              <span className={scoreTone(-example.reply.score)}>
                {example.reply.score} points
              </span>
            </>
          }
          subtitle={
            <>
              Example opponent reply after{" "}
              <MoveWord move={example.move} rules={game.template} /> at{" "}
              {position(example.move)}.
            </>
          }
          onClose={() => setExample(undefined)}
        >
          <Board
            compact
            template={game.template}
            board={placeTiles(game.board, example.move)}
            preview={example.reply}
          />
        </Modal>
      )}
    </section>
  );
}

function Comparison({
  result,
  model,
  position,
  totals,
  rules,
}: {
  result: AnalysisResult;
  model: OpponentModel;
  position: (move: Move) => string;
  totals: ReturnType<typeof scoreTotalsAtPosition>;
  rules: Game["template"];
}) {
  const rows: {
    label: string;
    display: (forecast: MoveForecast, index: number) => ReactNode;
    rating?: (forecast: MoveForecast) => number | undefined;
  }[] = [
    {
      label: "Leave · Draw",
      display: (f) => `${f.move.leave || "—"} · ${f.drawSize}`,
    },
    {
      label: "Bingo after your play",
      display: (f) => (
        <>
          {percent(f.bingo)} {f.exact && <small>exact</small>}
        </>
      ),
      rating: compare((f) => f.bingo, percent),
    },
    {
      label: "Bingo after opponent reply",
      display: (f) => percent(f.models[model].nextBingo),
      rating: compare((f) => f.models[model].nextBingo, percent),
    },
    {
      label: "40+ reply available",
      display: (f) => percent(f.bigAvailable),
      rating: compare((f) => f.bigAvailable, percent, -1),
    },
    {
      label: "Opponent bingo available",
      display: (f) => percent(f.bingoAvailable),
      rating: compare((f) => f.bingoAvailable, percent, -1),
    },
    {
      label: "Average best reply",
      display: (f) => points(f.bestReply),
      rating: compare((f) => f.bestReply, points, -1),
    },
    {
      label: "40+ reply played",
      display: (f) => percent(f.models[model].bigReply),
      rating: compare((f) => f.models[model].bigReply, percent, -1),
    },
    {
      label: "Average reply played",
      display: (f) => points(f.models[model].replyScore),
      rating: compare((f) => f.models[model].replyScore, points, -1),
    },
    {
      label: "Your next score",
      display: (f) => points(f.models[model].nextScore),
      rating: compare((f) => f.models[model].nextScore, points),
    },
    {
      label: "Expected point swing",
      display: (f) => points(f.models[model].swing),
      rating: (f) => Number(points(f.models[model].swing)),
    },
  ];
  if (result.forecasts.length > 1)
    rows.push(
      {
        label: "40+ threat removed",
        display: (f, i) => (i ? percent(f.bigThreatRemoved) : "—"),
        rating: (f) => Math.round(f.bigThreatRemoved * 100),
      },
      {
        label: "40+ threat opened",
        display: (f, i) => (i ? percent(f.bigThreatOpened) : "—"),
        rating: (f) => -Math.round(f.bigThreatOpened * 100),
      },
    );
  if (result.forecasts.some((f) => f.endgame !== undefined))
    rows.push({
      label: "Optimal endgame swing",
      display: (f) => f.endgame?.spread ?? "—",
      rating: (f) => f.endgame?.spread,
    });
  if (totals)
    rows.push({
      label: "Final score (you–opponent)",
      display: (f) => formatFinalScore(f.endgame, totals)?.label ?? "—",
      rating: (f) => formatFinalScore(f.endgame, totals)?.margin,
    });

  function compare(
    read: (forecast: MoveForecast) => number,
    format: (value: number) => string,
    direction = 1,
  ) {
    const reference = read(result.forecasts[0]);
    return (forecast: MoveForecast) => {
      const value = read(forecast);
      return format(value) === format(reference)
        ? 0
        : direction * (value - reference);
    };
  }

  return (
    <div className="analysis-table-wrap">
      <table aria-label="Move comparison">
        <thead>
          <tr>
            <th scope="col">Metric</th>
            {result.forecasts.map(({ move }, i) => (
              <th key={move.id} scope="col">
                <MoveWord move={move} rules={rules} />
                <small>
                  {position(move)} · {move.score} pts
                </small>
                {i === 0 && result.forecasts.length > 1 && (
                  <small>Reference</small>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, display, rating }) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              {result.forecasts.map((f, i) => (
                <td key={f.move.id} className={scoreTone(rating?.(f))}>
                  {display(f, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
