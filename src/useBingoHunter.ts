import { useCallback, useEffect, useRef, useState } from "react";
import type { HunterProgress, HunterSummary } from "./parallel-bingo-hunter";
import type { HunterOptions } from "./solver-messages";
import type { RunBingoHunter } from "./useSolver";

type HuntState = {
  key: string;
  pending?: true;
  progress?: HunterProgress;
  result?: HunterSummary & { id: number };
  error?: string;
};

export function useBingoHunter(
  key: string | undefined,
  run: RunBingoHunter | undefined,
  { gameId, searchId, findMovesRequest, bagSize, scorelessTurns, opponentHasFinalTurn, workerLimit }:
    Omit<HunterOptions, "resumeFrom"> & { gameId?: string; searchId?: number; findMovesRequest?: number },
) {
  const active = useRef<AbortController>(undefined);
  const lastStarted = useRef<{ gameId?: string; searchId: number; findMovesRequest?: number }>(undefined);
  const [state, setState] = useState<HuntState>();
  const current = state?.key === key ? state : undefined;

  useEffect(() => {
    setState((current) =>
      current?.pending && current.key !== key
        ? { ...current, pending: undefined, progress: undefined }
        : current,
    );
    return () => active.current?.abort();
  }, [key]);

  function cancel() {
    active.current?.abort();
    setState((current) =>
      current?.result ? { ...current, pending: undefined, progress: undefined } : undefined,
    );
  }

  const start = useCallback((resumeFrom?: number) => {
    if (!key || !run || searchId === undefined) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    lastStarted.current = { gameId, searchId, findMovesRequest };
    const previous = resumeFrom === undefined ? undefined : current?.result;
    const settings = { bagSize, scorelessTurns, opponentHasFinalTurn, workerLimit, resumeFrom };
    setState({ key, result: previous, pending: true });
    void run(searchId, settings, controller.signal, (progress) => {
      if (!controller.signal.aborted)
        setState({ key, result: previous, pending: true, progress });
    }).then(
      (response) => {
        if (controller.signal.aborted) return;
        setState(
          response?.summary
            ? { key, result: { ...response.summary, id: response.id } }
            : {
                key,
                result: previous,
                error:
                  response?.error ??
                  "Bingo hunter could not finish. Try again.",
              },
        );
      },
      () => {
        if (!controller.signal.aborted)
          setState({
            key,
            result: previous,
            error: "Bingo hunter could not finish. Try again.",
          });
      },
    );
  }, [key, run, gameId, searchId, findMovesRequest, current?.result, bagSize, scorelessTurns, opponentHasFinalTurn, workerLimit]);

  useEffect(() => {
    const previous = lastStarted.current;
    // Search IDs increase when the solver generates a new move set. Reopening
    // cached results or cancelling a hunt should leave the current run alone.
    if (key && gameId && previous?.gameId === gameId &&
      searchId !== undefined && searchId > previous.searchId &&
      findMovesRequest !== undefined && findMovesRequest > (previous.findMovesRequest ?? 0)) {
      start();
    }
  }, [key, gameId, searchId, findMovesRequest, start]);

  return { current, start, cancel };
}
