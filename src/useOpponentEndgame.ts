import { useEffect, useRef, useState } from "react";
import type { OpponentEndgameTiming } from "./move-timing";
import type { OpponentEndgamePosition } from "../shared/reply-analysis";
import { useGameCalculation } from "./components/GameCalculations";
import type {
  OpponentEndgameMessage,
  OpponentEndgameProgress,
  OpponentEndgameRequest,
  OpponentEndgameResult,
} from "./parallel-opponent-endgame";

type Search =
  | { pending: true; progress?: OpponentEndgameProgress }
  | { pending: false; result: OpponentEndgameResult; timing: OpponentEndgameTiming }
  | { pending: false; error: string };

export function useOpponentEndgame(
  key: string | undefined,
  workerLimit: number,
) {
  const [search, setSearch] = useState<{ key: string; value: Search }>();
  const active = useRef<Worker | null>(null);
  const current = search?.key === key ? search?.value : undefined;
  useGameCalculation(!!current?.pending);

  function stop() {
    active.current?.terminate();
    active.current = null;
  }

  useEffect(() => {
    setSearch(undefined);
    return stop;
  }, [key]);

  function start(position: OpponentEndgamePosition, dictionaryId: string) {
    if (key === undefined) return;
    stop();
    const publish = (value: Search) => setSearch({ key, value });
    const startedAt = performance.now();
    publish({ pending: true });
    try {
      const worker = new Worker(
        new URL("./analysis.worker.ts", import.meta.url),
        {
          type: "module",
        },
      );
      active.current = worker;
      worker.onmessage = ({ data }: MessageEvent<OpponentEndgameMessage>) => {
        if (active.current !== worker) return;
        if ("progress" in data) {
          publish({ pending: true, progress: data.progress });
          return;
        }
        stop();
        publish(
          "result" in data
            ? {
                pending: false,
                result: data.result,
                timing: {
                  total: performance.now() - startedAt,
                  batches: data.result.batches,
                },
              }
            : { pending: false, error: data.error },
        );
      };
      worker.onerror = () => {
        if (active.current !== worker) return;
        stop();
        publish({
          pending: false,
          error: "The opponent endgame stopped unexpectedly.",
        });
      };
      worker.postMessage({
        kind: "solve-opponent-endgame",
        ...position,
        dictionaryId,
        workerLimit,
      } satisfies OpponentEndgameRequest);
    } catch {
      stop();
      publish({
        pending: false,
        error: "Could not start the opponent endgame search.",
      });
    }
  }

  return {
    current,
    start,
    close() {
      stop();
      setSearch(undefined);
    },
  };
}
