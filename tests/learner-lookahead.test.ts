import assert from "node:assert/strict";
import { test } from "node:test";
import { rackPoints } from "../shared/endgame";
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
import { leaveValue } from "../shared/rack-leave";
import { solvePosition } from "../shared/solver";
import { TILE_SYMBOLS } from "../shared/tile-pool";

function fixture(bagSize = 86, ruleset = PRESETS[0], opponent = "AEINRST") {
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
  const rack = ruleset.rackSize === 8 ? "ABCQRSTE" : "ABCQRST";
  const stock = rack + opponent + "A".repeat(bagSize);
  const template = bagSize === 86 && ruleset === PRESETS[0] ? ruleset : {
    ...ruleset,
    tileCounts: Object.fromEntries(TILE_SYMBOLS.map((symbol) => [symbol, [...stock].filter((c) => c === symbol).length])),
  };
  const position = {
    board: emptyBoard(template.size),
    rack,
    bagSize,
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
    template,
    lexicon,
    choose,
    moves,
    evaluate,
    ranked: decision.considered!,
    slate: decision.learnerSlate!,
  };
}

test("Learner compares three placements on 32 complete shared lines", () => {
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

  assert.equal(comparisons, 3 * 32);
  const first = result.value.ranked[0];
  const evaluated = result.value.ranked.filter(({ utility }) => utility.lookahead !== undefined);
  for (const { utility } of evaluated) {
    assert.equal(utility.lookaheadDeals, 32);
    assert.equal(utility.followUpDeals, undefined);
    assert.ok(utility.modeledFollowUp !== undefined);
  }
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

test("Learner compares 32 complete lines when the bag can empty on the play", () => {
  const { position, evaluate, ranked, slate } = fixture(1);
  const work = evaluate({ ...position, requiredRackSlots: [0] }, ranked, slate, Infinity);
  let count = 0;
  let step = work.next();
  while (!step.done) {
    count++;
    step = work.next();
  }
  assert.equal(count, 3 * 32);
  assert.equal(step.value.ranked[0].utility.lookaheadDeals, 32);
});

test("Learner evaluates 32 Lexulous lines and counts rack deductions after two passes", () => {
  const lexulous = PRESETS.find(({ id }) => id === "lexulous")!;
  const { position, lexicon, template, ranked } = fixture(42, lexulous, "AAAAAAAA");
  const pointsAfterDraw = (move: typeof ranked[number]["move"]) =>
    rackPoints(move.leave + "A".repeat(move.tiles.length), template.rules);
  const byRackPoints = new Map(ranked.map(({ move, utility }) =>
    [pointsAfterDraw(move), { move, value: utility.total, visibility: 1 }]));
  const slate = [...byRackPoints.values()].slice(0, 3);
  assert.equal(slate.length, 3);
  const forecast = createLearnerLookahead(lexicon, template, () => ({ bingoFound: false }));
  const work = forecast(position, ranked, slate, Infinity);
  let step = work.next();
  while (!step.done) step = work.next();
  const firstRackPoints = pointsAfterDraw(slate[0].move);
  const compared = step.value.ranked.filter(({ utility }) => utility.lookaheadDeals === 32);
  assert.equal(compared.length, 3);
  assert.ok(compared.some(({ utility }) => utility.lookahead !== 0));
  for (const { move, utility } of compared) {
    assert.equal(utility.modeledReply, 0);
    assert.equal(utility.modeledFollowUp, 0);
    assert.equal(utility.lookahead, 0.55 * (firstRackPoints - pointsAfterDraw(move)));
  }
});

test("Learner uses its two-second deadline and keeps only batches all finalists finish", (t) => {
  const { position, evaluate, ranked, slate } = fixture();
  let now = 0;
  t.mock.method(performance, "now", () => now);
  for (const [deals, checkpoint] of [[6, 0], [13, 8], [22, 16]]) {
    now = 0;
    const work = evaluate({ ...position, requiredRackSlots: [0] }, ranked, slate);
    for (let current = 0; current < deals * slate.length; current++)
      assert.equal(work.next().done, false);
    now = 1_999;
    assert.equal(work.next().done, false);
    now = 2_001;
    const result = work.next();
    assert.equal(result.done, true);
    if (!result.done) throw new Error("Forecast did not finish");
    const compared = result.value.ranked.filter(({ utility }) => utility.lookaheadDeals !== undefined);
    assert.deepEqual(compared.map(({ utility }) => utility.lookaheadDeals),
      checkpoint ? [checkpoint, checkpoint, checkpoint] : []);
  }
});

test("Learner shares a distinct opponent vocabulary seed and reply choices across placements", () => {
  const { position, lexicon, template, choose, ranked, slate } = fixture();
  const seeds = new Set<number>();
  const choiceCounts = new Map<number, number>();
  const wrapped: typeof choose = (...args) => {
    const modeled = args[3]?.modeledReply;
    if (modeled) {
      seeds.add(args[2].playerSeed);
      choiceCounts.set(modeled.choiceSeed, (choiceCounts.get(modeled.choiceSeed) ?? 0) + 1);
    }
    return choose(...args);
  };
  const evaluate = createLearnerLookahead(lexicon, template, wrapped);
  for (const _ of evaluate({ ...position, requiredRackSlots: [0] }, ranked, slate, Infinity)) { /* finish forecast */ }
  assert.equal(seeds.size, 1);
  assert.ok(!seeds.has(position.playerSeed));
  assert.equal(choiceCounts.size, 32);
  assert.ok([...choiceCounts.values()].every((count) => count === 3));
});

test("the modeled Learner reply picks the best static value from three sampled ideas", () => {
  const { position, choose, moves, ranked } = fixture();
  const values = new Map(ranked.map(({ move, utility }) => [move.id, utility.total]));
  let promoted = false;
  for (const choiceSeed of [0, 28, 235, 771]) {
    const noticed = choose(moves, "learner", { ...position, seed: choiceSeed }, { topThree: true }).suggestions!;
    const best = noticed.reduce((a, b) => values.get(b.id)! > values.get(a.id)! ? b : a);
    const reply = choose(moves, "learner", position, { modeledReply: { choiceSeed } }).move;
    assert.equal(reply, best);
    promoted ||= best !== noticed[0];
  }
  assert.ok(promoted);
});

test("Casual samples three finalists and looks ahead with a ten-point half-life", () => {
  const { position, choose, moves, ranked } = fixture();
  const casual = choose(moves, "casual", position, { all: true, learnerSlate: true });
  assert.equal(LEARNER_HALF_LIFE.casual, 10);
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
  for (const { utility } of evaluated) {
    assert.equal(utility.lookaheadDeals, 8);
    assert.equal(utility.appeal, learnerAppeal(utility.total, 10));
  }
});

test("Learner checks the swap on 32 deals and reuses the placement outcomes", () => {
  const { position, evaluate, ranked, slate } = fixture();
  const steps = evaluate(position, ranked, slate, Infinity);
  let count = 0;
  let step = steps.next();
  while (!step.done) {
    count++;
    step = steps.next();
  }
  assert.equal(count, slate.length * 32 + LEARNER_EXCHANGE_DEALS);
  assert.equal(LEARNER_EXCHANGE_DEALS, 32);
  assert.equal(step.value.exchange, undefined);
  assert.equal(step.value.ranked[0].move.word, "CART");
});

test("Learner recommends a simulated exchange when the paired continuation has a clear edge", () => {
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
  // Fix the opponent's policy so the exchange edge is independently reproducible.
  const fixedReply: typeof choose = (moves, profile, position, options) => {
    if (!options?.modeledReply) return choose(moves, profile, position, options);
    const value = (move: typeof moves[number]) => move.score + (position.bagSize ? leaveValue(move.leave) : 0);
    const move = moves.length ? moves.reduce((best, next) => value(next) > value(best) ? next : best) : undefined;
    return { move, bingoFound: false };
  };
  const evaluate = createLearnerLookahead(lexicon, template, fixedReply);
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
  const { comparedPlacement, ...exchange } = step.value.exchange!;
  assert.equal(comparedPlacement?.word, "OU");
  assert.deepEqual(exchange, {
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
