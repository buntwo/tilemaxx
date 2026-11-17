import { useCallback, useEffect, useMemo, useState } from "react";
import { isBingo, type Game, type Player } from "../../shared/model";
import type {
  OpponentPolicyInput,
  OpponentPolicyResult,
} from "../../shared/opponent-policy";
import type { reviewTurns } from "../../shared/turn-review";
import type {
  OpponentPolicyBatchResult,
  OpponentPolicyUpdate,
} from "../practice.worker";
import { usePractice } from "./usePractice";

export type PolicyEstimate = { result: OpponentPolicyResult; refined?: boolean };

export function usePolicyTimeline(
  template: Game["template"],
  turns: ReturnType<typeof reviewTurns>,
  player: Player,
) {
  const policyTurns = useMemo(
    () =>
      turns.flatMap(({ move, index, position }) => {
        if (move.player !== player) return [];
        const input: OpponentPolicyInput | undefined = position?.tiles.length
          ? {
              position: {
                board: position.board,
                tiles: position.tiles,
                // The recorded observer rack belongs to us. Our own policy
                // review gives the opponent only the board and played tiles.
                ...(player === "opponent" && {
                  observerRack: position.observerRack,
                }),
              },
              template: position.premiums
                ? { ...template, premiums: position.premiums }
                : template,
              word: move.word,
            }
          : undefined;
        const dictionaryId = position?.dictionaryId;
        const key = JSON.stringify([index, dictionaryId, input]);
        const bingo =
          move.bingo ??
          (!!position && isBingo(template, position.tiles.length));
        return [{ move, index, dictionaryId, input, key, bingo }];
      }),
    [turns, template, player],
  );
  const [results, setResults] = useState<Record<string, PolicyEstimate>>({});
  const saveResult = useCallback(
    (key: string, { result, refined }: PolicyEstimate) => {
      setResults((previous) => {
        const old = previous[key];
        if (old?.result.kind === "exact") return previous;
        const keepOld =
          old?.result.kind === "sampled" &&
          (result.kind === "unavailable" ||
            (result.kind === "sampled" && old.result.samples > result.samples));
        const attemptedRefinement = old?.refined || refined;
        if (keepOld && old.refined === attemptedRefinement) return previous;
        return {
          ...previous,
          [key]: {
            result: keepOld ? old.result : result,
            refined: attemptedRefinement,
          },
        };
      });
    },
    [],
  );
  const update = useCallback(
    ({ key, result }: OpponentPolicyUpdate) => saveResult(key, { result }),
    [saveResult],
  );
  const { run, reset, result, progress, error } = usePractice<
    OpponentPolicyBatchResult,
    OpponentPolicyUpdate
  >(update);
  // Keep results attached to their exact inputs and stop a batch of stale jobs.
  const timelineKey = useMemo(
    () => JSON.stringify(policyTurns.map(({ key }) => key)),
    [policyTurns],
  );
  useEffect(reset, [timelineKey, reset]);

  const remaining = policyTurns.flatMap(({ key, dictionaryId, input }) =>
    dictionaryId && input && !results[key] ? [{ key, dictionaryId, input }] : [],
  );
  return {
    player,
    turns: policyTurns,
    results,
    saveResult,
    progress,
    error,
    reachedTimeLimit: result?.reachedTimeLimit,
    remaining: remaining.length,
    analyze: () =>
      run({ kind: "opponent-policy-timeline", turns: remaining }),
    cancel: reset,
  };
}
