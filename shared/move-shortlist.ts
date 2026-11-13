import type { BoardOddsResult, RackOdds } from "./bingo-odds";
import type { Move } from "./model";
import { leaveValue } from "./move-analysis";
import type { DefenseResults } from "./premium-defense";
import type { ReplyResult } from "./reply-analysis";

type Reason =
  | "Top score"
  | "Better leave"
  | "Safer reply"
  | "Closes a premium"
  | "Better bingo odds";
export type ShortlistEntry = { move: Move; reason: Reason; detail?: string };

function nearDuplicate(a: Move, b: Move) {
  if (a.id === b.id) return true;
  if (
    Math.abs(a.score - b.score) > 3 ||
    (a.word !== b.word && a.leave !== b.leave)
  )
    return false;
  const overlap = a.tiles.filter((tile) =>
    b.tiles.some((other) => tile.index === other.index),
  ).length;
  return overlap >= Math.ceil(Math.max(a.tiles.length, b.tiles.length) * 0.7);
}

export function shortlistMoves(
  moves: readonly Move[],
  {
    rackOdds,
    boardOdds,
    defense,
    replies,
    endgame,
  }: {
    rackOdds?: RackOdds;
    boardOdds?: BoardOddsResult;
    defense?: DefenseResults;
    replies?: Record<string, ReplyResult | undefined>;
    endgame?: boolean;
  },
): ShortlistEntry[] {
  const top = moves[0];
  if (!top) return [];
  const entries: ShortlistEntry[] = [{ move: top, reason: "Top score" }];
  function add(
    reason: Reason,
    metric: (move: Move) => { rank: number; detail: string } | undefined,
  ) {
    let best: { move: Move; rank: number; detail: string } | undefined;
    for (const move of moves) {
      if (top.score - move.score > 15) break;
      const value = metric(move);
      if (
        !value ||
        (best && value.rank <= best.rank) ||
        entries.some((entry) => nearDuplicate(entry.move, move))
      )
        continue;
      best = { move, ...value };
    }
    if (best) entries.push({ move: best.move, reason, detail: best.detail });
    return !!best;
  }

  if (!endgame) {
    const topLeave = leaveValue(top.leave);
    add("Better leave", (move) => {
      if (!move.leave || move.leave === top.leave) return;
      const gain = leaveValue(move.leave) - topLeave;
      const cost = top.score - move.score;
      if (gain < 2 || gain <= cost * 0.65) return;
      return { rank: gain - 0.65 * cost, detail: `Keeps ${move.leave}` };
    });
  }
  const reference = replies?.[top.id];
  const hasSafer = add("Safer reply", (move) => {
    const result = replies?.[move.id];
    if (!result || !reference || result.kind !== reference.kind) return;
    const cost = top.score - move.score;
    if (result.kind === "empty-bag" && reference.kind === "empty-bag") {
      const swing = (reply: typeof result) =>
        (reply.reply?.score ?? 0) +
        reply.opponentAdjustment -
        reply.yourAdjustment;
      const margin = swing(reference) - swing(result) - cost;
      if (margin <= 0) return;
      return {
        rank: margin,
        detail: `+${margin} pts after reply and adjustments`,
      };
    }
    if (result.kind !== "distribution" || reference.kind !== "distribution")
      return;
    const gain = reference.mean - result.mean;
    if (gain < 1.5 || gain < cost * 0.65) return;
    return {
      rank: gain - 0.65 * cost,
      detail: `${gain.toFixed(1)} pts less on avg.`,
    };
  });
  if (!endgame) {
    const topRisk = defense?.[top.id]?.opened?.after?.score ?? 0;
    add("Closes a premium", (move) => {
      const risk = defense?.[move.id];
      if (hasSafer && replies?.[move.id]) return;
      const closed = risk?.closed;
      if (!closed?.before) return;
      const gain = closed.before.score - (closed.after?.score ?? 0);
      const opened = risk?.opened?.after?.score ?? 0;
      const cost = top.score - move.score;
      if (
        opened >= Math.max(topRisk, closed.before.score) ||
        gain < 8 ||
        gain - opened * 0.4 <= cost
      )
        return;
      return {
        rank: gain - opened * 0.4 - cost,
        detail: `${closed.premium} reply −${gain} pts`,
      };
    });
  }
  if (!endgame) {
    add("Better bingo odds", (move) => {
      const boardChance = boardOdds?.byMove[move.id]?.chance;
      const boardBaseline = boardOdds?.byMove[top.id]?.chance;
      const useBoard = boardChance !== undefined && boardBaseline !== undefined;
      const draws = rackOdds?.error ? undefined : rackOdds?.byLeave;
      const chance = useBoard ? boardChance : draws?.[move.leave];
      const baseline = useBoard ? boardBaseline : draws?.[top.leave];
      if (
        chance === undefined ||
        baseline === undefined ||
        chance - baseline < 0.05
      )
        return;
      const gain = chance - baseline;
      return {
        rank: gain * 50 - 0.45 * (top.score - move.score),
        detail: `${Math.round(chance * 100)}% ${useBoard ? "board bingo" : "bingo draw"}`,
      };
    });
  }
  return entries;
}
