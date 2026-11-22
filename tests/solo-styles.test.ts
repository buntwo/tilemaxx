import assert from "node:assert/strict";
import { test } from "node:test";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard, type Premium } from "../shared/model";
import { PRESETS } from "../shared/presets";
import type { SoloSimulatedStyle } from "../shared/simulated-styles";
import { createSoloStyleSearch } from "../shared/solo-styles";
import { solve } from "../shared/solver";
import { TILE_SYMBOLS } from "../shared/tile-pool";
import { createTripleWordLaneAdjustment } from "../shared/triple-word-lanes";

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
    assert.equal(utility.total, 1);
    assert.equal(utility.exact, true);
  }
});

test("solo Greedy Bingo prefers the higher chance of a bingo next turn", () => {
  const ranked = rank("greedy-bingo", ["AB", "AQ", "ABD", "ABE", "AQD"], 2, "BQ", "DE");
  const best = ranked[0];
  const higherExpectedScore = ranked.find(({ move }) => move.word === "AB");
  assert.equal(best.move.word, "AQ");
  assert.equal(best.utility.kind, "solo-bingo");
  assert.equal(best.utility.bingoChance, 1);
  assert.equal(best.utility.total, 1);
  assert.equal(higherExpectedScore?.utility.kind, "solo-bingo");
  assert.equal(higherExpectedScore.utility.bingoChance, 0.5);
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

test("Triple Threat adds placement points and weighted bingo odds, with available bingos first", () => {
  const [best] = rank("triple-threat", ["AB", "AQ", "ABD", "ABE", "AQD"], 2, "BQ", "DE");
  assert.equal(best.move.word, "AQ");
  assert.equal(best.utility.kind, "solo-triple-threat");
  assert.equal(best.utility.bingoChance, 1);
  assert.equal(best.utility.bingoPoints, 80);
  assert.equal(best.utility.lanePoints, 0);
  assert.ok(Math.abs(best.utility.total - (best.move.score + 80)) < 1e-9);

  const [bingo] = rank("triple-threat", ["AB", "ABC", "ABCD", "ABCDE"], 2, "BC", "DE");
  assert.equal(bingo.move.word, "ABC");
  assert.equal(bingo.utility.kind, "solo-triple-threat");
  assert.equal(bingo.utility.bingoNow, true);
});

const cornerTriple = { ...PRESETS[0], premiums: PRESETS[0].premiums.map<Premium>((_, i) => i === 0 ? "TW" : "") };

test("Triple Threat can give up points now to keep access to an unused triple-word square", () => {
  const lexicon = new Lexicon(["AX", "BX", "XT", "UT"]);
  const board = emptyBoard(cornerTriple.size);
  board[1] = "A";
  const rack = "BXTCDEF";
  const moves = solve(lexicon, board, rack, cornerTriple);
  const search = createSoloStyleSearch(lexicon, { board, rack, template: cornerTriple }, moves, "triple-threat");
  for (const _ of search.steps) { /* complete the search */ }
  const { ranked, limited } = search.result();
  assert.equal(limited, false);
  assert.equal(moves[0].word, "BX");
  assert.equal(moves[0].score, 20);
  assert.equal(ranked[0].move.word, "XT");
  assert.equal(ranked[0].move.score, 18);
  const blocked = ranked.find(({ move }) => move.id === moves[0].id)?.utility;
  assert.equal(blocked?.kind, "solo-triple-threat");
  assert.ok(Math.abs(blocked.lanePoints + 6.4) < 1e-9);
});

test("Triple Threat penalizes blocking an unused triple-word lane and fades as the bag empties", () => {
  const lexicon = new Lexicon(["AX", "AXE"]);
  const open = emptyBoard(cornerTriple.size);
  open[1] = "A";
  const blocked = [...open];
  blocked[cornerTriple.size] = "Q";
  const spent = [...open];
  spent[0] = "X";

  const lane = createTripleWordLaneAdjustment(lexicon, cornerTriple, open, 28);
  assert.ok(lane);
  assert.equal(lane(open), 0);
  assert.equal(lane(spent), 0);
  assert.ok(Math.abs(lane(blocked) + 0.08) < 1e-9);
  const late = createTripleWordLaneAdjustment(lexicon, cornerTriple, open, 14);
  assert.ok(late);
  assert.equal(late(blocked), lane(blocked) / 3);
  assert.equal(createTripleWordLaneAdjustment(lexicon, cornerTriple, open, 7), undefined);
});
