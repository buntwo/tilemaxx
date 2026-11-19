import { useEffect, useRef, useState } from "react";
import type { HunterProgress, HunterSummary } from "./parallel-bingo-hunter";
import type { HunterOptions } from "./solver-messages";
import type { RunBingoHunter } from "./useSolver";

type HuntState = {
  key: string;
  progress?: HunterProgress;
  result?: HunterSummary & { id: number };
  error?: string;
};

export function useBingoHunter(
  key: string | undefined,
  run: RunBingoHunter | undefined,
) {
  const active = useRef<AbortController>(undefined);
  const [state, setState] = useState<HuntState>();

  useEffect(() => {
    setState((current) =>
      current?.progress && current.key !== key
        ? { ...current, progress: undefined }
        : current,
    );
    return () => active.current?.abort();
  }, [key]);

  function cancel() {
    active.current?.abort();
    setState((current) =>
      current?.result ? { ...current, progress: undefined } : undefined,
    );
  }

  function start(searchId: number, settings: HunterOptions) {
    if (!key || !run) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const previous =
      settings.resumeFrom === undefined ? undefined : state?.result;
    setState({
      key,
      result: previous,
      progress: { phase: "screen", done: 0, total: 0 },
    });
    void run(searchId, settings, controller.signal, (progress) => {
      if (!controller.signal.aborted)
        setState({ key, result: previous, progress });
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
  }

  return { current: state?.key === key ? state : undefined, start, cancel };
}
