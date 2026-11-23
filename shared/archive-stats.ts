import type { ArchivedGameStats, GameSummary } from "./game-index";

export function archiveGameDate(game: GameSummary): string | undefined {
  return [game.endedOn, game.startedOn].find(
    (date) => date && /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date),
  );
}

function recordedStats(game: GameSummary): ArchivedGameStats | undefined {
  if (game.archiveStats !== undefined) return game.archiveStats ?? undefined;

  // A browser can open a cached index from before play stats were added.
  const score = game.score;
  if (!score || score.outcome === "playing" || score.outcome === "archived")
    return;
  return {
    finalScore: score.you,
    ...(score.outcome !== "finished" &&
      !game.solo && {
        outcome: score.outcome,
        margin: score.you - score.opponent,
      }),
  };
}

function average(sum: number, count: number) {
  return count ? sum / count : undefined;
}

function aggregate(games: readonly GameSummary[]) {
  const record = { win: 0, loss: 0, tie: 0 };
  let scored = 0;
  let scoreTotal = 0;
  let marginCount = 0;
  let marginTotal = 0;
  let withPlays = 0;
  let plays = 0;
  let playPoints = 0;
  let bingos = 0;
  let highScore: number | undefined;
  let bestPlay: number | undefined;
  for (const game of games) {
    const stats = recordedStats(game);
    if (!stats) continue;
    if (stats.outcome) record[stats.outcome]++;
    if (stats.finalScore !== undefined) {
      scored++;
      scoreTotal += stats.finalScore;
      highScore = Math.max(highScore ?? stats.finalScore, stats.finalScore);
    }
    if (stats.margin !== undefined) {
      marginCount++;
      marginTotal += stats.margin;
    }
    if (stats.plays) {
      withPlays++;
      plays += stats.plays.moves;
      playPoints += stats.plays.points;
      bingos += stats.plays.bingos;
      bestPlay = Math.max(bestPlay ?? stats.plays.best, stats.plays.best);
    }
  }
  const results = record.win + record.loss + record.tie;
  return {
    games: games.length,
    record,
    results,
    scored,
    marginCount,
    withPlays,
    plays,
    highScore,
    bestPlay,
    winRate: average(record.win * 100, results),
    averageScore: average(scoreTotal, scored),
    averageMargin: average(marginTotal, marginCount),
    averageBingos: average(bingos, withPlays),
    pointsPerPlay: average(playPoints, plays),
  };
}

export function archiveStatistics(games: readonly GameSummary[]) {
  const archived = games.filter(({ archived }) => archived);
  const byMonth = new Map<string, GameSummary[]>();
  let undated = 0;
  for (const game of archived) {
    const month = archiveGameDate(game)?.slice(0, 7);
    if (!month) {
      undated++;
      continue;
    }
    const group = byMonth.get(month);
    if (group) group.push(game);
    else byMonth.set(month, [game]);
  }
  return {
    total: aggregate(archived),
    months: [...byMonth.keys()].sort().map((month) => ({
      month,
      ...aggregate(byMonth.get(month)!),
    })),
    undated,
  };
}
