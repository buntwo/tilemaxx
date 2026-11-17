import { leaveValue } from "./move-analysis";
import type { BoardTemplate, Move, Position } from "./model";
import type { DefenseResults, MoveDefense } from "./premium-defense";
import { REPLY_LIMIT } from "./reply-analysis";
import type { PremiumReply } from "./solver";
import { rackContainsChance, unseenTiles } from "./tile-pool";

const EXTRA_PER_REASON = 2;
const MAX_SCORE_COST = 15;
const ORDINARY_REPLY_SCORE = 25;

export type ReplyCandidate = { move: Move; reason: "block" | "leave" };

/** Screen lower-ranked plays for the sampled comparison. */
export function extraReplyCandidates(
  position: Position & { template: BoardTemplate },
  moves: readonly Move[],
  defense: DefenseResults,
  baseline?: ReadonlyMap<number, PremiumReply>,
): ReplyCandidate[] {
  if (moves.length <= REPLY_LIMIT) return [];
  const { template } = position;
  const unseen = unseenTiles(position, template);
  if (unseen.excess.length || !unseen.total) return [];

  const chanceByTiles = new Map<string, number>();
  function threat(reply?: PremiumReply) {
    if (!reply || reply.score <= ORDINARY_REPLY_SCORE) return 0;
    const needed = reply.tiles.map(({ letter }) =>
      letter === letter.toUpperCase() ? letter : "?",
    ).sort().join("");
    let chance = chanceByTiles.get(needed);
    if (chance === undefined) {
      chance = rackContainsChance(unseen, template.rackSize, [...needed]);
      chanceByTiles.set(needed, chance);
    }
    return chance * (reply.score - ORDINARY_REPLY_SCORE);
  }
  const threatsByTile = new Map<number, { square: number; letter: string; value: number }[]>();
  for (const [square, reply] of baseline ?? []) {
    const value = threat(reply);
    if (value < 1) continue;
    for (const { index, letter } of reply.tiles) {
      const covering = threatsByTile.get(index) ?? [];
      covering.push({ square, letter, value });
      threatsByTile.set(index, covering);
    }
  }
  function defenseValue(move: Move) {
    const risk: MoveDefense | undefined = defense[move.id];
    let closed = threat(risk?.closed?.before) - threat(risk?.closed?.after);
    let square = risk?.closed?.square;
    for (const tile of move.tiles) {
      for (const reply of threatsByTile.get(tile.index) ?? []) {
        // A covered premium loses its multiplier. A conflicting letter can
        // also take away the example reply before it reaches the premium.
        if (
          (tile.index === reply.square || tile.letter.toUpperCase() !== reply.letter.toUpperCase()) &&
          reply.square !== risk?.closed?.square &&
          reply.value > closed
        ) {
          closed = reply.value;
          square = reply.square;
        }
      }
    }
    return {
      square,
      value: closed + threat(risk?.opened?.before) - threat(risk?.opened?.after),
    };
  }

  const top = moves[0];
  const topDefense = defenseValue(top).value;
  const topLeave = leaveValue(top.leave);
  const seenLeaves = new Set(moves.slice(0, REPLY_LIMIT).map(({ leave }) => leave));
  const byLeave = new Map<string, { move: Move; value: number }>();
  const bySquare = new Map<number, { move: Move; value: number }>();
  for (let i = REPLY_LIMIT; i < moves.length; i++) {
    const move = moves[i];
    const cost = top.score - move.score;
    if (cost > MAX_SCORE_COST) break;
    // A screen can keep a candidate whose gain covers part of its cost.
    const penalty = cost * 0.65;
    if (!seenLeaves.has(move.leave)) {
      const gain = leaveValue(move.leave) - topLeave;
      if (gain >= 2 && gain > penalty)
        byLeave.set(move.leave, { move, value: gain - penalty });
      seenLeaves.add(move.leave);
    }
    const { square, value: defensiveValue } = defenseValue(move);
    if (square !== undefined) {
      const gain = defensiveValue - topDefense;
      const value = gain - cost * 0.25;
      if (gain >= 1 && value > (bySquare.get(square)?.value ?? 0))
        bySquare.set(square, { move, value });
    }
  }

  const blocks: ReplyCandidate[] = [...bySquare.values()]
    .sort((a, b) => b.value - a.value)
    .slice(0, EXTRA_PER_REASON)
    .map(({ move }) => ({ move, reason: "block" }));
  const selected = new Set(blocks.map(({ move }) => move.id));
  const leaves: ReplyCandidate[] = [...byLeave.values()]
    .filter(({ move }) => !selected.has(move.id))
    .sort((a, b) => b.value - a.value)
    .slice(0, EXTRA_PER_REASON)
    .map(({ move }) => ({ move, reason: "leave" }));
  return [...blocks, ...leaves];
}
