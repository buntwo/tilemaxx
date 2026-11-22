import assert from "node:assert/strict";
import { test } from "node:test";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard, type Premium } from "../shared/model";
import { PRESETS } from "../shared/presets";
import type { SoloSimulatedStyle } from "../shared/simulated-styles";
import { createSoloStyleSearch } from "../shared/solo-styles";
import { solve } from "../shared/solver";
import { TILE_SYMBOLS } from "../shared/tile-pool";

function rank(style: SoloSimulatedStyle, words: string[], rackSize: number, rack: string, bag: string) {
  const preset = PRESETS[0];
  const template = {
    ...preset,
    rackSize,
    bingo: 0,
    premiums: preset.premiums.map<Premium>(() => ""),
    tileCounts: Object.fromEntries(TILE_SYMBOLS.map((tile) => [tile, Number(("A" + rack + bag).includes(tile))])),
  };
  const board = emptyBoard(template.size);
  board[template.start] = "A";
  const lexicon = new Lexicon(words);
  const moves = solve(lexicon, board, rack, template);
  const search = createSoloStyleSearch(lexicon, { board, rack, template }, moves, style);
  for (const _ of search.steps) { /* complete the search */ }
  const { ranked, limited } = search.result();
  assert.equal(limited, false);
  return ranked;
}

test("solo Greedy Bingo checks legal bingos through existing letters", () => {
  const ranked = rank("greedy-bingo", ["ABCD", "AE"], 3, "BCE", "D");
  assert.ok(ranked.length);
  for (const { move, utility } of ranked) {
    assert.equal(move.word, "AE");
    assert.equal(utility.kind, "solo-bingo");
    assert.equal(utility.bingoNow, false);
    assert.equal(utility.bingoChance, 1);
    assert.equal(utility.exact, true);
  }
});

test("Triple Play weights both future scores and can choose a smaller play", () => {
  const ranked = rank("triple-play", ["AB", "ABC", "ABCD", "ABCDE"], 2, "BC", "DE");
  assert.equal(ranked[0].move.word, "AB");
  assert.deepEqual(ranked[0].utility, {
    kind: "solo-points",
    score: 4,
    nextPoints: 8,
    followUpPoints: 10,
    total: 22,
    samples: 2,
    exact: true,
  });
  const greedy = rank("greedy-bingo", ["AB", "ABC", "ABCD", "ABCDE"], 2, "BC", "DE");
  assert.equal(greedy[0].move.word, "ABC");
});
