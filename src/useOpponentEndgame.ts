import { useEffect, useRef, useState } from "react";
import type { OpponentEndgameTiming } from "./move-timing";
import type { ExactEndgamePosition } from "../shared/reply-analysis";
import type { EndgameLine } from "../shared/endgame";
import type { Player } from "../shared/model";
import { useGameCalculation } from "./components/GameCalculations";
import type {
  OpponentEndgameMessage,
  OpponentEndgameProgress,
  ExactEndgameContinuation,
  ExactEndgameRequest,
  OpponentEndgameResult,
} from "./parallel-opponent-endgame";

type Search =
  | { pending: true; progress?: OpponentEndgameProgress }
  | { pending: false; result: OpponentEndgameResult; timing: OpponentEndgameTiming }
  | { pending: false; error: string };

export function useExactEndgame(
  key: string | undefined,
  workerLimit: number,
) {
  const [search, setSearch] = useState<{ key: string; firstPlayer: Player; value: Search }>();
  const active = useRef<Worker | null>(null);
  const continueRun = useRef<(() => void) | null>(null);
  const matching = search?.key === key ? search : undefined;
  const current = matching?.value;
  useGameCalculation(!!current?.pending);

  function stop() {
    active.current?.terminate();
    active.current = null;
    continueRun.current = null;
  }

  useEffect(() => {
    setSearch(undefined);
    return stop;
  }, [key]);

  function start(position: ExactEndgamePosition, dictionaryId: string, cachedLines?: EndgameLine[]) {
    if (key === undefined) return;
    stop();
    const firstPlayer = position.firstPlayer ?? "opponent";
    const publish = (value: Search) => setSearch({ key, firstPlayer, value });
    let startedAt = performance.now();
    let elapsed = 0;
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
        if (!("result" in data)) {
          stop();
          publish({ pending: false, error: data.error });
          return;
        }
        const { result } = data;
        elapsed += performance.now() - startedAt;
        if (result.checked === result.total) stop();
        else {
          continueRun.current = () => {
            continueRun.current = null;
            startedAt = performance.now();
            publish({ pending: true, progress: { checked: result.checked, total: result.total } });
            try {
              worker.postMessage({ kind: "continue-exact-endgame" } satisfies ExactEndgameContinuation);
            } catch {
              stop();
              publish({ pending: false, error: "Could not continue the endgame search." });
            }
          };
        }
        publish({ pending: false, result, timing: { total: elapsed, batches: result.batches } });
      };
      worker.onerror = () => {
        if (active.current !== worker) return;
        stop();
        publish({
          pending: false,
          error: "The endgame search stopped unexpectedly.",
        });
      };
      const request = { ...position, dictionaryId, workerLimit };
      worker.postMessage(firstPlayer === "you" ? {
        ...request, kind: "solve-own-endgame", cachedLines,
      } satisfies ExactEndgameRequest : {
        ...request, kind: "solve-opponent-endgame",
      } satisfies ExactEndgameRequest);
    } catch {
      stop();
      publish({
        pending: false,
        error: "Could not start the endgame search.",
      });
    }
  }

  return {
    current,
    firstPlayer: matching?.firstPlayer,
    start,
    continueSearch: () => continueRun.current?.(),
    close() {
      stop();
      setSearch(undefined);
    },
  };
}
