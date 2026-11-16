import { useCallback, useContext, useEffect, useRef, useState } from "react";
import type { PracticeRequest } from "../practice.worker";
import { useGameCalculation } from "./GameCalculations";
import { ComputeWorkerLimit } from "./ComputeWorkerLimit";

type Progress = { completed: number; total: number };
type PracticeMessage<Result, Update> =
  | { progress: Progress; update?: Update }
  | { result: Result }
  | { error: string };

export function usePractice<Result, Update = never>(
  onUpdate?: (update: Update) => void,
) {
  const workerLimit = useContext(ComputeWorkerLimit);
  const worker = useRef<Worker | null>(null);
  const [result, setResult] = useState<Result>();
  const [progress, setProgress] = useState<Progress>();
  const [error, setError] = useState("");
  useGameCalculation(!!progress);
  useEffect(
    () => () => {
      worker.current?.terminate();
      worker.current = null;
    },
    [],
  );
  const reset = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
    setProgress(undefined);
    setResult(undefined);
    setError("");
  }, []);
  const run = useCallback(
    (request: PracticeRequest) => {
      reset();
      try {
        const active = new Worker(
          new URL("../practice.worker.ts", import.meta.url),
          { type: "module" },
        );
        worker.current = active;
        setProgress({ completed: 0, total: 0 });
        const finish = () => {
          active.terminate();
          worker.current = null;
          setProgress(undefined);
        };
        active.onmessage = ({
          data,
        }: MessageEvent<PracticeMessage<Result, Update>>) => {
          if (worker.current !== active) return;
          if ("progress" in data) {
            if (data.update !== undefined) onUpdate?.(data.update);
            setProgress(data.progress);
          } else {
            finish();
            if ("error" in data) setError(data.error);
            else setResult(data.result);
          }
        };
        active.onerror = () => {
          if (worker.current !== active) return;
          finish();
          setError("Analysis stopped unexpectedly.");
        };
        active.postMessage(
          workerLimit !== undefined &&
            (request.kind === "optimal-exchange" ||
              request.kind === "opponent-policy-timeline")
            ? { ...request, workerLimit }
            : request,
        );
      } catch {
        setProgress(undefined);
        setError("Could not start the analysis.");
      }
    },
    [onUpdate, reset, workerLimit],
  );
  return { result, progress, error, run, reset };
}
