import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLearnerLookahead,
  LEARNER_EXCHANGE_DEALS,
} from "../shared/learner-lookahead";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard } from "../shared/model";
import {
  createPlayerProfiles, LEARNER_HALF_LIFE,
  profileWordHash,
} from "../shared/player-profiles";
import { learnerAppeal } from "../shared/player-profile-sampling";
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
    seed: 235,
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
  assert.equal(slate.length, 3);
  assert.equal(new Set(slate.map(({ move }) => move.word)).size, 3);
  assert.deepEqual(slate.map(({ move }) => move), ranked.slice(0, 3).map(({ move }) => move));
  assert.equal(slate[0].move, ranked[0].move);

  const steps = evaluate(
    { ...position, requiredRackSlots: [0] },
    ranked,
    slate,
    Infinity,
  );
  let comparisons = 0;
  let result = steps.next();
  while (!result.done) {
    comparisons++;
    result = steps.next();
  }

  assert.equal(comparisons, 24);
  const first = result.value.ranked[0];
  assert.notEqual(first.move.id, ranked[0].move.id);
  const evaluated = result.value.ranked.filter(({ utility }) => utility.lookahead !== undefined);
  const best = evaluated.reduce((winner, entry) =>
    entry.utility.total > winner.utility.total ||
      (entry.utility.total === winner.utility.total && entry.move.score > winner.move.score)
      ? entry
      : winner,
  );
  assert.equal(first, best);
  const prior = ranked.find(({ move }) => move.id === first.move.id)!;
  assert.equal(
    first.utility.total,
    prior.utility.total + first.utility.lookahead!,
  );
  assert.equal(first.utility.appeal, learnerAppeal(first.utility.total, LEARNER_HALF_LIFE.learner));
  assert.deepEqual(
    result.value.ranked
      .filter(({ utility }) => utility.lookahead !== undefined)
      .map(({ move }) => move.id)
      .sort(),
    slate.map(({ move }) => move.id).sort(),
  );
  assert.equal(result.value.ranked.length, ranked.length);
  assert.equal(prior.utility.lookahead, undefined);
});

test("Casual uses the Learner move pool and looks ahead with a five-point half-life", () => {
  const { position, choose, moves, ranked } = fixture();
  const casual = choose(moves, "casual", position, { all: true, learnerSlate: true });
  assert.equal(LEARNER_HALF_LIFE.casual, 5);
  assert.deepEqual(casual.considered!.map(({ move }) => move.id).sort(), ranked.map(({ move }) => move.id).sort());
  assert.equal(casual.learnerSlate!.length, 3);
  assert.equal(new Set(casual.learnerSlate!.map(({ move }) => move.word)).size, 3);
  const used = new Set<string>();
  const lexicon = new Lexicon([...new Set(moves.map((move) => move.word))]);
  const wrapped: typeof choose = (...args) => {
    used.add(args[1]);
    return choose(...args);
  };
  const forecast = createLearnerLookahead(lexicon, PRESETS[0], wrapped, "casual");
  const work = forecast({ ...position, requiredRackSlots: [0] }, casual.considered!, casual.learnerSlate!, Infinity);
  let next = work.next();
  while (!next.done) next = work.next();
  assert.deepEqual([...used], ["casual"]);
  const evaluated = next.value.ranked.filter(({ utility }) => utility.lookahead !== undefined);
  assert.equal(evaluated.length, 3);
  assert.equal(next.value.ranked[0].utility.total, Math.max(...evaluated.map(({ utility }) => utility.total)));
  for (const { utility } of evaluated)
    assert.equal(utility.appeal, learnerAppeal(utility.total, 5));
});

test("Learner checks the swap on 32 deals and reuses the first eight placement outcomes", () => {
  const { position, evaluate, ranked, slate } = fixture();
  const steps = evaluate(position, ranked, slate, Infinity);
  let count = 0;
  let step = steps.next();
  while (!step.done) {
    count++;
    step = steps.next();
  }
  assert.equal(count, 3 * 8 + LEARNER_EXCHANGE_DEALS);
  assert.equal(LEARNER_EXCHANGE_DEALS, 32);
  assert.equal(step.value.exchange, undefined);
  assert.equal(step.value.ranked[0].move.word, "CART");
});

test("Learner recommends a simulated exchange with a clear edge over a spotted play", () => {
  const template = PRESETS[0];
  const words =
    "OU FA GO HE IF NO OR OX PA RE TO UH US WE AX ON IS YE HA HI LO AL AG MA PI PE NU SI QI".split(
      " ",
    );
  const lexicon = new Lexicon(words);
  const board = emptyBoard(template.size);
  const rack = "EIOOOUU";
  const position = {
    board,
    rack,
    bagSize: 86,
    seed: profileWordHash(`${board.join(".")}:${rack}`),
    playerSeed: 0,
  };
  const choose = createPlayerProfiles(
    lexicon,
    template,
    new Map(),
    undefined,
    new Map(words.map((word) => [word, 9_000])),
  );
  const decision = choose(
    solvePosition(lexicon, position, template),
    "learner",
    position,
    {
      all: true,
      learnerSlate: true,
    },
  );
  const evaluate = createLearnerLookahead(lexicon, template, choose);
  const work = evaluate(
    position,
    decision.considered!,
    decision.learnerSlate!,
    Infinity,
  );
  let count = 0;
  let step = work.next();
  while (!step.done) {
    count++;
    step = work.next();
  }
  assert.equal(count, 8 + LEARNER_EXCHANGE_DEALS);
  assert.deepEqual(step.value.exchange, {
    slots: [0, 1, 2, 3, 4, 5, 6],
    profile: "learner",
    comparedWith: { word: "OU", score: 4 },
    problem: "balance",
    edge: 4.125,
  });
  assert.equal(
    evaluate(position, decision.considered!, decision.learnerSlate!, 0).next()
      .value?.exchange,
    undefined,
  );
  assert.ok(evaluate(position, [], [], 0).next().value?.exchange);
});

test("Learner keeps static suggestions when the deadline or tile counts prevent a fair comparison", () => {
  const { position, evaluate, ranked, slate } = fixture();
  assert.deepEqual(evaluate(position, ranked, slate, 0).next(), {
    done: true,
    value: { ranked },
  });
  const tooFewUnseen = { ...position, bagSize: 93 };
  assert.deepEqual(evaluate(tooFewUnseen, ranked, slate).next(), {
    done: true,
    value: { ranked },
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
