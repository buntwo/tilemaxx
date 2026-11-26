import {
  type CSSProperties,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Player, TrackedMove } from "../../shared/model";
import { trackedTurnLabel } from "../../shared/notation";
import { DefinitionWord, useMoveDefinitionContext } from "./MoveDefinitions";
import { BingoBadge } from "./MoveWord";
import "./score-chart.css";

const players = ["you", "opponent"] as const;
const soloPlayers = ["you"] as const;
const labels = { you: "You", opponent: "Opponent" };
const number = new Intl.NumberFormat();
const compactNumber = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const chartHeight = 206;
const plotTop = 12;
const plotBottom = chartHeight - 32;

type ChartMove = Pick<TrackedMove, "player" | "word" | "score" | "bingo" | "action" | "review"> & {
  number: number;
};
type ScorePair = {
  first: number;
  last: number;
  totals: Record<Player, number>;
  plays: Partial<Record<Player, ChartMove>>;
};

function pairMoves(moves: readonly ChartMove[], solo: boolean) {
  const pairs: ScorePair[] = [
    { first: 0, last: 0, totals: { you: 0, opponent: 0 }, plays: {} },
  ];
  for (let index = 0; index < moves.length; index++) {
    const first = moves[index];
    const next = moves[index + 1];
    const last = !solo && next && next.player !== first.player ? next : first;
    if (last !== first) index++;
    const totals = { ...pairs[pairs.length - 1].totals };
    totals[first.player] += first.score;
    if (last !== first) totals[last.player] += last.score;
    pairs.push({
      first: first.number,
      last: last.number,
      totals,
      plays: { [first.player]: first, [last.player]: last },
    });
  }
  return pairs;
}

function moveNumbers(pair: ScorePair) {
  return pair.first === pair.last
    ? String(pair.last)
    : `${pair.first}–${pair.last}`;
}

function pairLabel(pair: ScorePair) {
  if (!pair.last) return "Start";
  return `${pair.first === pair.last ? "Move" : "Moves"} ${moveNumbers(pair)}`;
}

function scoreTicks(maximum: number) {
  const target = Math.max(1, maximum / 4);
  const unit = 10 ** Math.floor(Math.log10(target));
  const step =
    ([1, 2, 5].find((factor) => factor * unit >= target) ?? 10) * unit;
  const count = Math.max(1, Math.ceil(maximum / step));
  return Array.from({ length: count + 1 }, (_, index) => index * step);
}

function describePair(pair: ScorePair, solo: boolean) {
  return [
    pairLabel(pair),
    ...(solo ? soloPlayers : players).map((player) => {
      const score = `${labels[player]} ${number.format(pair.totals[player])} points`;
      const play = pair.plays[player];
      return play
        ? `${score}, ${trackedTurnLabel(play)} for ${number.format(play.score)} points${play.bingo ? ", bingo" : ""}`
        : score;
    }),
  ].join(". ");
}

function ScoreMarkers({
  pair,
  x,
  y,
  active = false,
  solo,
  waitingFor,
  future,
}: {
  pair: ScorePair;
  x: number;
  y: (points: number) => number;
  active?: boolean;
  solo: boolean;
  waitingFor?: Player;
  future?: Player | "both";
}) {
  const opponentOutline =
    !pair.plays.opponent || pair.totals.you === pair.totals.opponent;
  const square = opponentOutline ? (active ? 13 : 10) : active ? 11 : 7;
  return (
    <g className={active ? "score-chart-active" : undefined}>
      {waitingFor !== "you" && (
        <circle
          className="score-chart-you"
          cx={x}
          cy={y(pair.totals.you)}
          r={active ? 6 : 3.8}
          data-future={future === "you" || future === "both" || undefined}
          data-outline={(pair.last > 0 && !pair.plays.you) || undefined}
        />
      )}
      {!solo && waitingFor !== "opponent" && (
        <rect
          className="score-chart-opponent"
          x={x - square / 2}
          y={y(pair.totals.opponent) - square / 2}
          width={square}
          height={square}
          rx={1}
          data-future={future === "opponent" || future === "both" || undefined}
          data-outline={opponentOutline || undefined}
        />
      )}
    </g>
  );
}

