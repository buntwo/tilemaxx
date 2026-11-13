import { useEffect, useRef, useState } from "react";
import type { PracticeRequest } from "../practice.worker";

export function usePractice<Result>() {
  const worker = useRef<Worker | null>(null);
  const [result, setResult] = useState<Result>();
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
  }>();
  const [error, setError] = useState("");
  useEffect(() => () => worker.current?.terminate(), []);
  function reset() {
    worker.current?.terminate();
    worker.current = null;
    setProgress(undefined);
    setResult(undefined);
    setError("");
  }
  function run(request: PracticeRequest) {
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
      active.onmessage = ({ data }) => {
        if (worker.current !== active) return;
        if (data.progress) setProgress(data.progress);
        else {
          finish();
          if (data.error) setError(data.error);
          else setResult(data.result);
        }
      };
      active.onerror = () => {
        if (worker.current !== active) return;
        finish();
        setError("Analysis stopped unexpectedly.");
      };
      active.postMessage(request);
    } catch {
      setProgress(undefined);
      setError("Could not start the analysis.");
    }
  }
  return { result, progress, error, run, reset };
}
