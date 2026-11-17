import { useEffect, useMemo, useRef, useState } from "react";
import type { EndgameLine } from "../shared/endgame";
import type { Move } from "../shared/model";
import { MOVE_CACHE_LIMIT } from "../shared/move-results";
import type { ReplyPosition } from "../shared/reply-analysis";
import type { ExactLineTiming } from "./move-timing";

const PRECOMPUTED_MOVES = 6;
const ENDGAME_LINES_PER_POSITION = 20;

export type EndgamePrecomputeRequest = ReplyPosition & {
  id: number;
  dictionaryId: string;
  moves: Move[];
  workerLimit: number;
} & ({ kind: "precompute-endgames" } | { kind: "continue-endgames" });
export type EndgamePrecomputeMessage = { id: number } & (
  | { moveId: string; line: EndgameLine; elapsed: number }
  | { moveId: string; limit: string; elapsed: number }
  | { done: true; error?: string }
);

type EndgamePrecomputeProgress = {
  moves: Move[];
  key: string;
  total: number;
  checked: number;
  ready: number;
  pending: boolean;
  limits: string[];
  error?: string;
  elapsed?: number;
  attempts: ExactLineTiming[];
};

export function useEndgameLines(
  moves: Move[] | undefined,
  position: ReplyPosition | undefined,
  dictionaryId: string | undefined,
  key: string,
  workerLimit: number,
) {
  const [cache, setCache] = useState(
    () => new Map<string, Map<string, EndgameLine>>(),
  );
  const [progress, setProgress] = useState<EndgamePrecomputeProgress>();
  const continueRun = useRef<(() => void) | undefined>(undefined);
  const requestId = useRef(0);
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
      const next = new Map(previous),
        lines = new Map(saved).set(moveId, line);
      if (lines.size > ENDGAME_LINES_PER_POSITION)
        lines.delete(lines.keys().next().value!);
      next.delete(key);
      next.set(key, lines);
      if (next.size > MOVE_CACHE_LIMIT) next.delete(next.keys().next().value!);
      return next;
    });
  }
  useEffect(() => {
    continueRun.current = undefined;
    if (!moves || !position || !dictionaryId) return;
    const candidates = moves.slice(0, PRECOMPUTED_MOVES),
      missing = candidates.filter(({ id }) => !lines?.has(id));
    const ready = candidates.length - missing.length;
    let next: EndgamePrecomputeProgress = {
      moves,
      key,
      total: candidates.length,
      checked: ready,
      ready,
      pending: !!missing.length,
      limits: [],
      attempts: [],
    };
    setProgress(next);
    if (!missing.length) return;
    const worker = new Worker(
      new URL("./analysis.worker.ts", import.meta.url),
      { type: "module" },
    );
    const responded = new Set<string>();
    let active = true,
      id = 0,
      started = 0,
      elapsed = 0;
    const finished = new Set(
      candidates.filter((move) => lines?.has(move.id)).map((move) => move.id),
    );
    function stop() {
      if (!active) return;
      active = false;
      continueRun.current = undefined;
      worker.terminate();
    }
    function run(kind: EndgamePrecomputeRequest["kind"]) {
      if (!active) return;
      const remaining = missing.filter((move) => !finished.has(move.id));
      if (!remaining.length) return;
      responded.clear();
      id = ++requestId.current;
      started = performance.now();
      next = {
        ...next,
        pending: true,
        checked: finished.size,
        limits: [],
        elapsed: undefined,
        error: undefined,
      };
      setProgress(next);
      worker.postMessage({
        ...position!,
        id,
        kind,
        dictionaryId: dictionaryId!,
        moves: remaining,
        workerLimit,
      } satisfies EndgamePrecomputeRequest);
    }
    worker.onmessage = ({ data }: MessageEvent<EndgamePrecomputeMessage>) => {
      if (!active || !next.pending || data.id !== id) return;
      if ("done" in data) {
        elapsed += performance.now() - started;
        next = { ...next, pending: false, error: data.error, elapsed };
        setProgress(next);
        if (data.error || finished.size === candidates.length) stop();
        return;
      }
      const move = missing.find((move) => move.id === data.moveId);
      if (!move || finished.has(move.id) || responded.has(move.id)) return;
      responded.add(move.id);
      const prior = next.attempts.find(
        (attempt) => attempt.move.id === move.id,
      );
      const attempt: ExactLineTiming = {
        move: {
          id: move.id,
          word: move.word,
          row: move.row,
          tiles: move.tiles,
          col: move.col,
          direction: move.direction,
        },
        elapsed: (prior?.elapsed ?? 0) + data.elapsed,
        limit: "limit" in data ? data.limit : undefined,
      };
      const attempts = next.attempts
        .filter((a) => a.move.id !== move.id)
        .concat(attempt);
      if ("line" in data) {
        finished.add(move.id);
        rememberEndgame(move.id, data.line);
      }
      next = {
        ...next,
        attempts,
        checked: next.checked + 1,
        ready: finished.size,
        limits: attempts
          .filter((a) => a.limit && !finished.has(a.move.id))
          .map((a) => `${a.move.word}: ${a.limit}`),
      };
      setProgress(next);
    };
    worker.onerror = () => {
      if (!active) return;
      next = {
        ...next,
        pending: false,
        error: "Background endgame search stopped unexpectedly.",
        elapsed: elapsed + performance.now() - started,
      };
      setProgress(next);
      stop();
    };
    continueRun.current = () => {
      if (!next.pending && !next.error) run("continue-endgames");
    };
    run("precompute-endgames");
    return stop;
    // Equivalent sync snapshots share the key and keep the worker session.
  }, [moves, dictionaryId, key, workerLimit]);
  const current =
    progress?.moves === moves && progress?.key === key ? progress : undefined;
  return {
    cachedEndgame: (moveId: string) => lines?.get(moveId),
    exactEndgameSpreads,
    rememberEndgame,
    endgameProgress: current,
    canContinueEndgames:
      !!current &&
      !current.pending &&
      !current.error &&
      !!current.limits.length,
    continueEndgames: () => continueRun.current?.(),
  };
}
