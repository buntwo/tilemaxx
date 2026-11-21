import {
  exactHunterDeals,
  hunterPool,
  type HunterPosition,
} from "./bingo-hunter";
import { sampleBingoDeals } from "./bingo-replies";
import { rackPoints } from "./endgame";
import {
  summarizeMaster,
  type MasterAction,
  type MasterOutcome,
  type MasterPolicy,
} from "./master-evaluation";
import type { Move } from "./model";
import { randomGenerator } from "./move-analysis";
import { profileWordHash } from "./player-profiles";
import { rackComposition } from "./rack-entry";
import { leaveValue } from "./rack-leave";

export type MasterSettings = MasterPolicy & {
  leavePrior: number;
  width: number;
  first: number;
  last: number;
  finalists: number;
};

export const MASTER_SETTINGS: MasterSettings = {
  followUp: 0.65,
  leaf: 1,
  reply: 1,
  leavePrior: 0.35,
  width: 12,
  first: 8,
  last: 40,
  finalists: 4,
};

export function planMaster(
  position: HunterPosition,
  moves: readonly Move[],
  settings = MASTER_SETTINGS,
) {
  const { board, rack, bagSize, template } = position;
  const { pool, opponentSize } = hunterPool(position);
  const opponent = bagSize === 0 ? pool.join("") : undefined;
  const seed = profileWordHash(
    `${board.join(".")}:${rackComposition(rack)}:${bagSize}`,
  );
  const exact = bagSize <= 2;
  const deals = exact
    ? exactHunterDeals(pool, bagSize)
    : sampleBingoDeals(
        pool,
        opponentSize,
        Math.min(bagSize, 3 * template.rackSize),
        settings.last,
        randomGenerator(seed),
      );

  const outBonus =
    opponent === undefined ? 0 : 2 * rackPoints(opponent, template.rules);
  const leaves = new Map<string, number>();
  function prior(move: Move) {
    if (opponent !== undefined)
      return move.score + (move.leave ? 4 * move.tiles.length : outBonus);
    let value = leaves.get(move.leave);
    if (value === undefined) {
      value = 1.4 * leaveValue(move.leave);
      leaves.set(move.leave, value);
    }
    return move.score + value;
  }
  const values = moves.map((move) => ({ move, points: prior(move) }));
  values.sort((a, b) => b.points - a.points || b.move.score - a.move.score);
  const ranked = values.slice(0, settings.width).map(({ move }) => move);
  const uniqueLeaves = new Set<string>();
  const diverse: Move[] = [];
  for (const { move } of values) {
    if (uniqueLeaves.has(move.leave)) continue;
    uniqueLeaves.add(move.leave);
    diverse.push(move);
    if (diverse.length === 4) break;
  }
  const slate = [
    ...new Set([
      ...ranked.slice(0, 4),
      ...moves.slice(0, 3),
      ...diverse,
      ...ranked,
    ]),
  ].slice(0, settings.width);
  const candidates: MasterAction[] = slate.map((move) => ({
    move,
    leave: move.leave,
    draw: Math.min(bagSize, template.rackSize - move.leave.length),
  }));
  // Preserve the highest-scoring immediate rack-out for the exact comparison.
  if (opponent !== undefined && template.rules !== "crossplay") {
    const out = moves.find((move) => move.leave === "");
    if (out && !slate.includes(out))
      candidates.push({ move: out, leave: "", draw: 0 });
  }
  if (
    opponent !== undefined &&
    template.rules !== "crossplay" &&
    !position.requiredRackSlots?.length
  )
    candidates.push({ move: null, leave: rackComposition(rack), draw: 0 });

  return {
    candidates,
    deals,
    exact,
    opponent,
    settings,
    rank(
      outcomes: ReadonlyMap<MasterAction, readonly MasterOutcome[]>,
      count: number,
    ) {
      return candidates
        .flatMap((action) => {
          const samples = outcomes.get(action);
          if (!samples || samples.length < count) return [];
          return [
            {
              action,
              utility: summarizeMaster(
                action,
                position,
                settings,
                samples.slice(0, count),
                deals,
                exact,
              ),
            },
          ];
        })
        .sort(
          (a, b) =>
            b.utility.total - a.utility.total ||
            b.utility.score - a.utility.score,
        );
    },
  };
}

export type MasterPlan = ReturnType<typeof planMaster>;
export type MasterRanking = ReturnType<MasterPlan["rank"]>;

export function masterEndgameCandidates(
  plan: MasterPlan,
  position: HunterPosition,
  ranked: MasterRanking,
) {
  const { candidates, opponent } = plan;
  if (
    opponent === undefined ||
    rackComposition(position.rack).length + opponent.length > 10
  )
    return [];
  const out = candidates.find((action) => action.move && !action.leave);
  const pass = candidates.find((action) => !action.move);
  return [
    ...new Set([
      ...ranked.slice(0, 6).map(({ action }) => action),
      ...(out ? [out] : []),
      ...(pass ? [pass] : []),
    ]),
  ];
}

export function rankMasterEndgame(
  ranked: MasterRanking,
  slate: readonly MasterAction[],
  spreads: ReadonlyMap<MasterAction, number>,
): MasterRanking {
  if (!slate.length || slate.some((action) => !spreads.has(action)))
    return ranked;
  const lines: MasterRanking = [];
  const estimates: MasterRanking = [];
  for (const row of ranked) {
    const spread = spreads.get(row.action);
    if (spread === undefined) estimates.push(row);
    else
      lines.push({
        ...row,
        utility: { ...row.utility, total: spread, endgame: spread },
      });
  }
  lines.sort(
    (a, b) =>
      b.utility.total - a.utility.total || b.utility.score - a.utility.score,
  );
  return [...lines, ...estimates];
}
