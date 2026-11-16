import { useEffect, useRef, useState } from "react";
import type { EndgameLine } from "../shared/endgame";
import type { Move } from "../shared/model";
import { MOVE_CACHE_LIMIT } from "../shared/move-results";
import type { ReplyPosition } from "../shared/reply-analysis";

const PRECOMPUTED_MOVES = 5;

export type EndgamePrecomputeRequest = ReplyPosition & {
  kind: "precompute-endgames";
  dictionaryId: string;
  moves: Move[];
};

export type EndgamePrecomputeMessage =
  | { moveId: string; line: EndgameLine }
  | { moveId: string; limit: string }
  | { done: true; error?: string };

type EndgamePrecomputeProgress = {
  moves: Move[];
  key: string;
  total: number;
  checked: number;
  ready: number;
  pending: boolean;
  limits: string[];
  error?: string;
};

export function useEndgameLines(
  moves: Move[] | undefined,
  position: ReplyPosition | undefined,
  dictionaryId: string | undefined,
  key: string,
) {
  const cache = useRef(new Map<string, Map<string, EndgameLine>>());
  const [progress, setProgress] = useState<EndgamePrecomputeProgress>();

  useEffect(() => {
    if (!moves || !position || !dictionaryId) return;
    const lines = cache.current.get(key) ?? new Map<string, EndgameLine>();
    const candidates = moves.slice(0, PRECOMPUTED_MOVES);
    const missing = candidates.filter(({ id }) => !lines.has(id));
    const ready = candidates.length - missing.length;
    let next: EndgamePrecomputeProgress = {
      moves,
      key,
      total: candidates.length,
      checked: ready,
      ready,
      pending: !!missing.length,
      limits: [],
    };
    setProgress(next);
    if (!missing.length) return;
    const worker = new Worker(
      new URL("./analysis.worker.ts", import.meta.url),
      {
        type: "module",
      },
    );
    let active = true;
    function stop() {
      if (!active) return;
      active = false;
      worker.terminate();
    }
    worker.onmessage = ({ data }: MessageEvent<EndgamePrecomputeMessage>) => {
      if (!active) return;
      if ("done" in data) {
        setProgress({ ...next, pending: false, error: data.error });
        stop();
        return;
      }
      if ("line" in data) {
        lines.set(data.moveId, data.line);
        if (lines.size > PRECOMPUTED_MOVES)
          lines.delete(lines.keys().next().value!);
        cache.current.delete(key);
        cache.current.set(key, lines);
        if (cache.current.size > MOVE_CACHE_LIMIT)
          cache.current.delete(cache.current.keys().next().value!);
        next = { ...next, checked: next.checked + 1, ready: next.ready + 1 };
      } else {
        const word = candidates.find(({ id }) => id === data.moveId)?.word;
        next = {
          ...next,
          checked: next.checked + 1,
          limits: [...next.limits, `${word}: ${data.limit}`],
        };
      }
      setProgress(next);
    };
    worker.onerror = () => {
      if (!active) return;
      setProgress({
        ...next,
        pending: false,
        error: "Background endgame search stopped unexpectedly.",
      });
      stop();
    };
    worker.postMessage({
      ...position,
      kind: "precompute-endgames",
      dictionaryId,
      moves: missing,
    } satisfies EndgamePrecomputeRequest);
    return stop;
    // Equivalent game snapshots from sync share a key and do not restart the worker.
  }, [moves, dictionaryId, key]);

  return {
    cachedEndgame: (moveId: string) => cache.current.get(key)?.get(moveId),
    endgameProgress:
      progress?.moves === moves && progress?.key === key ? progress : undefined,
  };
}
