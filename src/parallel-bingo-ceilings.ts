import {
  ceilingOpponentRacks,
  summarizeCeilingReplies,
  type BingoCeiling,
  type BingoCeilingResult,
  type CeilingReply,
} from "../shared/bingo-ceilings";
import type { HunterPosition } from "../shared/bingo-hunter";
import type { Move } from "../shared/model";
import { randomGenerator } from "../shared/move-analysis";
import { profileWordHash } from "../shared/player-profiles";
import type { CandidateJob } from "./candidate-analysis-jobs";
import type { createCandidatePool } from "./candidate-analysis-pool";
import type { HunterStageProgress } from "./parallel-bingo-hunter";

const CEILING_SLOTS = 6;
const REPLY_OPEN_SLOTS = 2;
const now = () => performance.timeOrigin + performance.now();

type Review = {
  move: Move;
  ceiling: BingoCeiling;
  deal: ReturnType<typeof ceilingOpponentRacks>;
  replies: CeilingReply[];
  blocked?: boolean;
};

export function createBingoCeilingSearch(
  position: HunterPosition,
  candidates: readonly Move[],
  pool: string[],
  opponentSize: number,
) {
  const discovered = new Map<Move, BingoCeiling | undefined>();
  let reviews: Review[] | undefined;

  function select() {
    const ranked = [...discovered].flatMap(([move, ceiling]) =>
      ceiling ? [{ move, ceiling }] : [],
    ).sort((a, b) =>
      b.ceiling.bingo.score - a.ceiling.bingo.score ||
      b.ceiling.drawChance - a.ceiling.drawChance || b.move.score - a.move.score,
    );
    // Keep different bingo words visible, even if several setups open the
    // same lane. Reserve a couple of slots for lanes opened by the reply.
    const seen = new Set<string>();
    const distinct = ranked.filter(({ ceiling }) => {
      const { word } = ceiling.bingo;
      if (seen.has(word)) return false;
      seen.add(word);
      return true;
    });
    const selected = new Set([
      ...distinct.slice(0, CEILING_SLOTS - REPLY_OPEN_SLOTS),
      ...distinct.filter(({ ceiling }) => ceiling.needsReply).slice(0, REPLY_OPEN_SLOTS),
      ...distinct,
    ]);
    return [...selected].slice(0, CEILING_SLOTS).map(({ move, ceiling }): Review => ({
      move, ceiling, replies: [],
      deal: ceilingOpponentRacks(pool, ceiling.draw, opponentSize,
        randomGenerator(profileWordHash(`${move.id}:${ceiling.draw}`)), ceiling.needsReply),
    }));
  }

  async function run(
    workers: ReturnType<typeof createCandidatePool>,
    deadline: number,
    signal: AbortSignal,
    progress: (value: HunterStageProgress) => void,
  ) {
    let advanced = false;
    if (!reviews) {
      progress({ phase: "ceiling-discovery", done: discovered.size, total: candidates.length });
      await workers.run(
        candidates.filter((move) => !discovered.has(move)).map(
          (move): Extract<CandidateJob, { kind: "bingo-ceiling" }> => ({
            kind: "bingo-ceiling", move, position, pool, opponentSize, deadline,
            scoutReplyOpenings: pool.length <= 16,
          }),
        ),
        ({ move }, result) => {
          if (result.kind !== "bingo-ceiling") throw new Error("Could not check high-scoring setups.");
          discovered.set(move, result.ceiling);
          advanced = true;
          progress({ phase: "ceiling-discovery", done: discovered.size, total: candidates.length });
        },
        (job) => now() < deadline ? job : undefined,
      );
      signal.throwIfAborted();
      if (discovered.size < candidates.length) return { advanced, done: false };
      reviews = select();
    }

    const byMove = new Map(reviews.map((review) => [review.move, review]));
    const pending = reviews.filter(({ deal, replies, blocked }) =>
      !blocked && replies.length < deal.racks.length,
    );
    let checked = reviews.length - pending.length;
    progress({ phase: "ceiling-replies", done: checked, total: reviews.length });
    await workers.run(
      pending.map(({ move, ceiling, deal, replies }): Extract<CandidateJob, { kind: "bingo-ceiling-replies" }> => ({
        kind: "bingo-ceiling-replies", move, position, ceiling, deadline,
        racks: deal.racks.slice(replies.length).map(({ tiles }) => tiles),
      })),
      ({ move }, result) => {
        if (result.kind !== "bingo-ceiling-replies") throw new Error("Could not check replies for high-scoring setups.");
        const review = byMove.get(move)!;
        review.replies.push(...result.replies);
        review.blocked = result.blocked;
        advanced ||= !!(result.replies.length || result.blocked);
        if (review.blocked || review.replies.length === review.deal.racks.length) checked++;
        progress({ phase: "ceiling-replies", done: checked, total: reviews!.length });
      },
      (job) => now() < deadline ? job : undefined,
    );
    signal.throwIfAborted();
    return { advanced, done: checked === reviews.length };
  }

  function results(): BingoCeilingResult[] {
    return (reviews ?? []).filter(({ deal, replies }) => deal.racks.length === replies.length)
      .map(({ move, ceiling, deal, replies }) =>
        summarizeCeilingReplies(move, ceiling, deal.racks, replies, deal.exact),
      )
      .sort((a, b) => b.bingo.score - a.bingo.score || b.chance - a.chance);
  }

  return { run, results };
}
