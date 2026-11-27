import assert from "node:assert/strict";
import { test } from "node:test";
import { archiveStatistics } from "../shared/archive-stats";
import { summarizeGame } from "../shared/game-index";
import { emptyScoring, playTrackedMove, recordBoardlessTurn } from "../shared/game-scoring";
import { Lexicon } from "../shared/lexicon";
import { archiveGame, emptyBoard, type Game } from "../shared/model";
import { PRESETS } from "../shared/presets";
import { solve } from "../shared/solver";

const base: Game = {
  id: "g",
  profileId: "p",
  name: "Archive test",
  template: PRESETS[0],
  dictionaryId: "test",
  board: emptyBoard(15),
  rack: "RETINAS",
  past: [],
  future: [],
  revision: 0,
  updatedAt: "",
  archived: false,
  startedOn: "2026-01-30",
};

test("archive stats use saved results and complete plays, and group by finish date first", () => {
  const [move] = solve(
    new Lexicon(["RETINAS"]),
    base.board,
    base.rack,
    base.template,
  );
  const played = playTrackedMove(base, move);
  const won = archiveGame({
    ...played,
    scoring: {
      ...played.scoring!,
      end: {
        manual: true,
        scores: { you: 410, opponent: 375 },
        endedOn: "2026-02-02",
      },
    },
  });
  const lost = archiveGame({
    ...base,
    id: "loss",
    trackScores: false,
    scoring: {
      ...emptyScoring(true),
      end: { manual: true, scores: { you: 300, opponent: 350 } },
    },
  });
  const solo = archiveGame({
    ...base,
    id: "solo",
    solo: true,
    startedOn: undefined,
    scoring: {
      ...emptyScoring(),
      end: { manual: true, scores: { you: 80, opponent: 0 } },
    },
  });
  const unfinished = archiveGame({
    ...base,
    id: "unfinished",
    scoring: emptyScoring(),
  });
  const sandbox = summarizeGame({
    ...won,
    board: base.board,
    scoring: emptyScoring(),
  });
  assert.deepEqual(sandbox.archiveStats, {
    outcome: "win",
    finalScore: 410,
    margin: 35,
    plays: played.scoring!.you,
  });
  const { total, months, undated } = archiveStatistics([
    summarizeGame(base),
    sandbox,
    ...[lost, solo, unfinished].map(summarizeGame),
  ]);
  assert.equal(total.games, 4);
  assert.equal(total.scored, 3);
  assert.equal(total.averageScore, (410 + 300 + 80) / 3);
  assert.equal(total.highScore, 410);
  assert.deepEqual(total.record, { win: 1, loss: 1, tie: 0 });
  assert.equal(total.winRate, 50);
  assert.equal(total.averageMargin, -7.5);
  assert.equal(total.withPlays, 1);
  assert.equal(total.pointsPerPlay, move.score);
  assert.equal(total.averageBingos, 1);
  assert.equal(total.bestPlay, move.score);
  assert.equal(undated, 1);
  assert.deepEqual(
    months.map(({ month, games, winRate }) => ({ month, games, winRate })),
    [
      { month: "2026-01", games: 2, winRate: 0 },
      { month: "2026-02", games: 1, winRate: 100 },
    ],
  );
});

test("cached archive summaries retain old final scores and ties without inventing play stats", () => {
  const legacy = summarizeGame(archiveGame(base));
  delete legacy.archiveStats;
  legacy.score = { you: 290, opponent: 290, outcome: "tie" };
  const { total } = archiveStatistics([legacy]);
  assert.equal(total.results, 1);
  assert.equal(total.record.tie, 1);
  assert.equal(total.winRate, 0);
  assert.equal(total.averageMargin, 0);
  assert.equal(total.highScore, 290);
  assert.equal(total.averageBingos, undefined);
});

test("archive placement statistics exclude passes and exchanges", () => {
  const solo = { ...base, solo: true as const };
  const passed = recordBoardlessTurn(solo, "you", { kind: "pass" });
  const exchanged = recordBoardlessTurn(passed, "you", { kind: "exchange", slots: [0] });
  const [move] = solve(new Lexicon(["TIN"]), exchanged.board, exchanged.rack, exchanged.template);
  const played = playTrackedMove(exchanged, move);
  const finished = (game: Game) => summarizeGame(archiveGame({
    ...game,
    scoring: { ...game.scoring!, end: { manual: true, scores: { you: move.score, opponent: 0 } } },
  }));
  assert.equal(played.scoring?.you.moves, 3);
  const summaries = [finished(exchanged), finished(played)];
  assert.equal(summaries[0].archiveStats?.plays, undefined);
  assert.equal(summaries[1].archiveStats?.plays?.moves, 1);
  assert.equal(archiveStatistics(summaries).total.pointsPerPlay, move.score);
});
