import { useCallback, useContext, useEffect, useRef, useState } from "react";
import type { MoveStyle } from "../shared/move-results";
import { ComputeWorkerLimit } from "./components/ComputeWorkerLimit";
import { useGameCalculation } from "./components/GameCalculations";
import { computeWorkerLimit } from "./compute-workers";
import type { ReplayStyleRequest, ReplayStyleResult, SolverMessage } from "./solver-messages";

export type ReplayStylePosition = Omit<ReplayStyleRequest, "kind" | "id" | "style" | "workerLimit">;

export function useReplayStyleAnalysis(position: ReplayStylePosition | undefined) {
  const worker = useRef<Worker | null>(null);
  const workerLimit = useContext(ComputeWorkerLimit);
  const [state, setState] = useState<{
    position: ReplayStylePosition;
    pending?: true;
    result?: ReplayStyleResult;
    error?: string;
  }>();
  const current = state?.position === position ? state : undefined;
  useGameCalculation(!!current?.pending);

  const stop = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
  }, []);
  useEffect(() => stop, [position, stop]);

  function reset() {
    stop();
    setState(undefined);
  }

  function run(style: MoveStyle) {
    if (!position) return;
    reset();
    try {
      const active = new Worker(new URL("./solver.worker.ts", import.meta.url), { type: "module" });
      worker.current = active;
      setState({ position, pending: true });
      const finish = (value: { result?: ReplayStyleResult; error?: string }) => {
        if (worker.current !== active) return;
        stop();
        setState({ position, ...value });
      };
      active.onmessage = ({ data }: MessageEvent<SolverMessage>) => {
        if (data.kind === "replay-style") finish(data);
      };
      active.onerror = () => finish({ error: "Reanalysis stopped unexpectedly." });
      active.postMessage({
        ...position, id: 1, kind: "replay-style", style, workerLimit: computeWorkerLimit(workerLimit),
      } satisfies ReplayStyleRequest);
    } catch {
      stop();
      setState({ position, error: "Could not start reanalysis." });
    }
  }

  return { pending: current?.pending, error: current?.error, result: current?.result, run, reset };
}
