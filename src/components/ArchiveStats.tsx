import { useId, useState, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { archiveGameDate, archiveStatistics } from "../../shared/archive-stats";
import type { GameSummary } from "../../shared/game-index";
import { matchGamePlatform } from "../premium-palettes";
import "./archive-stats.css";

const languages = {
  en: "English",
  fr: "French",
  it: "Italian",
  unknown: "Unknown",
};
const integerFormat = new Intl.NumberFormat();
const averageFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
});
const marginFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});
const monthFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const metrics = {
  averageScore: { name: "Average final score", sample: "scored" },
  winRate: { name: "Win rate", sample: "results" },
  averageMargin: { name: "Average margin", sample: "marginCount" },
  games: { name: "Archived games", sample: "games" },
  averageBingos: { name: "Bingos per game", sample: "withPlays" },
  pointsPerPlay: { name: "Points per play", sample: "withPlays" },
} as const;
type Metric = keyof typeof metrics;
type StatsMonth = ReturnType<typeof archiveStatistics>["months"][number];

function metricValue(metric: Metric, value: number | undefined) {
  if (value === undefined) return "—";
  if (metric === "games") return integerFormat.format(value);
  if (metric === "averageMargin") return marginFormat.format(value);
  return averageFormat.format(value) + (metric === "winRate" ? "%" : "");
}

function gameCount(count: number) {
  return `${integerFormat.format(count)} ${count === 1 ? "game" : "games"}`;
}

function platformLabel(platform?: string) {
  return (
    matchGamePlatform(platform)?.name ??
    platform?.trim().replace(/\s+/g, " ") ??
    ""
  );
}

function monthNumber(month: string) {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5));
}

function monthLabel(month: string) {
  return monthFormat.format(new Date(month + "-01T00:00:00Z"));
}

function scale(metric: Metric, low: number, high: number) {
  if (metric === "winRate") return { floor: 0, step: 25 };
  if (
    metric === "games" ||
    metric === "averageBingos" ||
    metric === "averageMargin"
  )
    low = Math.min(0, low);
  if (metric === "averageMargin") high = Math.max(0, high);
  const gap = Math.max(metric === "averageBingos" ? 0.4 : 4, high - low) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(gap));
  const stepSize =
    [1, 2, 5, 10].find(
      (unit) =>
        (Math.floor(low / (unit * magnitude)) + 4) * unit * magnitude >= high,
    ) ?? 10;
  const step = stepSize * magnitude;
  return { floor: Math.floor(low / step) * step, step };
}

