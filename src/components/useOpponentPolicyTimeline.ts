import { useCallback, useEffect, useMemo, useState } from "react";
import { isBingo, type Game } from "../../shared/model";
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

export function useOpponentPolicyTimeline(
  game: Pick<Game, "template" | "dictionaryId">,
  turns: ReturnType<typeof reviewTurns>,
) {
  const { template, dictionaryId } = game;
  const opponentTurns = useMemo(
    () =>
      turns.flatMap(({ move, index, position }) => {
        if (move.player !== "opponent") return [];
        const input: OpponentPolicyInput | undefined = position?.tiles.length
          ? {
              position: {
                board: position.board,
                tiles: position.tiles,
                observerRack: position.observerRack,
              },
              template: position.premiums
                ? { ...template, premiums: position.premiums }
                : template,
              word: move.word,
            }
          : undefined;
        const key = JSON.stringify([index, dictionaryId, input]);
        const bingo =
          move.bingo ??
          (!!position && isBingo(template, position.tiles.length));
        return [{ move, index, input, key, bingo }];
      }),
    [turns, template, dictionaryId],
  );
  const [results, setResults] = useState<Record<string, OpponentPolicyResult>>(
    {},
  );
  const saveResult = useCallback(
    (key: string, result: OpponentPolicyResult) => {
      setResults((previous) => {
        const old = previous[key];
        if (old?.kind === "exact") return previous;
        if (
          old?.kind === "sampled" &&
          (result.kind === "unavailable" ||
            (result.kind === "sampled" && old.samples > result.samples))
        )
          return previous;
        return { ...previous, [key]: result };
      });
    },
    [],
  );
  const update = useCallback(
    ({ key, result }: OpponentPolicyUpdate) => saveResult(key, result),
    [saveResult],
  );
  const { run, reset, result, progress, error } = usePractice<
    OpponentPolicyBatchResult,
    OpponentPolicyUpdate
  >(update);
  // Keep results attached to their exact inputs and stop a batch of stale jobs.
  const timelineKey = useMemo(
    () => JSON.stringify(opponentTurns.map(({ key }) => key)),
    [opponentTurns],
  );
  useEffect(reset, [timelineKey, reset]);

  const remaining = opponentTurns.flatMap(({ key, input }) =>
    input && !results[key] ? [{ key, input }] : [],
  );
  return {
    turns: opponentTurns,
    results,
    saveResult,
    progress,
    error,
    reachedTimeLimit: result?.reachedTimeLimit,
    remaining: remaining.length,
    analyze: () =>
      run({ kind: "opponent-policy-timeline", dictionaryId, turns: remaining }),
    cancel: reset,
  };
}
