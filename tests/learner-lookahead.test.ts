import assert from "node:assert/strict";
import { test } from "node:test";
import { createLearnerLookahead } from "../shared/learner-lookahead";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard } from "../shared/model";
import { createPlayerProfiles } from "../shared/player-profiles";
import { PRESETS } from "../shared/presets";
import { solvePosition } from "../shared/solver";

function fixture() {
  const words = [
    "AB",
    "ACT",
    "ACTS",
    "AR",
    "ARC",
    "ART",
    "AS",
    "AT",
    "BAR",
    "BAT",
    "CAR",
    "CARS",
    "CART",
    "CARTS",
    "CAT",
    "CATS",
    "ER",
    "ET",
    "RAT",
    "RATS",
    "RE",
    "SAT",
    "SCAR",
    "STAR",
    "START",
    "TA",
    "TAB",
    "TAR",
    "TARS",
    "TRAP",
    "TRAPS",
  ];
  const lexicon = new Lexicon(words);
  const template = PRESETS[0];
  const position = {
    board: emptyBoard(template.size),
    rack: "ABCQRST",
    bagSize: 86,
    seed: 29,
    playerSeed: 0,
  };
  const choose = createPlayerProfiles(
    lexicon,
    template,
    new Map(words.map((word) => [word, 4])),
  );
  const moves = solvePosition(lexicon, position, template);
  const decision = choose(moves, "learner", position, {
    all: true,
    learnerSlate: true,
  });
  const evaluate = createLearnerLookahead(lexicon, template, choose);
  return {
    position,
    choose,
    moves,
    evaluate,
    ranked: decision.considered!,
    slate: decision.learnerSlate!,
  };
}

test("Learner compares three visible words with eight shared deals and can change its recommendation", () => {
  const { position, evaluate, ranked, slate } = fixture();
  assert.equal(ranked[0].move.word, "CART");
  assert.deepEqual(
    slate.map(({ move }) => move.word),
    ["CART", "CARTS", "ACT"],
  );
  assert.equal(slate[0].move, ranked[0].move);

  const steps = evaluate(position, ranked, slate, Infinity);
  let comparisons = 0;
  let result = steps.next();
  while (!result.done) {
    comparisons++;
    result = steps.next();
  }

  assert.equal(comparisons, 24);
  assert.equal(result.value[0].move.word, "CARTS");
  const first = result.value[0];
  const prior = ranked.find(({ move }) => move.id === first.move.id)!;
  assert.ok(first.utility.lookahead! > 0);
  assert.equal(
    first.utility.total,
    prior.utility.total + first.utility.lookahead!,
  );
  assert.deepEqual(
    result.value
      .filter(({ utility }) => utility.lookahead !== undefined)
      .map(({ move }) => move.id)
      .sort(),
    slate.map(({ move }) => move.id).sort(),
  );
  assert.equal(result.value.length, ranked.length);
  assert.equal(prior.utility.lookahead, undefined);
});

test("Learner keeps static suggestions when the deadline or tile counts prevent a fair comparison", () => {
  const { position, evaluate, ranked, slate } = fixture();
  assert.deepEqual(evaluate(position, ranked, slate, 0).next(), {
    done: true,
    value: ranked,
  });
  const tooFewUnseen = { ...position, bagSize: 93 };
  assert.deepEqual(evaluate(tooFewUnseen, ranked, slate).next(), {
    done: true,
    value: ranked,
  });
});

test("Learner only builds a tactical shortlist for two-player recommendations with tiles in the bag", () => {
  const { position, choose, moves } = fixture();
  assert.equal(choose(moves, "learner", position).learnerSlate, undefined);
  assert.equal(
    choose(
      moves,
      "learner",
      { ...position, solo: true },
      { learnerSlate: true },
    ).learnerSlate,
    undefined,
  );
  assert.equal(
    choose(
      moves,
      "learner",
      { ...position, bagSize: 0 },
      { learnerSlate: true },
    ).learnerSlate,
    undefined,
  );
  assert.equal(
    choose(moves, "strong", position, { learnerSlate: true }).learnerSlate,
    undefined,
  );
});
