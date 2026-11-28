import assert from "node:assert/strict";
import { test } from "node:test";
import type { BingoDeal } from "../shared/bingo-replies";
import { LEARNER_REPLY_DEALS, screenLearnerReplies } from "../shared/learner-reply-screen";
import {
  createLearnerLookahead,
  LEARNER_EXCHANGE_DEALS,
} from "../shared/learner-lookahead";
import { Lexicon } from "../shared/lexicon";
import type { MasterOutcome } from "../shared/master-evaluation";
import { emptyBoard } from "../shared/model";
import {
  createPlayerProfiles, LEARNER_HALF_LIFE,
  profileWordHash,
} from "../shared/player-profiles";
import { learnerAppeal } from "../shared/player-profile-sampling";
import { PRESETS } from "../shared/presets";
import { leaveValue } from "../shared/rack-leave";
import { SearchLimitError, solvePosition } from "../shared/solver";
import { TILE_SYMBOLS } from "../shared/tile-pool";

function fixture(bagSize = 86) {
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
  const rack = "ABCQRST";
  const stock = rack + "AEINRST" + "A".repeat(bagSize);
  const template = bagSize === 86 ? PRESETS[0] : {
    ...PRESETS[0],
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

test("Learner screens three placements with 32 shared replies and uses eight follow-up draws", () => {
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

  assert.equal(comparisons, 3 * (LEARNER_REPLY_DEALS + 8));
  const first = result.value.ranked[0];
  const evaluated = result.value.ranked.filter(({ utility }) => utility.lookahead !== undefined);
  for (const { utility } of evaluated) {
    assert.equal(utility.lookaheadDeals, 32);
    assert.equal(utility.followUpDeals, 8);
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

test("Learner keeps the full eight-deal forecast when the bag can empty during the line", () => {
  const { position, evaluate, ranked, slate } = fixture(14);
  const work = evaluate({ ...position, requiredRackSlots: [0] }, ranked, slate, Infinity);
  let count = 0;
  let step = work.next();
  while (!step.done) {
    count++;
    step = work.next();
  }
  assert.equal(count, 3 * 8);
  assert.equal(step.value.ranked[0].utility.lookaheadDeals, 8);
  assert.equal(step.value.ranked[0].utility.followUpDeals, undefined);
});

test("Learner discards partial reply and follow-up batches but keeps completed checkpoints", () => {
  const deals = Array.from({ length: 32 }, (_, replySeed) => ({ opponent: "ABC", bag: "DE", replySeed }));
  const fixtureMove = fixture().slate[0].move;
  const evaluator = (score: number, interrupted = false) => Object.assign(
    (deal: BingoDeal): MasterOutcome => {
      if (interrupted && (deal.replySeed ?? 0) >= 5) throw new SearchLimitError("time");
      return { reply: score, followUp: 10, ownLeave: 0, opposingLeave: 0, rackAdjustment: 0, bingo: false, terminal: false };
    }, {
      opponentReply: (deal: BingoDeal) => {
        if (interrupted && (deal.replySeed ?? 0) >= 10) throw new SearchLimitError("time");
        return { ...fixtureMove, score };
      },
    },
  );
  const work = screenLearnerReplies([evaluator(7), evaluator(9, true)], deals, Infinity);
  let step = work.next();
  while (!step.done) step = work.next();
  assert.equal(step.value.replyDeals, 8);
  assert.deepEqual(step.value.totals, [56, 72]);
  assert.deepEqual(step.value.outcomes.map((outcomes) => outcomes.length), [4, 4]);
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
  for (const { utility } of evaluated)
    assert.equal(utility.appeal, learnerAppeal(utility.total, 10));
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
  assert.equal(count, slate.length * (LEARNER_REPLY_DEALS + 8) + LEARNER_EXCHANGE_DEALS);
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
