import { test } from "node:test";
import assert from "node:assert/strict";
import { Lexicon } from "../shared/lexicon";
import { rackPoints } from "../shared/endgame";
import { emptyBoard, type BoardTemplate } from "../shared/model";
import { PRESETS } from "../shared/presets";
import { solve } from "../shared/solver";
import { TILE_SYMBOLS } from "../shared/tile-pool";
import {
  analyzeMoves,
  type AnalysisProgress,
  placeTiles,
  weightedDraws,
} from "../shared/move-analysis";

function template(counts: Record<string, number>): BoardTemplate {
  return {
    ...PRESETS[0],
    size: 5,
    start: 12,
    premiums: Array(25).fill(""),
    rackSize: 2,
    tileCounts: Object.fromEntries(
      TILE_SYMBOLS.map((symbol) => [symbol, counts[symbol] ?? 0]),
    ),
  };
}

test("exact draws count physical copies and distinct unordered combinations", () => {
  assert.deepEqual(weightedDraws([..."AAAB"], 2), [
    { draw: "AA", weight: 3 },
    { draw: "AB", weight: 3 },
  ]);
});

test("bingo odds weight the refill and preserve the input position", (t) => {
  const board = emptyBoard(5);
  board[12] = "A";
  const rack = "TX";
  const layout = template({ A: 1, T: 1, X: 1, E: 2, O: 1 });
  const dict = new Lexicon(["AT", "AXE"]);
  const at = solve(dict, board, rack, layout).find(
    (move) => move.direction === "across",
  )!;
  const request = {
    board,
    rack,
    template: layout,
    candidates: [at],
    bagSize: 1,
    trials: 30,
    seed: 14,
  };
  const updates: AnalysisProgress[] = [];
  const result = analyzeMoves(dict, request, undefined, (progress) =>
    updates.push(progress),
  );
  assert.deepEqual(updates[0], { phase: "draws", completed: 0, total: 2 });
  assert.deepEqual(updates[1], { phase: "draws", completed: 2, total: 2 });
  assert.deepEqual(updates.at(-1), {
    phase: "scenarios",
    completed: 30,
    total: 30,
  });
  assert.equal(result.forecasts[0].bingo, 2 / 3);
  assert.deepEqual(result.forecasts[0].bingoDraws, ["E"]);
  assert.equal(result.forecasts[0].exact, true);
  assert.equal(result.opponentRackSize, 2);
  assert.equal(result.trials, 30);
  assert.equal(board.filter(Boolean).join(""), "A");
  assert.deepEqual(analyzeMoves(dict, request, undefined), result);

  const next = placeTiles(board, at);
  const bingos = solve(dict, next, "XE", layout, {}, { bingoOnly: true });
  assert.equal(bingos.length, 1);
  assert.equal(bingos[0].word, "AXE");
  assert.equal(bingos[0].tiles.length, 2);
  assert.deepEqual(
    solve(dict, next, "XO", layout, {}, { bingoOnly: true }),
    [],
  );

  // A coarse clock can return the same value across multiple reads. At this
  // timestamp, adding and subtracting the search cap rounds above the cap.
  t.mock.method(performance, "now", () => 913 / 19);
  assert.deepEqual(analyzeMoves(dict, request, undefined), result);
});

test("paired opponent racks reveal a blocked 40+ threat and an exact endgame line", () => {
  const board = emptyBoard(5);
  board[12] = "A";
  const rack = "TS";
  const layout = template({ A: 1, T: 1, S: 1, Z: 1 });
  layout.premiums[17] = "QW";
  const dict = new Lexicon(["AT", "AS", "AZ"]);
  const legal = solve(dict, board, rack, layout).filter(
    (move) => move.word === "AT" && move.row === 2 && move.col === 2,
  );
  const across = legal.find((move) => move.direction === "across")!;
  const down = legal.find((move) => move.direction === "down")!;
  const request = {
    board,
    rack,
    template: layout,
    candidates: [across, down],
    bagSize: 0,
    trials: 10,
    seed: 18,
  };
  const result = analyzeMoves(dict, request, undefined);
  const [open, block] = result.forecasts;
  assert.equal(open.bigAvailable, 1);
  assert.equal(open.availableExample?.score, 44);
  assert.equal(open.models.strong.nextScore, 0, "opponent goes out");
  assert.equal(block.bigAvailable, 0);
  assert.equal(block.bigThreatRemoved, 1);
  assert.equal(block.bigThreatOpened, 0);
  assert.equal(open.endgame?.spread, across.score - 44 - 2);
  assert.equal(open.endgame?.line[1]?.word, "AZ");
  assert.ok(block.endgame!.spread > open.endgame!.spread);

  const [cached, searched] = analyzeMoves(
    dict,
    { ...request, cachedEndgames: { [across.id]: open.endgame! } },
    undefined,
  ).forecasts;
  assert.strictEqual(cached.endgame, open.endgame);
  assert.deepEqual(searched.endgame, block.endgame);
});

test("Analyze returns a full line for every ruleset with an empty bag", () => {
  const board = emptyBoard(5);
  board[12] = "A";
  const dict = new Lexicon(["AT", "AZ"]);
  for (const rules of [
    "scrabble",
    "wwf",
    "wordfeud",
    "lexulous",
    "crossplay",
  ] as const) {
    const layout = { ...template({ A: 1, T: 1, Z: 1 }), rules };
    const [candidate] = solve(dict, board, "T", layout);
    const request = {
      board,
      rack: "T",
      template: layout,
      candidates: [candidate],
      bagSize: 0,
      trials: 5,
      seed: 4,
    };
    const [forecast] = analyzeMoves(dict, request, undefined).forecasts;
    const result = forecast.endgame;
    assert.ok(result, rules);
    if (rules === "crossplay") {
      assert.equal(result.line[1]?.word, "AZ");
      assert.equal(result.spread, candidate.score - result.line[1]!.score);
      const [last] = analyzeMoves(
        dict,
        { ...request, opponentHasFinalTurn: false },
        undefined,
      ).forecasts;
      assert.deepEqual(last.endgame?.line, [candidate]);
      assert.equal(last.models.strong.swing, candidate.score);
    } else {
      assert.deepEqual(result.line, [candidate]);
      const points = rackPoints("Z", rules);
      assert.deepEqual(result.points, {
        you: candidate.score + points,
        opponent: -points,
      });
    }
  }
});

test("last-play weighting uses a legal recorded move and disables unweighted exact odds", () => {
  const previousBoard = emptyBoard(5);
  const board = [...previousBoard];
  board[12] = "A";
  board[13] = "T";
  const rack = "XE";
  const layout = template({ A: 1, T: 1, X: 1, E: 3, O: 2 });
  const dict = new Lexicon(["AT", "AXE"]);
  const axe = solve(dict, board, rack, layout)[0];
  const request = {
    board,
    rack,
    template: layout,
    candidates: [axe],
    bagSize: 2,
    trials: 20,
    seed: 14,
    previousBoard,
  };
  const result = analyzeMoves(dict, request, undefined);
  assert.equal(result.inferred, true);
  assert.equal(result.forecasts[0].exact, false);
  assert.equal(result.effectiveTrials, result.trials);
  const invalid = [...previousBoard];
  invalid[0] = "A";
  assert.throws(
    () => analyzeMoves(dict, { ...request, previousBoard: invalid }, undefined),
    /last board edit/,
  );
});
