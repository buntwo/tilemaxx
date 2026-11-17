import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareEndgameEstimate } from "../shared/endgame-estimate";
import { solveEmptyBag } from "../shared/endgame";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard, type BoardTemplate } from "../shared/model";
import { placeTiles } from "../shared/move-analysis";
import { PRESETS } from "../shared/presets";
import { SearchLimitError, solve } from "../shared/solver";
import { TILE_SYMBOLS } from "../shared/tile-pool";

function fixture(
  rack: string,
  opponent: string,
  preset = PRESETS.find((p) => p.rules === "lexulous")!,
) {
  const physical = "A" + rack + opponent;
  const template: BoardTemplate = {
    ...preset,
    size: 5,
    start: 12,
    rackSize: 4,
    bingo: 0,
    additionalBonuses: undefined,
    premiums: Array(25).fill(""),
    tileCounts: Object.fromEntries(
      TILE_SYMBOLS.map((tile) => [
        tile,
        [...physical].filter((letter) => letter === tile).length,
      ]),
    ),
  };
  template.premiums[7] = "TW";
  template.premiums[13] = "DL";
  const board = emptyBoard(5);
  board[12] = "A";
  return { board, rack, template, bagSize: 0, scorelessTurns: 0 };
}

const lexicon = new Lexicon([
  "AT",
  "IT",
  "TI",
  "AA",
  "AI",
  "AIT",
  "TA",
  "TAT",
  "TIT",
  "IN",
  "ON",
  "NO",
  "NOT",
  "TO",
  "TOO",
  "TOT",
  "TAN",
  "ANT",
  "AN",
  "NA",
  "NAN",
  "NAT",
  "NIT",
  "TIN",
  "ANI",
]);

test("the fast estimate sees beyond our counterplay and keeps selective results approximate", () => {
  const position = fixture("INOT", "AAT");
  const candidate = solve(
    lexicon,
    position.board,
    position.rack,
    position.template,
  ).find((move) => move.id === "7:N,8:I,9:T")!;
  assert.ok(candidate);
  const result = prepareEndgameEstimate(lexicon, position)(candidate, Infinity);
  // The former three-ply estimator returned +7 for this position.
  assert.equal(result.spread, -2);
  assert.equal(result.exact, false);
  assert.deepEqual(result.reply, { word: "AA", score: 7, goesOut: false });
  const full = solveEmptyBag(
    position.board,
    candidate,
    "AAT",
    position.template,
    position,
    (board, rack) =>
      solve(lexicon, board, rack, position.template, {}, { unsorted: true }),
    placeTiles,
    { timeLimitMs: Infinity, positionLimit: Infinity },
  );
  assert.equal(full.spread, -3);
  assert.ok(Math.abs(result.spread - full.spread) <= 1);
});

test("passing to the game end uses the active rack penalties across scoring rules", () => {
  const dictionary = new Lexicon(["AT"]);
  for (const preset of PRESETS.filter((p) => p.rules !== "crossplay")) {
    const position = fixture("TZ?", "Q", preset);
    const candidate = solve(
      dictionary,
      position.board,
      position.rack,
      position.template,
    ).find((move) => move.tiles[0].letter === "T")!;
    assert.ok(candidate);
    const result = prepareEndgameEstimate(dictionary, position)(
      candidate,
      Infinity,
    );
    const full = solveEmptyBag(
      position.board,
      candidate,
      "Q",
      position.template,
      position,
      (board, rack) => solve(dictionary, board, rack, position.template),
      placeTiles,
      { timeLimitMs: Infinity, positionLimit: Infinity },
    );
    assert.equal(result.spread, full.spread, preset.rules);
    assert.equal(result.exact, false);
  }
});

test("a deadline interrupts the beam without poisoning later candidates or mutating the root", () => {
  const position = fixture("INOT", "AAT");
  const original = structuredClone(position);
  const candidates = solve(
    lexicon,
    position.board,
    position.rack,
    position.template,
  ).slice(0, 8);
  const estimate = prepareEndgameEstimate(lexicon, position);
  assert.throws(() => estimate(candidates[0], 0), SearchLimitError);
  const results = new Map(
    candidates.map((move) => [move.id, estimate(move, Infinity)]),
  );
  for (const move of [...candidates].reverse())
    assert.deepEqual(estimate(move, Infinity), results.get(move.id));
  assert.deepEqual(position, original);
  // Expiring the optional dictionary-preparation budget falls back to the full
  // dictionary; it must not turn an incomplete filter into a smaller game.
  const fallback = prepareEndgameEstimate(lexicon, position, 0);
  for (const move of candidates)
    assert.deepEqual(fallback(move, Infinity), results.get(move.id));
});