export default function ScoreChart({
  moves,
  solo = false,
  replay,
}: {
  moves: readonly ChartMove[];
  solo?: boolean;
  replay?: {
    index: number;
    scores: Record<Player, number>;
    seek: (index: number) => void;
    finalBoard?: boolean;
  };
}) {
  const chartPlayers = solo ? soloPlayers : players;
  const heading = useId();
  const tooltipId = `${heading}-tooltip`;
  const svg = useRef<SVGSVGElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const definitions = useMoveDefinitionContext();
  const [width, setWidth] = useState(500);
  const [hovered, setHovered] = useState<number | null>(null);
  const [pointerInPlot, setPointerInPlot] = useState(false);
  const [focused, setFocused] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [seekAnchor, setSeekAnchor] = useState<{ top: number }>();
  const pairs = useMemo(() => pairMoves(moves, solo), [moves, solo]);
  const last = pairs.length - 1;
  const final = pairs[last].totals;
  const scores = scoreTicks(Math.max(final.you, final.opponent));
  const scoreLabels = scores.map((score) =>
    score >= 10_000 ? compactNumber.format(score) : number.format(score),
  );
  const left =
    10 + Math.max(3, ...scoreLabels.map((label) => label.length)) * 7;
  const right = width - 13;
  const x = (index: number) => left + (right - left) * (index / last);
  const y = (score: number) =>
    plotBottom - (plotBottom - plotTop) * (score / scores[scores.length - 1]);
  const tickCount = Math.min(
    pairs.length,
    Math.max(2, Math.min(5, Math.floor((right - left) / 62) + 1)),
  );
  const ticks = Array.from({ length: tickCount }, (_, index) =>
    Math.round((index * last) / (tickCount - 1)),
  );
  const markerStep = Math.max(1, Math.ceil((10 * last) / (right - left)));

  // Keep the score card in place while the pointer travels to its word’s definition.
  const definingChartWord = definitions?.anchor?.closest(".score-chart-tooltip")?.id === tooltipId;
  const activeHover = pointerInPlot || definingChartWord ? hovered : null;
  const replayTurn = replay?.finalBoard ? undefined : replay;
  const selected = replayTurn
    ? Math.max(
        0,
        pairs.findIndex((pair) => pair.last >= replayTurn.index),
      )
    : (activeHover ?? focused ?? pinned);
  const index = Math.min(selected ?? last, last);
  const pair = pairs[index];
  const waitingFor =
    replayTurn &&
    chartPlayers.find((player) => {
      const play = pair.plays[player];
      return play && play.number > replayTurn.index;
    });
  const displayed = replayTurn
    ? {
        ...pair,
        totals: replayTurn.scores,
        plays: waitingFor
          ? { ...pair.plays, [waitingFor]: undefined }
          : pair.plays,
      }
    : pair;
  const selectedX = x(index);
  const yourY = y(pair.totals.you);
  const opponentY = solo ? yourY : y(pair.totals.opponent);
  const upper = Math.min(yourY, opponentY);
  const lower = Math.max(yourY, opponentY);

  useLayoutEffect(() => {
    const element = svg.current;
    if (!element) return;
    const measure = () => {
      const measured = Math.round(element.getBoundingClientRect().width);
      if (measured > 0) setWidth(measured);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const element = tooltip.current;
    if (!element || replay) return;
    const { offsetWidth, offsetHeight } = element;
    const fitRight = selectedX + 10 + offsetWidth <= width;
    const tipLeft = fitRight ? selectedX + 10 : selectedX - offsetWidth - 10;
    const tipTop = fitRight ? lower : upper - offsetHeight - 8;
    element.style.left = `${Math.max(left, Math.min(width - offsetWidth, tipLeft))}px`;
    element.style.top = `${Math.max(0, Math.min(plotBottom - offsetHeight, tipTop))}px`;
  }, [selected, pair, width, left, selectedX, upper, lower, replay]);

  useLayoutEffect(() => {
    if (!seekAnchor || !svg.current) return;
    const shift = svg.current.getBoundingClientRect().top - seekAnchor.top;
    if (Math.abs(shift) >= 1) window.scrollBy({ top: shift, behavior: "instant" });
  }, [seekAnchor]);

  function seekReplay(pairIndex: number) {
    // Seeking can resize the board or move results above the chart.
    if (svg.current) setSeekAnchor({ top: svg.current.getBoundingClientRect().top });
    replay?.seek(pairs[pairIndex].last);
  }

  function pairAt(clientX: number, element: SVGSVGElement) {
    const bounds = element.getBoundingClientRect();
    if (!bounds.width) return last;
    const offset = ((clientX - bounds.left) / bounds.width) * width;
    return Math.max(
      0,
      Math.min(last, Math.round((last * (offset - left)) / (right - left))),
    );
  }

  const scoreTooltip = (replay || selected !== null) && (
    <div
      id={tooltipId}
      className="score-chart-tooltip"
      ref={tooltip}
      aria-hidden={replay ? undefined : true}
    >
      <strong>{pairLabel(pair)}</strong>
      <dl>
        {chartPlayers.map((player) => {
          const play = displayed.plays[player];
          const muted = replay && pair.last > 0 && !play;
          const current = replayTurn && play?.number === replayTurn.index;
          return (
            <div
              key={player}
              data-unplayed={muted || undefined}
              data-current={current || undefined}
            >
              <dt className="score-chart-player">
                <i className={`score-chart-swatch score-chart-${player}`} />
                <span>{player === "opponent" ? "Opp" : labels[player]}</span>
              </dt>
              <dd className="score-chart-total">
                {number.format(displayed.totals[player])}
              </dd>
              <dd className={play || muted ? "score-chart-play" : undefined}>
                {play ? (
                  <>
                    {play.bingo && <BingoBadge />}
                    {play.action ? <strong>{trackedTurnLabel(play)}</strong> : <DefinitionWord
                      key={play.number}
                      word={play.word}
                      className={play.bingo ? "bingo-move-word" : undefined}
                    />}
                    <span className="score-chart-points">+{number.format(play.score)} pts</span>
                  </>
                ) : muted ? (
                  <span className="score-chart-note">
                    {waitingFor === player ? "Yet to play" : "No recorded play"}
                  </span>
                ) : null}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );

  return (
    <figure
      className="score-chart"
      aria-labelledby={heading}
      data-replay={!!replay || undefined}
    >
      <figcaption className="score-chart-heading">
        <h3 id={heading}>Score by move</h3>
        <div className="score-chart-legend" aria-hidden="true">
          {chartPlayers.map((player) => (
            <span className="score-chart-player" key={player}>
              <i className={`score-chart-swatch score-chart-${player}`} />
              {labels[player]}
            </span>
          ))}
        </div>
      </figcaption>
      <div
        className="score-chart-plot"
        onPointerEnter={() => {
          if (definingChartWord) setPointerInPlot(true);
        }}
        onPointerLeave={() => {
          setPointerInPlot(false);
          if (!definingChartWord) setHovered(null);
        }}
        style={
          {
            "--score-axis-inset": `${left}px`,
            "--score-cursor-x": replay ? `${selectedX}px` : undefined,
          } as CSSProperties
        }
      >
        {replay && (
          <div className="score-chart-replay-tooltip">{scoreTooltip}</div>
        )}
        <svg
          ref={svg}
          className="score-chart-graph"
          viewBox={`0 0 ${width} ${chartHeight}`}
          role="img"
          aria-label={
            solo
              ? "Running score after each tracked move"
              : "Running scores after each pair of tracked moves"
          }
          onPointerMove={(event) => {
            if (!replayTurn && event.pointerType !== "touch") {
              setPointerInPlot(true);
              setHovered(pairAt(event.clientX, event.currentTarget));
            }
          }}
          onClick={(event) => {
            const next = pairAt(event.clientX, event.currentTarget);
            if (replay) seekReplay(next);
            else setPinned((current) => (current === next ? null : next));
          }}
        >
          {scores.map((score, tick) => (
            <g key={score}>
              <line
                className="score-chart-grid"
                x1={left}
                x2={right}
                y1={y(score)}
                y2={y(score)}
              />
              <text x={left - 7} y={y(score) + 4} textAnchor="end">
                {scoreLabels[tick]}
              </text>
            </g>
          ))}
          {ticks.map((tick) => (
            <text
              key={tick}
              x={x(tick)}
              y={chartHeight - 17}
              textAnchor="middle"
              data-current={(replayTurn && tick === index) || undefined}
            >
              {moveNumbers(pairs[tick])}
            </text>
          ))}
          <text x={(left + right) / 2} y={chartHeight - 2} textAnchor="middle">
            {solo ? "Move" : "Move pair"}
          </text>
          {chartPlayers.map((player) => {
            const points = pairs.map(
              (point, i) => `${x(i)},${y(point.totals[player])}`,
            );
            const through = replayTurn
              ? index - Number(waitingFor === player)
              : last;
            const className = `score-chart-line score-chart-${player}`;
            return (
              <g key={player}>
                {replayTurn && through < last && (
                  <polyline
                    className={className}
                    points={points.slice(through).join(" ")}
                    data-future
                  />
                )}
                <polyline
                  className={className}
                  points={points.slice(0, through + 1).join(" ")}
                />
              </g>
            );
          })}
          {pairs.map(
            (point, pointIndex) =>
              pointIndex > 0 &&
              (replay || pointIndex % markerStep === 0 || pointIndex === last) && (
                <ScoreMarkers
                  key={point.last}
                  pair={point}
                  solo={solo}
                  x={x(pointIndex)}
                  y={y}
                  future={replayTurn && (
                    pointIndex > index ? "both" : pointIndex === index ? waitingFor : undefined
                  )}
                />
              ),
          )}
          {selected !== null && (
            <g>
              <line
                className="score-chart-cursor"
                x1={selectedX}
                x2={selectedX}
                y1={plotTop}
                y2={plotBottom}
              />
              <ScoreMarkers
                pair={displayed}
                x={selectedX}
                y={y}
                solo={solo}
                waitingFor={waitingFor}
                active
              />
            </g>
          )}
        </svg>
        <input
          type="range"
          className="score-chart-range"
          aria-label={
            replay
              ? solo
                ? "Replay from score chart"
                : "Replay from move pair"
              : solo
                ? "Inspect scores by move"
                : "Inspect scores by move pair"
          }
          aria-valuetext={describePair(displayed, solo)}
          min={0}
          max={last}
          value={index}
          onFocus={() => setFocused(index)}
          onBlur={() => setFocused(null)}
          onChange={(event) => {
            const next = event.currentTarget.valueAsNumber;
            if (replay) {
              seekReplay(next);
              return;
            }
            setHovered(null);
            setFocused(next);
          }}
        />
        {!replay && scoreTooltip}
      </div>
    </figure>
  );
}
