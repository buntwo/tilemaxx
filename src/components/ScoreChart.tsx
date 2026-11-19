import {
  type CSSProperties,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Player, TrackedMove } from "../../shared/model";
import { BingoBadge } from "./MoveWord";
import "./score-chart.css";

const players = ["you", "opponent"] as const;
const labels = { you: "You", opponent: "Opponent" };
const number = new Intl.NumberFormat();
const compactNumber = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const chartHeight = 206;
const plotTop = 12;
const plotBottom = chartHeight - 32;

type ChartMove = Pick<TrackedMove, "player" | "word" | "score" | "bingo"> & {
  number: number;
  total: number;
};
type ScorePair = {
  first: number;
  last: number;
  totals: Record<Player, number>;
  plays: Partial<Record<Player, ChartMove>>;
};

function pairMoves(moves: readonly ChartMove[]) {
  const pairs: ScorePair[] = [
    { first: 0, last: 0, totals: { you: 0, opponent: 0 }, plays: {} },
  ];
  for (let index = 0; index < moves.length; index++) {
    const first = moves[index];
    const next = moves[index + 1];
    const last = next && next.player !== first.player ? next : first;
    if (last !== first) index++;
    pairs.push({
      first: first.number,
      last: last.number,
      totals: {
        ...pairs[pairs.length - 1].totals,
        [first.player]: first.total,
        [last.player]: last.total,
      },
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

function describePair(pair: ScorePair) {
  return [
    pairLabel(pair),
    ...players.map((player) => {
      const score = `${labels[player]} ${number.format(pair.totals[player])} points`;
      const play = pair.plays[player];
      return play
        ? `${score}, ${play.word} for ${number.format(play.score)} points${play.bingo ? ", bingo" : ""}`
        : score;
    }),
  ].join(". ");
}

function ScoreMarkers({
  pair,
  x,
  y,
  active = false,
}: {
  pair: ScorePair;
  x: number;
  y: (points: number) => number;
  active?: boolean;
}) {
  const opponentOutline =
    !pair.plays.opponent || pair.totals.you === pair.totals.opponent;
  const square = opponentOutline ? (active ? 13 : 10) : active ? 11 : 7;
  return (
    <g className={active ? "score-chart-active" : undefined}>
      <circle
        className="score-chart-you"
        cx={x}
        cy={y(pair.totals.you)}
        r={active ? 6 : 3.8}
        data-outline={(pair.last > 0 && !pair.plays.you) || undefined}
      />
      <rect
        className="score-chart-opponent"
        x={x - square / 2}
        y={y(pair.totals.opponent) - square / 2}
        width={square}
        height={square}
        rx={1}
        data-outline={opponentOutline || undefined}
      />
    </g>
  );
}

export default function ScoreChart({ moves }: { moves: readonly ChartMove[] }) {
  const heading = useId();
  const svg = useRef<SVGSVGElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(500);
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const pairs = useMemo(() => pairMoves(moves), [moves]);
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

  const selected = hovered ?? focused ?? pinned;
  const index = Math.min(selected ?? last, last);
  const pair = pairs[index];
  const selectedX = x(index);
  const upper = Math.min(y(pair.totals.you), y(pair.totals.opponent));
  const lower = Math.max(y(pair.totals.you), y(pair.totals.opponent));

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
    if (!element) return;
    const { offsetWidth, offsetHeight } = element;
    const fitRight = selectedX + 10 + offsetWidth <= width;
    const tipLeft = fitRight ? selectedX + 10 : selectedX - offsetWidth - 10;
    const tipTop = fitRight ? lower : upper - offsetHeight - 8;
    element.style.left = `${Math.max(left, Math.min(width - offsetWidth, tipLeft))}px`;
    element.style.top = `${Math.max(0, Math.min(plotBottom - offsetHeight, tipTop))}px`;
  }, [selected, pair, width, left, selectedX, upper, lower]);

  function pairAt(clientX: number, element: SVGSVGElement) {
    const bounds = element.getBoundingClientRect();
    if (!bounds.width) return last;
    const offset = ((clientX - bounds.left) / bounds.width) * width;
    return Math.max(
      0,
      Math.min(last, Math.round((last * (offset - left)) / (right - left))),
    );
  }

  return (
    <figure className="score-chart" aria-labelledby={heading}>
      <figcaption className="score-chart-heading">
        <h3 id={heading}>Score by move</h3>
        <div className="score-chart-legend" aria-hidden="true">
          {players.map((player) => (
            <span className="score-chart-player" key={player}>
              <i className={`score-chart-swatch score-chart-${player}`} />
              {labels[player]}
            </span>
          ))}
        </div>
      </figcaption>
      <div
        className="score-chart-plot"
        style={{ "--score-axis-inset": `${left}px` } as CSSProperties}
      >
        <svg
          ref={svg}
          className="score-chart-graph"
          viewBox={`0 0 ${width} ${chartHeight}`}
          role="img"
          aria-label="Running scores after each pair of tracked moves"
          onPointerMove={(event) => {
            if (event.pointerType !== "touch")
              setHovered(pairAt(event.clientX, event.currentTarget));
          }}
          onPointerLeave={() => setHovered(null)}
          onClick={(event) => {
            const next = pairAt(event.clientX, event.currentTarget);
            setPinned((current) => (current === next ? null : next));
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
            >
              {moveNumbers(pairs[tick])}
            </text>
          ))}
          <text x={(left + right) / 2} y={chartHeight - 2} textAnchor="middle">
            Move pair
          </text>
          {players.map((player) => (
            <polyline
              className={`score-chart-line score-chart-${player}`}
              key={player}
              points={pairs
                .map((point, index) => `${x(index)},${y(point.totals[player])}`)
                .join(" ")}
            />
          ))}
          {pairs.map(
            (point, index) =>
              index > 0 &&
              (index % markerStep === 0 || index === last) && (
                <ScoreMarkers
                  key={point.last}
                  pair={point}
                  x={x(index)}
                  y={y}
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
              <ScoreMarkers pair={pair} x={selectedX} y={y} active />
            </g>
          )}
        </svg>
        <input
          type="range"
          className="score-chart-range"
          aria-label="Inspect scores by move pair"
          aria-valuetext={describePair(pair)}
          min={0}
          max={last}
          value={index}
          onFocus={() => setFocused(index)}
          onBlur={() => setFocused(null)}
          onChange={(event) => {
            setHovered(null);
            setFocused(event.currentTarget.valueAsNumber);
          }}
        />
        {selected !== null && (
          <div className="score-chart-tooltip" ref={tooltip} aria-hidden="true">
            <strong>{pairLabel(pair)}</strong>
            <dl>
              {players.map((player) => {
                const play = pair.plays[player];
                return (
                  <div key={player}>
                    <dt className="score-chart-player">
                      <i
                        className={`score-chart-swatch score-chart-${player}`}
                      />
                      <span>{labels[player]}</span>
                    </dt>
                    <dd className="score-chart-total">
                      {number.format(pair.totals[player])}
                    </dd>
                    <dd className={play ? "score-chart-play" : undefined}>
                      {play && (
                        <>
                          {play.bingo && <BingoBadge />}
                          <span
                            className={
                              play.bingo ? "bingo-move-word" : undefined
                            }
                          >
                            {play.word}
                          </span>
                          <span className="score-chart-points">
                            +{number.format(play.score)} pts
                          </span>
                        </>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        )}
      </div>
    </figure>
  );
}