function Trend({ months, metric }: { months: StatsMonth[]; metric: Metric }) {
  const points = months.flatMap(({ month, [metric]: value }) =>
    value === undefined ? [] : [{ month, value }],
  );
  if (!points.length)
    return (
      <p className="muted" role="status">
        No dated games with this stat.
      </p>
    );

  const first = months[0].month;
  const last = months.at(-1)!.month;
  const span = monthNumber(last) - monthNumber(first);
  const middleOffset = Math.round(span / 2);
  const middle = new Date(first + "-01T00:00:00Z");
  middle.setUTCMonth(middle.getUTCMonth() + middleOffset);
  let low = Infinity;
  let high = -Infinity;
  for (const { value } of points) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  const { floor, step } = scale(metric, low, high);
  const positions = points.map(({ month, value }) => ({
    month,
    value,
    x: span ? ((monthNumber(month) - monthNumber(first)) / span) * 100 : 50,
    y: 100 - ((value - floor) / (step * 4)) * 100,
  }));
  const line: string[] = [];
  for (const [index, { month, x, y }] of positions.entries()) {
    const previous = positions[index - 1];
    if (
      metric === "games" &&
      previous &&
      monthNumber(month) - monthNumber(previous.month) > 1
    ) {
      // Months between recorded games have zero volume. Two points cover the gap.
      const stepX = 100 / span;
      line.push(`${previous.x + stepX},100`, `${x - stepX},100`);
    }
    line.push(`${x},${y}`);
  }
  const { name, sample } = metrics[metric];
  return (
    <>
      <div className="stats-chart" aria-hidden="true">
        <div className="stats-chart-scale">
          {[4, 3, 2, 1, 0].map((tick) => (
            <span key={tick}>{metricValue(metric, floor + tick * step)}</span>
          ))}
        </div>
        <div className="stats-chart-plot">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline points={line.join(" ")} />
          </svg>
          {positions.map(({ month, value, x, y }) => (
            <span
              key={month}
              className="stats-chart-point"
              title={`${monthLabel(month)} · ${metricValue(metric, value)}`}
              style={{ left: `${x}%`, top: `${y}%` }}
            />
          ))}
        </div>
        <div className="stats-chart-dates">
          <span>{monthLabel(first)}</span>
          {span >= 4 && (
            <span
              className="stats-chart-middle-date"
              style={{ left: `${(middleOffset / span) * 100}%` }}
            >
              {monthFormat.format(middle)}
            </span>
          )}
          {last !== first && <span>{monthLabel(last)}</span>}
        </div>
      </div>
      <details className="stats-chart-data">
        <summary>Monthly values</summary>
        <table aria-label={`Monthly ${name.toLowerCase()}`}>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">{name}</th>
              {metric !== "games" && <th scope="col">Games used</th>}
            </tr>
          </thead>
          <tbody>
            {months.map((month) => (
              <tr key={month.month}>
                <th scope="row">{monthLabel(month.month)}</th>
                <td>{metricValue(metric, month[metric])}</td>
                {metric !== "games" && (
                  <td>{integerFormat.format(month[sample])}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

function StatCard({
  metric,
  value,
  detail,
  extra,
}: {
  metric: Metric;
  value: number | undefined;
  detail?: string;
  extra?: ReactNode;
}) {
  const color =
    metric === "averageMargin" && value
      ? value > 0
        ? "stats-positive"
        : "stats-negative"
      : undefined;
  return (
    <div className="panel stats-card">
      <dt>{metrics[metric].name}</dt>
      <dd className={color}>{metricValue(metric, value)}</dd>
      {detail && <dd className="stats-card-detail">{detail}</dd>}
      {extra && <dd className="stats-card-detail">{extra}</dd>}
    </div>
  );
}

export default function ArchiveStats({
  games,
  headerControl,
  onBack,
}: {
  games: readonly GameSummary[];
  headerControl?: ReactNode;
  onBack: () => void;
}) {
  const [platform, setPlatform] = useState("");
  const [language, setLanguage] = useState("");
  const [year, setYear] = useState("");
  const [metric, setMetric] = useState<Metric>("averageScore");
  const trendHeading = useId();

  const platforms = new Map<string, string>();
  const languageOptions = new Set<keyof typeof languages>();
  const years = new Set<string>();
  const entries = games.map((game) => {
    const label = platformLabel(game.platform);
    const platformKey = label ? `platform:${label.toLowerCase()}` : "unknown";
    const gameLanguage = game.language ?? "unknown";
    const gameYear = archiveGameDate(game)?.slice(0, 4);
    if (!platforms.has(platformKey))
      platforms.set(platformKey, label || "Unknown");
    languageOptions.add(gameLanguage);
    if (gameYear) years.add(gameYear);
    return { game, platformKey, gameLanguage, gameYear };
  });
  const selectedPlatform = platforms.has(platform) ? platform : "";
  const selectedLanguage = [...languageOptions].some(
    (value) => value === language,
  )
    ? language
    : "";
  const selectedYear = years.has(year) ? year : "";
  const matching = entries.filter(
    (entry) =>
      (!selectedPlatform || entry.platformKey === selectedPlatform) &&
      (!selectedLanguage || entry.gameLanguage === selectedLanguage) &&
      (!selectedYear || entry.gameYear === selectedYear),
  );
  const { total, months, undated } = archiveStatistics(
    matching.map(({ game }) => game),
  );
  const { win, loss, tie } = total.record;
  const record = [
    `${integerFormat.format(win)} ${win === 1 ? "win" : "wins"}`,
    `${integerFormat.format(loss)} ${loss === 1 ? "loss" : "losses"}`,
    `${integerFormat.format(tie)} ${tie === 1 ? "tie" : "ties"}`,
  ].join(" · ");
  return (
    <section
      className="archive-view stats-view"
      aria-labelledby="stats-heading"
    >
      <div className="workspace-heading">
        <div className="archive-title">
          {headerControl}
          <h1 id="stats-heading">Stats</h1>
        </div>
        <button
          className="button secondary archive-back"
          aria-label="Back to games"
          onClick={onBack}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Back to games</span>
        </button>
      </div>
      {games.length ? (
        <>
          <div className="panel stats-filters">
            <label>
              Platform
              <select
                value={selectedPlatform}
                onChange={(event) => setPlatform(event.currentTarget.value)}
              >
                <option value="">All platforms</option>
                {[...platforms]
                  .sort((a, b) => a[1].localeCompare(b[1]))
                  .map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Language
              <select
                value={selectedLanguage}
                onChange={(event) => setLanguage(event.currentTarget.value)}
              >
                <option value="">All languages</option>
                {[...languageOptions]
                  .sort((a, b) => languages[a].localeCompare(languages[b]))
                  .map((value) => (
                    <option key={value} value={value}>
                      {languages[value]}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Year
              <select
                value={selectedYear}
                onChange={(event) => setYear(event.currentTarget.value)}
              >
                <option value="">All years</option>
                {[...years]
                  .sort()
                  .reverse()
                  .map((value) => (
                    <option key={value}>{value}</option>
                  ))}
              </select>
            </label>
          </div>
          {total.games ? (
            <>
              <dl className="stats-cards">
                <StatCard
                  metric="games"
                  value={total.games}
                  detail={`of ${gameCount(games.length)} in this profile`}
                />
                <StatCard
                  metric="winRate"
                  value={total.winRate}
                  detail={total.results ? record : "No recorded results"}
                />
                <StatCard
                  metric="averageScore"
                  value={total.averageScore}
                  detail={`${gameCount(total.scored)} with final scores`}
                  extra={
                    total.highScore !== undefined &&
                    `High score ${integerFormat.format(total.highScore)}`
                  }
                />
                <StatCard
                  metric="averageMargin"
                  value={total.averageMargin}
                  detail={`${gameCount(total.marginCount)} with both scores`}
                />
                <StatCard
                  metric="averageBingos"
                  value={total.averageBingos}
                  detail={`${gameCount(total.withPlays)} with full play history`}
                />
                <StatCard
                  metric="pointsPerPlay"
                  value={total.pointsPerPlay}
                  detail={`${integerFormat.format(total.plays)} recorded ${total.plays === 1 ? "play" : "plays"}`}
                  extra={
                    total.bestPlay !== undefined &&
                    `Best play ${integerFormat.format(total.bestPlay)}`
                  }
                />
              </dl>
              <section
                className="panel stats-trend"
                aria-labelledby={trendHeading}
              >
                <div className="stats-trend-heading">
                  <h2 id={trendHeading}>Monthly trends</h2>
                  <select
                    aria-label="Trend metric"
                    value={metric}
                    onChange={(event) =>
                      setMetric(event.currentTarget.value as Metric)
                    }
                  >
                    {Object.entries(metrics).map(([key, { name }]) => (
                      <option key={key} value={key}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <Trend months={months} metric={metric} />
                <p className="stats-note muted">
                  Trends use the finish date when available, otherwise the start
                  date.
                  {!!undated &&
                    ` ${gameCount(undated)} without a date ${undated === 1 ? "counts" : "count"} in the totals above.`}
                </p>
              </section>
            </>
          ) : (
            <p className="panel archive-panel muted" role="status">
              No archived games match these filters.
            </p>
          )}
        </>
      ) : (
        <p className="panel archive-panel muted">
          Archive a game to see your stats here.
        </p>
      )}
    </section>
  );
}
