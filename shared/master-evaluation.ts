import { createBingoReplySearch, type BingoDeal } from "./bingo-replies";
import type { HunterPosition } from "./bingo-hunter";
import { endgameStreaks, nextEndgameStreak, rackPoints } from "./endgame";
import { isBingo, type Board, type Move } from "./model";
import { randomGenerator, sampleTiles } from "./move-analysis";
import { leaveValue } from "./rack-leave";
import { rackComposition } from "./rack-entry";
import type { createSolverFactory } from "./solver";

export type MasterPolicy = {
  followUp: number;
  leaf: number;
  reply: number;
};

export type MasterAction = {
  move: Move | null;
  leave: string;
  draw: number;
  returned?: string;
  held?: string;
};

export type MasterOutcome = {
  reply: number;
  followUp: number;
  ownLeave: number;
  opposingLeave: number;
  rackAdjustment: number;
  bingo: boolean;
  terminal: boolean;
};

export function createMasterEvaluator(
  factory: ReturnType<typeof createSolverFactory>,
  position: HunterPosition,
  action: MasterAction,
  policy: MasterPolicy,
  selectFollowUp?: (moves: Move[], board: Board, rack: string, bagSize: number) => Move | undefined,
) {
  const { board, bagSize, template, scorelessTurns } = position;
  const { move, leave, draw, returned, held = "" } = action;
  const boardAfter = move ? factory.place(board, move) : board;
  const bagAfter = returned ? bagSize : bagSize - draw;
  const rule = endgameStreaks[template.rules];
  const streak = rule && !(returned && rule.passesOnly)
    ? nextEndgameStreak(rule, scorelessTurns, move)
    : 0;
  const search = createBingoReplySearch(
    factory,
    boardAfter,
    bagAfter > 0,
    (solver, rack, limits, next, reply) => {
      if (!selectFollowUp) return solver.bestReply(rack, policy.leaf > 0, limits);
      let available = rack;
      for (const tile of held) available = available.replace(tile, "");
      const moves = solver.solve(available, limits, { unsorted: true });
      if (held)
        for (const move of moves) move.leave = rackComposition(move.leave + held);
      return selectFollowUp(
        moves,
        next,
        rack,
        Math.max(0, bagAfter - (reply?.tiles.length ?? 0)),
      ) ?? null;
    },
  );
  const points = (rack: string) => rackPoints(rack, template.rules);
  return (deal: BingoDeal, deadline: number, shuffleSeed = 0): MasterOutcome => {
    const rack = rackComposition(leave + deal.bag.slice(0, draw));
    const result = {
      reply: 0,
      followUp: 0,
      ownLeave: 0,
      opposingLeave: 0,
      rackAdjustment: 0,
      bingo: false,
      terminal: false,
    };
    const finish = (adjustment: number) => ({
      ...result,
      rackAdjustment: adjustment,
      terminal: true,
    });
    if (!rule && !bagSize && position.opponentHasFinalTurn === false)
      return finish(0);
    if (rule && !bagAfter && !rack) return finish(2 * points(deal.opponent));
    if (rule && streak >= rule.limit)
      return finish(points(deal.opponent) - points(rack));

    const replyBag = returned
      ? sampleTiles([...(deal.bag.slice(draw) + returned)], bagAfter, randomGenerator(shuffleSeed))
      : deal.bag;
    const replyStart = returned ? 0 : draw;
    const reply = search.reply(deal.opponent, deadline);
    result.reply = reply?.score ?? 0;
    const opposingLeave = reply?.leave ?? deal.opponent;
    if (!rule && !bagAfter) return finish(0);
    if (rule && !bagAfter && !opposingLeave) return finish(-2 * points(rack));
    const opponentDraw = Math.min(bagAfter, reply?.tiles.length ?? 0);
    const opponentRack = () =>
      opposingLeave + replyBag.slice(replyStart, replyStart + opponentDraw);
    const replyStreak = rule ? nextEndgameStreak(rule, streak, reply) : 0;
    if (rule && replyStreak >= rule.limit)
      return finish(points(opponentRack()) - points(rack));

    const follow = search.followUp(reply, rack, deadline);
    result.followUp = follow?.score ?? 0;
    result.bingo = !!follow && isBingo(template, follow.tiles.length);
    const remaining = bagAfter - opponentDraw;
    const ownLeave = follow?.leave ?? rack;
    if (rule && remaining === 0 && !ownLeave)
      return finish(2 * points(opponentRack()));
    if (rule && nextEndgameStreak(rule, replyStreak, follow) >= rule.limit) {
      const ownDraw = Math.min(remaining, follow?.tiles.length ?? 0);
      return finish(
        points(opponentRack()) -
          points(
            ownLeave +
              replyBag.slice(
                replyStart + opponentDraw,
                replyStart + opponentDraw + ownDraw,
              ),
          ),
      );
    }

    result.ownLeave =
      remaining > (follow?.tiles.length ?? 0)
        ? leaveValue(ownLeave)
        : -points(ownLeave);
    result.opposingLeave =
      bagAfter > 0 ? leaveValue(opposingLeave) : -points(opposingLeave);
    return result;
  };
}

export type MasterUtility = ReturnType<typeof summarizeMaster>;

export function summarizeMaster(
  action: MasterAction,
  position: HunterPosition,
  policy: MasterPolicy & { leavePrior: number },
  outcomes: readonly MasterOutcome[],
  deals: readonly BingoDeal[],
  exactDeals: boolean,
) {
  const score = action.move?.score ?? 0;
  let weight = 0,
    replies = 0,
    followUps = 0,
    leaves = 0,
    adjustments = 0,
    bingos = 0;
  const leavePrior = position.bagSize
    ? policy.leavePrior * leaveValue(action.leave)
    : 0;
  for (const [i, outcome] of outcomes.entries()) {
    const count = deals[i].weight ?? 1;
    weight += count;
    const terminal = outcome.terminal;
    replies -= count * (terminal ? 1 : policy.reply) * outcome.reply;
    followUps += count * (terminal ? 1 : policy.followUp) * outcome.followUp;
    const leave = terminal
      ? 0
      : leavePrior +
        policy.leaf *
          (policy.followUp * outcome.ownLeave -
            policy.reply * outcome.opposingLeave);
    leaves += count * leave;
    adjustments += count * outcome.rackAdjustment;
    if (outcome.bingo) bingos += count;
  }
  const divisor = weight || 1;
  return {
    kind: "master" as const,
    score,
    reply: replies / divisor,
    followUp: followUps / divisor,
    leave: leaves / divisor,
    rackAdjustment: adjustments / divisor,
    bingoChance: bingos / divisor,
    total: score + (replies + followUps + leaves + adjustments) / divisor,
    samples: outcomes.length,
    exactDeals,
    endgame: undefined as number | undefined,
  };
}
