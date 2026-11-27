import { useLayoutEffect, useRef, useState } from "react";
import type { OpponentEndgameTiming } from "./move-timing";
import type { ExactEndgamePosition } from "../shared/reply-analysis";
import type { EndgameLine } from "../shared/endgame";
import type { Player } from "../shared/model";
import { useGameCalculation } from "./components/GameCalculations";
import type {
  OpponentEndgameMessage,
  OpponentEndgameProgress,
  ExactEndgameCheckpoint,
  ExactEndgameContinuation,
  ExactEndgameRequest,
  ExactEndgameResume,
  OpponentEndgameResult,
} from "./parallel-opponent-endgame";

type FinishedSearch = {
  pending: false;
  result: OpponentEndgameResult;
  timing: OpponentEndgameTiming;
  request: ExactEndgameRequest;
  checkpoint?: ExactEndgameCheckpoint;
};
type Search =
  | { pending: true; progress?: OpponentEndgameProgress }
  | FinishedSearch
  | { pending: false; error: string };

export type SavedExactEndgame = { key: string; firstPlayer: Player; value: FinishedSearch };
export type SolvedMoveOptions = { useRackMarks?: boolean; solvedEndgame?: SavedExactEndgame };

export function useExactEndgame(
  key: string | undefined,
  workerLimit: number,
  restore?: SavedExactEndgame,
  clearRestore?: (value: undefined) => void,
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

  useLayoutEffect(() => {
    setSearch(undefined);
    return stop;
  }, [key]);

  useLayoutEffect(() => {
    if (!restore || restore.key !== key) return;
    setSearch(restore);
    clearRestore?.(undefined);
  }, [key, restore, clearRestore]);

  function run(request: ExactEndgameRequest, restored?: FinishedSearch) {
    if (key === undefined) return;
    stop();
    const firstPlayer = request.kind === "solve-own-endgame" ? "you" : "opponent";
    const publish = (value: Search) => setSearch({ key, firstPlayer, value });
    let startedAt = performance.now();
    let elapsed = restored?.timing.total ?? 0;
    publish({ pending: true, progress: restored && { checked: restored.result.checked, total: restored.result.total } });
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
        publish({ pending: false, result, timing: { total: elapsed, batches: result.batches }, request, checkpoint: data.checkpoint });
      };
      worker.onerror = () => {
        if (active.current !== worker) return;
        stop();
        publish({
          pending: false,
          error: "The endgame search stopped unexpectedly.",
        });
      };
      worker.postMessage(restored?.checkpoint ? {
        kind: "resume-exact-endgame", request, checkpoint: restored.checkpoint,
      } satisfies ExactEndgameResume : request);
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
    savedResult: matching && current && "result" in current ? { ...matching, value: current } : undefined,
    start(position: ExactEndgamePosition, dictionaryId: string, cachedLines?: EndgameLine[]) {
      const request = { ...position, dictionaryId, workerLimit };
      run(position.firstPlayer === "you" ? { ...request, kind: "solve-own-endgame", cachedLines }
        : { ...request, kind: "solve-opponent-endgame" });
    },
    continueSearch() {
      if (continueRun.current) continueRun.current();
      else if (current && "result" in current && current.checkpoint)
        run({ ...current.request, workerLimit }, current);
    },
    close() {
      stop();
      setSearch(undefined);
    },
  };
}
