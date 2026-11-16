import { useEffect, useMemo, useState } from "react";
import type { EndgameLine } from "../shared/endgame";
import type { Move } from "../shared/model";
import { MOVE_CACHE_LIMIT } from "../shared/move-results";
import type { ReplyPosition } from "../shared/reply-analysis";

const PRECOMPUTED_MOVES = 5;
const ENDGAME_LINES_PER_POSITION = 20;

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
  const [cache, setCache] = useState(
    () => new Map<string, Map<string, EndgameLine>>(),
  );
  const [progress, setProgress] = useState<EndgamePrecomputeProgress>();
  const lines = cache.get(key);
  const exactEndgameSpreads = useMemo(
    () =>
      lines &&
      Object.fromEntries(Array.from(lines, ([id, line]) => [id, line.spread])),
    [lines],
  );

  function rememberEndgame(moveId: string, line: EndgameLine) {
    setCache((previous) => {
      const saved = previous.get(key);
      if (saved?.has(moveId)) return previous;
      const next = new Map(previous);
      const lines = new Map(saved).set(moveId, line);
      if (lines.size > ENDGAME_LINES_PER_POSITION)
        lines.delete(lines.keys().next().value!);
      next.delete(key);
      next.set(key, lines);
      if (next.size > MOVE_CACHE_LIMIT) next.delete(next.keys().next().value!);
      return next;
    });
  }

  useEffect(() => {
    if (!moves || !position || !dictionaryId) return;
    const candidates = moves.slice(0, PRECOMPUTED_MOVES);
    const missing = candidates.filter(({ id }) => !lines?.has(id));
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
        rememberEndgame(data.moveId, data.line);
        next = {
          ...next,
          checked: next.checked + 1,
          ready: next.ready + 1,
        };
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
    cachedEndgame: (moveId: string) => lines?.get(moveId),
    exactEndgameSpreads,
    rememberEndgame,
    endgameProgress:
      progress?.moves === moves && progress?.key === key ? progress : undefined,
  };
}
