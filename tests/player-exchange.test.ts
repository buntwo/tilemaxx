import assert from "node:assert/strict";
import { test } from "node:test";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard } from "../shared/model";
import {
  PLAYER_EXCHANGE_SAMPLES,
  samplePlayerExchange,
  screenPlayerExchange,
} from "../shared/player-exchange";
import { PRESETS } from "../shared/presets";
import { solvePosition } from "../shared/solver";

const template = PRESETS[0];
const board = emptyBoard(template.size);
const lexicon = new Lexicon(["OI", "OU", "AA", "TA", "AT", "EAT", "TEA"]);

function fixture(rack: string, excludedRackSlots?: number[]) {
  const position = {
    board,
    rack,
    template,
    excludedRackSlots,
    bagSize: 86,
    scorelessTurns: 0,
    playerSeed: 12,
  };
  return { ...position, move: solvePosition(lexicon, position, template)[0] };
}

test("casual and learner exchange a poor rack using heuristics and keep held tiles", () => {
  const position = fixture("EIOOOUU", [0]);
  assert.ok(position.move);
  for (const profile of ["casual", "learner"] as const) {
    const result = screenPlayerExchange({ ...position, profile });
    assert.ok(result.advice);
    assert.equal(result.advice.profile, profile);
    assert.equal(result.advice.edge, undefined);
    assert.equal(result.advice.problem, "balance");
    assert.equal(result.advice.comparedWith?.word, position.move.word);
    assert.ok(!result.advice.slots.includes(0));
    assert.equal(result.comparison, undefined);
    assert.deepEqual(result, screenPlayerExchange({ ...position, profile }));
  }
});

test("casual can keep one copy of useful duplicates in a large swap", () => {
  const profile = "casual" as const;
  for (const [rack, held, expectedSwap, expectedKeep] of [
    ["AAAEEET", [], "AAEE", "AET"],
    ["EEETAAA", [], "AAEE", "AET"],
    ["AAAEEET", [0], "AAEEE", "AT"],
  ] as const) {
    const position = fixture(rack, [...held]);
    const result = screenPlayerExchange({ ...position, profile });
    assert.ok(result.advice);
    assert.equal(result.comparison, undefined);
    const { slots } = result.advice;
    assert.equal(
      slots
        .map((slot) => rack[slot])
        .sort()
        .join(""),
      expectedSwap,
    );
    assert.equal(
      [...rack]
        .filter((_, slot) => !slots.includes(slot))
        .sort()
        .join(""),
      expectedKeep,
    );
    assert.ok(held.every((slot) => !slots.includes(slot)));
  }
});

test("exchange respects the active bag and rack constraints", () => {
  const position = { ...fixture("EIOOOUU"), profile: "learner" as const };
  assert.deepEqual(
    screenPlayerExchange({ ...position, requiredRackSlots: [0] }),
    {},
  );
  assert.deepEqual(screenPlayerExchange({ ...position, bagSize: 6 }), {});
  assert.deepEqual(screenPlayerExchange({ ...position, rack: "E.OOOUU" }), {});
  assert.deepEqual(screenPlayerExchange({ ...position, rack: "QQOOOUU" }), {});
  assert.deepEqual(
    screenPlayerExchange({
      ...position,
      move: { ...position.move, score: 30 },
    }),
    {},
  );
  const fallback = screenPlayerExchange({ ...position, move: undefined });
  assert.ok(fallback.advice?.slots.length);
  assert.equal(fallback.advice.comparedWith, undefined);
});

test("strong samples 16 shared scenarios only for a close decision", () => {
  const profile = "strong" as const;
  assert.equal(
    screenPlayerExchange({ ...fixture("EIOOOUU"), profile }).comparison,
    undefined,
  );
  const { comparison } = screenPlayerExchange({
    ...fixture("AAEIOIT"),
    profile,
  });
  assert.ok(comparison);
  assert.equal(comparison.choices.length, 2);
  let calls = 0;
  const estimate = samplePlayerExchange(
    lexicon,
    (moves) => {
      calls++;
      return { move: moves[0], bingoFound: false };
    },
    comparison,
  );
  assert.ok(estimate);
  assert.equal(PLAYER_EXCHANGE_SAMPLES, 16);
  // Two opponent replies and three continuations share each scenario.
  assert.equal(calls, 5 * 16);
  assert.equal(
    samplePlayerExchange(
      lexicon,
      () => {
        assert.fail("An expired budget must stop before evaluating any rack");
      },
      comparison,
      0,
    ),
    undefined,
  );
});
