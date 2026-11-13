import assert from "node:assert/strict";
import { test } from "node:test";
import { simulateExchange } from "../shared/exchange";
import { playTrackedMove, scorePlacement } from "../shared/game-scoring";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard, redo, undo, type Game } from "../shared/model";
import { PRESETS } from "../shared/presets";
import { solve, solvePosition } from "../shared/solver";
import { TILE_SYMBOLS } from "../shared/tile-pool";
import {
  reviewOpportunity,
  reviewTurn,
  reviewTurns,
} from "../shared/turn-review";
import { gameSchema } from "../server/validation";

test("exchange uses exact physical weights and cannot redraw the only exchanged copy", () => {
  const tileCounts = Object.fromEntries(
    TILE_SYMBOLS.map((symbol) => [symbol, 0]),
  );
  Object.assign(tileCounts, { A: 2, T: 3, E: 1, Z: 5 });
  const template = { ...PRESETS[0], rackSize: 2, bingo: 50, tileCounts };
  const board = emptyBoard(15);
  const lexicon = new Lexicon(["AT", "AZ"]);
  const position = { board, rack: "AE", slots: [1], bag: 8, template };
  const result = simulateExchange(lexicon, position);
  assert.equal(result.exact, true);
  assert.equal(result.bingo, 8 / 9);
  assert.equal(result.playable, 8 / 9);
  assert.equal(result.score, (3 * 54 + 5 * 72) / 9);
  assert.ok(result.examples.every((example) => !example.rack.includes("E")));
  assert.throws(
    () => simulateExchange(lexicon, { ...position, bag: 6 }),
    /bag count/,
  );
  assert.throws(
    () => simulateExchange(lexicon, { ...position, slots: [0, 0] }),
    /occupied/,
  );
  assert.deepEqual(board, emptyBoard(15));
});

test("review snapshots survive storage and distinguish a missed bingo from the chosen score", () => {
  const template = { ...PRESETS[0], rackSize: 3 };
  const game: Game = {
    id: "g",
    profileId: "p",
    name: "Test",
    dictionaryId: "test",
    board: emptyBoard(15),
    rack: "CA?",
    template,
    past: [],
    future: [],
    archived: false,
    revision: 0,
    updatedAt: "",
  };
  const lexicon = new Lexicon(["AT", "CAT"]);
  const actual = solve(lexicon, game.board, game.rack, template).find(
    (move) => move.word === "AT",
  )!;
  const saved = gameSchema.parse(
    JSON.parse(JSON.stringify(playTrackedMove(game, actual))),
  );
  const [{ position, move }] = reviewTurns(saved);
  assert.equal(position?.rack, "CA?");
  assert.deepEqual(position?.board, game.board);
  const alternatives = reviewTurn(lexicon, position!, template);
  const opportunity = reviewOpportunity(
    alternatives,
    move,
    template,
    position!.tiles.length,
  );
  assert.equal(opportunity.bingo?.word, "CAT");
  const bingo = opportunity.bingo!;
  const after = [...game.board];
  for (const tile of bingo.tiles) after[tile.index] = tile.letter;
  const breakdown = scorePlacement(
    game.board,
    after,
    template,
    bingo.direction,
  )!;
  assert.equal(breakdown.score, bingo.score);
  assert.equal(breakdown.bonus, 50);
  assert.equal(breakdown.words[0].tiles.filter((tile) => tile.blank).length, 1);
  assert.ok(breakdown.words[0].tiles.some((tile) => tile.premium));
});

test("turn review respects recorded rack exclusions and retains held letters in the leave", () => {
  const game: Game = {
    id: "g",
    profileId: "p",
    name: "Test",
    dictionaryId: "test",
    board: emptyBoard(15),
    rack: "A.ZT",
    excludedRackSlots: [2],
    template: PRESETS[0],
    past: [],
    future: [],
    archived: false,
    revision: 0,
    updatedAt: "",
  };
  const lexicon = new Lexicon(["AT", "ZA"]);
  const expected = solvePosition(lexicon, game, game.template);
  assert.ok(expected.length > 0);
  assert.ok(
    expected.every(({ word, leave }) => word === "AT" && leave === "Z"),
  );
  assert.equal(
    solve(lexicon, game.board, game.rack, game.template)[0].word,
    "ZA",
  );

  const saved = gameSchema.parse(
    JSON.parse(JSON.stringify(playTrackedMove(game, expected[0]))),
  );
  for (const version of [saved, redo(undo(saved))]) {
    const [{ position, move }] = reviewTurns(version);
    assert.deepEqual(position?.excludedRackSlots, [2]);
    const alternatives = reviewTurn(lexicon, position!, game.template);
    assert.deepEqual(alternatives, expected);
    assert.equal(
      reviewOpportunity(alternatives, move, game.template, 2).gap,
      0,
    );
  }

  const move = saved.trackedMoves![0];
  const oldSnapshot = { ...move.review!, excludedRackSlots: undefined };
  for (const review of [oldSnapshot, undefined]) {
    const legacy = {
      ...saved,
      past: saved.past.map((entry) => ({ ...entry, review })),
      trackedMoves: [{ ...move, review }],
    };
    const [{ position }] = reviewTurns(legacy);
    assert.deepEqual(position?.excludedRackSlots, [2]);
    assert.deepEqual(reviewTurn(lexicon, position!, game.template), expected);
  }
  const [{ position: onlySnapshot }] = reviewTurns({
    ...saved,
    past: [],
    trackedMoves: [{ ...move, review: oldSnapshot }],
  });
  assert.equal(onlySnapshot?.excludedRackSlots, undefined);
  assert.equal(reviewTurn(lexicon, onlySnapshot!, game.template)[0].word, "ZA");

  for (const slots of [[1], [2, 2], [4]]) {
    const invalid = {
      ...saved,
      trackedMoves: [
        { ...move, review: { ...move.review!, excludedRackSlots: slots } },
      ],
    };
    assert.equal(gameSchema.safeParse(invalid).success, false);
  }
});
