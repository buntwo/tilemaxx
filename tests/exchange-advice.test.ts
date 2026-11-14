import assert from "node:assert/strict";
import { test } from "node:test";
import {
  exchangeAdvicePlays,
  recommendExchange,
} from "../shared/exchange-advice";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard } from "../shared/model";
import { PRESETS } from "../shared/presets";
import { solvePosition } from "../shared/solver";
import { TILE_SYMBOLS } from "../shared/tile-pool";

const counts: Record<string, number> = { A: 12, T: 12, V: 1, W: 1 };
const template = {
  ...PRESETS[0],
  rackSize: 2,
  tileCounts: Object.fromEntries(
    TILE_SYMBOLS.map((tile) => [tile, counts[tile] ?? 0]),
  ),
};
const position = { board: emptyBoard(15), rack: "V.W" };

test("recommends the occupied slots of an unplayable rack when exchanging beats passing", () => {
  const lexicon = new Lexicon(["AT", "TA"]);
  const plays = exchangeAdvicePlays(position, template, []);
  assert.deepEqual(plays, []);
  const result = recommendExchange(lexicon, {
    ...position,
    template,
    plays: plays!,
  });
  assert.deepEqual(result?.slots, [0, 2]);
  assert.ok(result.edge > 20);
  assert.equal(result.comparedWith, undefined);
});

test("withholds suggestions for ties, strong plays, held tiles and an ineligible bag", () => {
  const tie = new Lexicon(["AN"]);
  assert.equal(
    recommendExchange(tie, {
      ...position,
      template,
      plays: [],
    }),
    undefined,
  );

  const lexicon = new Lexicon(["VW"]);
  const moves = solvePosition(lexicon, position, template);
  assert.ok(moves[0].score > 24);
  assert.equal(exchangeAdvicePlays(position, template, moves), undefined);
  assert.equal(
    exchangeAdvicePlays({ ...position, excludedRackSlots: [0] }, template, []),
    undefined,
  );
  assert.equal(
    exchangeAdvicePlays({ ...position, rack: "V" }, template, []),
    undefined,
  );
  assert.equal(
    exchangeAdvicePlays({ ...position, rack: "VV" }, template, []),
    undefined,
  );
  const fewRemaining = {
    ...template,
    tileCounts: { ...template.tileCounts, A: 4, T: 4 },
  };
  assert.equal(exchangeAdvicePlays(position, fewRemaining, []), undefined);
});

test("a playable weak rack can still beat a swap by taking points now", () => {
  const lexicon = new Lexicon(["AT", "TA", "VW"]);
  const rules = { ...template, bingo: 0 };
  const moves = solvePosition(lexicon, position, rules);
  const plays = exchangeAdvicePlays(position, rules, moves);
  assert.equal(plays?.[0].score, 16);
  assert.equal(
    recommendExchange(lexicon, {
      ...position,
      template: rules,
      plays: plays!,
    }),
    undefined,
  );
});
