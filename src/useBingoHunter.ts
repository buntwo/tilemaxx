import { useCallback, useEffect, useRef, useState } from "react";
import { SIMULATED_STYLES, SIMULATED_STYLE_LABELS, type SimulatedStyle } from "../shared/simulated-styles";
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
  { style, gameId, searchId, findMovesRequest, bagSize, scorelessTurns, opponentHasFinalTurn, workerLimit }:
    Omit<HunterOptions, "resumeFrom"> & { gameId?: string; searchId?: number; findMovesRequest?: number },
) {
  const active = useRef<AbortController>(undefined);
  const lastStarted = useRef(new Map<SimulatedStyle, { gameId?: string; searchId: number; findMovesRequest?: number }>());
  const [states, setStates] = useState<Partial<Record<SimulatedStyle, HuntState>>>({});
  const saved = style ? states[style] : undefined;
  const current = saved?.key === key ? saved : undefined;

  useEffect(() => {
    setStates((current) => {
      const stale = SIMULATED_STYLES.find(style => current[style]?.pending && current[style].key !== key);
      if (!stale) return current;
      return { ...current, [stale]: { ...current[stale], pending: undefined, progress: undefined } };
    });
    return () => active.current?.abort();
  }, [key]);

  function cancel() {
    active.current?.abort();
    if (!style) return;
    setStates((states) => ({ ...states, [style]: current?.result
      ? { ...current, pending: undefined, progress: undefined } : undefined }));
  }

  const start = useCallback((resumeFrom?: number) => {
    if (!style || !key || !run || searchId === undefined) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    lastStarted.current.set(style, { gameId, searchId, findMovesRequest });
    const previous = resumeFrom === undefined ? undefined : current?.result;
    const settings = { style, bagSize, scorelessTurns, opponentHasFinalTurn, workerLimit, resumeFrom };
    const setState = (state: HuntState) => setStates((states) => ({ ...states, [style]: state }));
    const error = `${SIMULATED_STYLE_LABELS[style]} could not finish. Try again.`;
    setState({ key, result: previous, pending: true });
    void run(searchId, settings, controller.signal, (progress) => {
      if (!controller.signal.aborted)
        setState({ key, result: previous, pending: true, progress });
    }).then(
      (response) => {
        if (controller.signal.aborted) return;
        setState(response?.summary
          ? { key, result: { ...response.summary, id: response.id } }
          : { key, result: previous, error: response?.error ?? error });
      },
      () => {
        if (!controller.signal.aborted) setState({ key, result: previous, error });
      },
    );
  }, [style, key, run, gameId, searchId, findMovesRequest, current?.result, bagSize, scorelessTurns, opponentHasFinalTurn, workerLimit]);

  useEffect(() => {
    const previous = style && lastStarted.current.get(style);
    // Reopening cached results or cancelling a hunt should leave the current run alone.
    if (key && gameId && previous && previous.gameId === gameId &&
      searchId !== undefined && searchId > previous.searchId &&
      findMovesRequest !== undefined && findMovesRequest > (previous.findMovesRequest ?? 0)) {
      start();
    }
  }, [style, key, gameId, searchId, findMovesRequest, start]);

  return { current, start, cancel };
}
