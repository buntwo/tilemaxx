import assert from "node:assert/strict";
import test from "node:test";
import {
  createTacticianEvaluator,
  dealUtility,
  hunterUtility,
  type TacticianOutcome,
} from "../shared/bingo-hunter";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard } from "../shared/model";
import { PRESETS } from "../shared/presets";
import { prepareSolver } from "../shared/solver";
import {
  createBingoLaneScorer,
  laneOpeningBonus,
} from "../shared/tactician-lanes";
import { createBingoHunterSession } from "../src/parallel-bingo-hunter";

const template = PRESETS[0];

test("Tactician weights complete deals and charges a reply even when there is no follow-up", () => {
  const move = { score: 20, tiles: [{ index: template.start, letter: "A" }] };
  const deals = [
    { opponent: "", bag: "", weight: 2 },
    { opponent: "", bag: "" },
    { opponent: "", bag: "" },
  ];
  const outcomes = [
    { bingo: 0, reply: 30, ordinary: 40 },
    { bingo: 80, reply: 20, ordinary: 0 },
    { bingo: 0, reply: 12, ordinary: 0 },
  ];
  const utility = hunterUtility(
    move,
    template,
    outcomes,
    deals,
    true,
    "follow-up",
  );
  assert.deepEqual(utility.tactics, { replyPoints: 23, ordinaryPoints: 20 });
  assert.equal(utility.bingoChance, 0.25);
  assert.equal(utility.nextBingoPoints, 20);
  assert.equal(utility.total, 27);
  assert.equal(
    utility.total,
    15 +
      (2 * dealUtility(outcomes[0]) +
        dealUtility(outcomes[1]) +
        dealUtility(outcomes[2])) /
        4,
  );
  const provisional = hunterUtility(
    move,
    template,
    outcomes,
    deals,
    true,
    "reply",
  );
  assert.deepEqual(provisional.tactics, { replyPoints: 23 });
  assert.equal(provisional.total, 12);
});

test("Tactician scores an ordinary follow-up and stops scoring when either player goes out", () => {
  const board = emptyBoard(template.size);
  const lexicon = new Lexicon(["AT", "CAT", "CATS", "GO", "DOG"]);
  const solver = prepareSolver(lexicon, board, template);
  for (const [rack, opponent, kind] of [
    ["ATC", "X", "continues"],
    ["ATS", "C", "opponent"],
    ["AT", "C", "self"],
  ]) {
    const move = solver.solve(rack).find((move) => move.word === "AT")!;
    const evaluate = createTacticianEvaluator(
      lexicon,
      { template, board, rack, bagSize: 0, scorelessTurns: 0 },
      move,
      true,
    );
    const outcome = evaluate({ opponent, bag: "" }, false, Infinity);
    assert.equal(outcome.bingo, 0);
    if (kind === "continues") assert.ok(outcome.ordinary > 0);
    else assert.equal(outcome.ordinary, 0);
    assert.equal(outcome.reply > 0, kind === "opponent");
  }
});

test("a bingo receives no ordinary follow-up credit", () => {
  const board = emptyBoard(template.size);
  const dictionary = new Lexicon([
    "AT",
    "AS",
    "SAT",
    "ST",
    "READING",
    "READINGS",
    "TEARING",
    "TEARINGS",
  ]);
  const rack = "ATREADI";
  const move = prepareSolver(dictionary, board, template)
    .solve(rack)
    .find(
      (move) =>
        move.word === "AT" &&
        move.direction === "across" &&
        move.col + 1 === template.start % template.size,
    )!;
  const outcome = createTacticianEvaluator(
    dictionary,
    { board, rack, template, bagSize: 12, scorelessTurns: 0 },
    move,
    true,
  )({ opponent: "SLMOUVY", bag: "NG" }, false, Infinity, true);
  assert.equal(outcome.bingo, 64);
  assert.ok(outcome.reply > 0);
  assert.equal(outcome.ordinary, 0);
  assert.ok(outcome.laneGain! > 0);
});

