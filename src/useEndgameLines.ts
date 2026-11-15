import { useEffect, useRef } from "react";
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
  | { done: true };

export function useEndgameLines(
  moves: Move[] | undefined,
  position: ReplyPosition | undefined,
  dictionaryId: string | undefined,
  key: string,
) {
  const cache = useRef(new Map<string, Map<string, EndgameLine>>());

  useEffect(() => {
    if (!moves || !position || !dictionaryId) return;
    const lines = cache.current.get(key) ?? new Map<string, EndgameLine>();
    const missing = moves
      .slice(0, PRECOMPUTED_MOVES)
      .filter(({ id }) => !lines.has(id));
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
        stop();
        return;
      }
      lines.set(data.moveId, data.line);
      if (lines.size > PRECOMPUTED_MOVES)
        lines.delete(lines.keys().next().value!);
      cache.current.delete(key);
      cache.current.set(key, lines);
      if (cache.current.size > MOVE_CACHE_LIMIT)
        cache.current.delete(cache.current.keys().next().value!);
    };
    worker.onerror = stop;
    worker.postMessage({
      ...position,
      kind: "precompute-endgames",
      dictionaryId,
      moves: missing,
    } satisfies EndgamePrecomputeRequest);
    return stop;
  }, [moves, position, dictionaryId, key]);

  return (moveId: string) => cache.current.get(key)?.get(moveId);
}
