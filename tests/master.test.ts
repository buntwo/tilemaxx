import assert from "node:assert/strict";
import { test } from "node:test";
import { rackPoints } from "../shared/endgame";
import type { HunterPosition } from "../shared/bingo-hunter";
import { Lexicon } from "../shared/lexicon";
import { masterEndgame } from "../shared/master-endgame";
import {
  createMasterEvaluator,
  summarizeMaster,
  type MasterOutcome,
} from "../shared/master-evaluation";
import {
  MASTER_SETTINGS,
  masterEndgameCandidates,
  planMaster,
  rankMasterEndgame,
} from "../shared/master-search";
import { emptyBoard, type BoardTemplate } from "../shared/model";
import { PRESETS } from "../shared/presets";
import { createSolverFactory, solvePosition } from "../shared/solver";
import { TILE_SYMBOLS } from "../shared/tile-pool";

function position(
  rack: string,
  unseen: string,
  bagSize: number,
): HunterPosition {
  const tiles = rack + unseen;
  const template: BoardTemplate = {
    ...PRESETS[0],
    tileCounts: Object.fromEntries(
      TILE_SYMBOLS.map((letter) => [
        letter,
        [...tiles].filter((tile) => tile === letter).length,
      ]),
    ),
  };
  return {
    board: emptyBoard(template.size),
    rack,
    template,
    bagSize,
    scorelessTurns: 0,
  };
}

test("Master evaluates an ordinary follow-up using only its own draw", () => {
  const game = position("CAT", "SZ", 1);
  const lexicon = new Lexicon(["CAT", "CATS"]);
  const factory = createSolverFactory(lexicon, game.template, true);
  const [move] = solvePosition(lexicon, game, game.template);
  const plan = planMaster(game, [move]);
  const action = plan.candidates[0];
  const evaluate = createMasterEvaluator(
    factory,
    game,
    action,
    MASTER_SETTINGS,
  );
  const drawS = evaluate({ opponent: "Z", bag: "S" }, Infinity);
  assert.ok(drawS.followUp > 0);
  assert.equal(drawS.bingo, false);
  assert.equal(drawS.terminal, true);
  assert.equal(drawS.rackAdjustment, 20);
  const opponentS = evaluate({ opponent: "S", bag: "Z" }, Infinity);
  assert.ok(opponentS.reply > 0);
  assert.equal(opponentS.followUp, 0);
  assert.equal(opponentS.rackAdjustment, -20);
});

test("Master weights small-bag tile deals and uses the full spread of finished games", () => {
  const game = position("CAT", "AAZ", 2);
  const lexicon = new Lexicon(["CAT"]);
  const [move] = solvePosition(lexicon, game, game.template);
  const plan = planMaster(game, [move]);
  assert.equal(plan.exact, true);
  assert.deepEqual(
    plan.deals.map(({ bag, weight }) => [bag, weight]),
    [
      ["AA", 2],
      ["AZ", 2],
      ["ZA", 2],
    ],
  );
  const action = plan.candidates[0];
  const outcomes: MasterOutcome[] = [
    {
      reply: 20,
      followUp: 30,
      ownLeave: 8,
      opposingLeave: 6,
      rackAdjustment: 0,
      bingo: false,
      terminal: false,
    },
    {
      reply: 40,
      followUp: 0,
      ownLeave: 0,
      opposingLeave: 0,
      rackAdjustment: -12,
      bingo: false,
      terminal: true,
    },
  ];
  const utility = summarizeMaster(
    action,
    game,
    MASTER_SETTINGS,
    outcomes,
    [
      { opponent: "Z", bag: "AA", weight: 2 },
      { opponent: "A", bag: "AZ", weight: 1 },
    ],
    true,
  );
  assert.equal(utility.reply, -80 / 3);
  assert.equal(utility.followUp, 13);
  assert.equal(utility.rackAdjustment, -4);
  assert.ok(
    Math.abs(
      utility.total -
        (move.score +
          utility.reply +
          utility.followUp +
          utility.leave +
          utility.rackAdjustment),
    ) < 1e-9,
  );
});

test("Master compares the complete endgames and preserves held tiles", () => {
  const game = position("CATS", "Q", 0);
  const lexicon = new Lexicon(["CAT", "CATS"]);
  const factory = createSolverFactory(lexicon, game.template, true);
  const moves = solvePosition(lexicon, game, game.template);
  const plan = planMaster(game, moves);
  const outcomes = new Map(
    plan.candidates.map((action) => [
      action,
      [
        createMasterEvaluator(
          factory,
          game,
          action,
          MASTER_SETTINGS,
        )(plan.deals[0], Infinity),
      ],
    ]),
  );
  const rank = plan.rank(outcomes, 1);
  const slate = masterEndgameCandidates(plan, game, rank);
  assert.ok(slate.some((action) => !action.move));
  const solved = new Map(
    slate.map((action) => [
      action,
      masterEndgame(factory, game, action, "Q", performance.now() + 500, 400)!,
    ]),
  );
  assert.ok([...solved.values()].every(Number.isFinite));
  const [best] = rankMasterEndgame(rank, slate, solved);
  assert.equal(best.action.move?.word, "CAT");
  const out = rank.find(({ action }) => action.move?.word === "CATS")!;
  assert.equal(
    solved.get(out.action),
    out.action.move!.score + 2 * rackPoints("Q", game.template.rules),
  );
  assert.ok(best.utility.endgame! > solved.get(out.action)!);
  solved.delete(slate[0]);
  assert.equal(rankMasterEndgame(rank, slate, solved), rank);

  const held = { ...game, excludedRackSlots: [3], requiredRackSlots: [0] };
  const heldPlan = planMaster(
    held,
    solvePosition(lexicon, held, game.template),
  );
  assert.ok(heldPlan.candidates.length);
  assert.ok(
    heldPlan.candidates.every(
      (action) =>
        action.move?.word === "CAT" &&
        action.leave === "S" &&
        action.draw === 0,
    ),
  );
});
