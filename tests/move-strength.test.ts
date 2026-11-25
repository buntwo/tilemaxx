import assert from "node:assert/strict";
import { test } from "node:test";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard } from "../shared/model";
import { analyzeMoveStrength, type MoveStrengthTurn } from "../shared/move-strength";
import { PRESETS } from "../shared/presets";
import { solve } from "../shared/solver";
import { TILE_SYMBOLS } from "../shared/tile-pool";

const template = PRESETS[0];
const board = emptyBoard(template.size);
const lexicon = new Lexicon(["CAT", "CATS"]);
const rack = "CATSINE";
const moves = solve(lexicon, board, rack, template);
const best = moves[0];
const cat = moves.find(({ word, direction, tiles }) =>
  word === "CAT" && direction === "across" && tiles[0].index === 111,
)!;
const turn: MoveStrengthTurn = {
  number: 1,
  player: "you",
  word: cat.word,
  score: cat.score,
  position: { board, rack, dictionaryId: "test", tiles: cat.tiles, direction: cat.direction },
};

test("move strength compares against the highest legal score without rack marks", () => {
  assert.ok(best.score > turn.score);
  const results = analyzeMoveStrength(lexicon, [
    { ...turn, position: { ...turn.position, excludedRackSlots: [3], requiredRackSlots: [6] } },
    {
      ...turn, number: 2, word: best.word, score: best.score,
      position: { ...turn.position, tiles: best.tiles, direction: best.direction },
    },
  ], template);
  assert.deepEqual(results, {
    1: { best: best.score, percent: Math.round(1000 * turn.score / best.score) / 10 },
    2: { best: best.score, percent: 100 },
  });
});

test("move strength skips a missing rack, unknown letters, mismatched scores, and an exhausted search budget", () => {
  assert.deepEqual(analyzeMoveStrength(lexicon, [
    { ...turn, position: { ...turn.position, rack: "CAT" } },
    { ...turn, number: 2, player: "opponent", position: { ...turn.position, rack: undefined, observerRack: "ADEEIOU" } },
    { ...turn, number: 3, score: 3 },
  ], template), {});
  assert.deepEqual(analyzeMoveStrength(new Lexicon(["CATS"]), [turn], template), {});
  assert.deepEqual(analyzeMoveStrength(lexicon, [turn], template, 0), {});
});

test("move strength uses a short opponent rack established by the endgame tile pool", () => {
  const observerRack = "EIN";
  const shortRack = "CATS";
  const tiles = shortRack + observerRack;
  const endgame = {
    ...template,
    tileCounts: Object.fromEntries(TILE_SYMBOLS.map((tile) => [
      tile, [...tiles].filter((symbol) => tile === symbol).length,
    ])),
  };
  const opponent: MoveStrengthTurn = {
    ...turn, player: "opponent", position: { ...turn.position, rack: undefined, observerRack },
  };
  assert.deepEqual(analyzeMoveStrength(lexicon, [opponent], endgame),
    analyzeMoveStrength(lexicon, [{ ...opponent, position: { ...opponent.position, rack: shortRack } }], endgame));
  assert.equal(analyzeMoveStrength(lexicon, [opponent], endgame)[1]?.best, best.score);
});