test("lane geometry counts through existing letters and tapers from 10% to 40%", () => {
  const board = emptyBoard(template.size);
  const lexicon = new Lexicon(["AT", "CREATION"]);
  const measure = createBingoLaneScorer(lexicon, template);
  assert.equal(measure(board), 0);
  board[template.start] = "a";
  assert.ok(measure(board) > 0);
  assert.equal(
    prepareSolver(lexicon, board, template).bestBingo("CEINORT")?.word,
    "CREATION",
  );
  assert.equal(measure(board.map((_, index) => (index % 2 ? "Z" : ""))), 0);
  assert.equal(laneOpeningBonus(0.25, 0.1), 2);
  assert.equal(laneOpeningBonus(0.25, 0.25), 1);
  assert.equal(laneOpeningBonus(0.25, 0.4), 0);
  assert.equal(laneOpeningBonus(-0.5, 0.1), -4);
  assert.equal(laneOpeningBonus(3, 0), 10);
});

test("Tactician resumes comparable follow-ups and applies four shared lane deals on finalists only", async (t) => {
  const original = globalThis.Worker;
  type Job = {
    deals: unknown[];
    move: { id: string };
    tactics: { followUp: boolean; laneDeals: number[] };
  };
  const batches = new Map<string, number[][]>();
  let truncate = true;
  class WorkerStub {
    onmessage?: (event: {
      data: { kind: string; outcomes: TacticianOutcome[] };
    }) => void;
    terminate() {}
    postMessage({ job }: { job: Job }) {
      const outcomes = job.deals.map((_, index) => ({
        bingo: 0,
        reply: 15,
        ordinary: job.tactics.followUp ? 20 : 0,
        ...(job.tactics.laneDeals.includes(index) && {
          laneGain: job.move.id === "wide" ? 0.5 : 0,
        }),
      }));
      if (job.tactics.followUp) {
        const seen = batches.get(job.move.id) ?? [];
        seen.push(job.tactics.laneDeals);
        batches.set(job.move.id, seen);
        if (truncate && job.move.id === "wide") outcomes.splice(21);
      }
      queueMicrotask(() =>
        this.onmessage?.({ data: { kind: "bingo-hunter", outcomes } }),
      );
    }
  }
  globalThis.Worker = WorkerStub as unknown as typeof Worker;
  t.after(() => {
    globalThis.Worker = original;
  });
  const board = emptyBoard(template.size),
    rack = "ATREADI";
  const dictionary = new Lexicon(["AT", "READ", "READING"]);
  const choices = prepareSolver(dictionary, board, template).solve(rack);
  const moves = Array.from({ length: 8 }, (_, i) => ({
    ...choices[i],
    id: i ? `move-${i}` : "wide",
    score: i ? 30 - i : 25,
  }));
  const session = createBingoHunterSession(
    dictionary,
    { template, rack, board, bagSize: 86, scorelessTurns: 0 },
    moves,
    undefined,
    1,
    "tactician",
  );
  const phases = new Set<string>();
  const run = () =>
    session.run(new AbortController().signal, ({ phase }) => phases.add(phase));
  const first = await run();
  assert.equal(first.summary.canContinue, true);
  assert.equal(first.ranked.length, 5);
  assert.ok(
    first.ranked.every(
      ({ utility }) =>
        utility.samples === 21 && utility.tactics?.laneBonus === undefined,
    ),
  );
  assert.deepEqual(batches.get("wide"), [[0, 20, 40, 60]]);
  truncate = false;
  const second = await run();
  assert.equal(second.summary.canContinue, false);
  assert.equal(second.summary.ceilingPass, false);
  assert.equal(second.ranked[0].move.id, "wide");
  assert.deepEqual(second.ranked[0].utility.tactics, {
    replyPoints: 15,
    ordinaryPoints: 20,
    laneBonus: 4,
  });
  assert.equal(second.ranked[0].utility.samples, 512);
  assert.deepEqual(batches.get("wide"), [[0, 20, 40, 60], [19, 39], [], []]);
  assert.deepEqual(
    [...phases],
    ["sample", "follow-up", "checkpoint", "refine"],
  );
});
