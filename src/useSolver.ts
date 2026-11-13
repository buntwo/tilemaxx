import { useCallback, useEffect, useRef, useState } from "react";
import type { Game, Move } from "../shared/model";
import type { BoardOddsResult, RackOdds } from "../shared/bingo-odds";
import type { DefenseResults } from "../shared/premium-defense";
import type {
  MovePage,
  MoveQuery,
  MoveResults,
  ShortlistOptions,
} from "../shared/move-results";
import { MOVE_CACHE_LIMIT } from "../shared/move-results";
import type { ShortlistEntry } from "../shared/move-shortlist";
import type { SolverMessage, SolverRequest } from "./solver-messages";

type Snapshot = {
  results: MoveResults | null;
  elapsed: number;
  warnings: string[];
  rackOdds?: RackOdds;
  defense?: DefenseResults;
  boardOdds?: BoardOddsResult;
};
const emptySnapshot: Snapshot = { results: null, elapsed: 0, warnings: [] };
type QueryReply = Extract<SolverMessage, { kind: "page" | "shortlist" }>;

export function useSolver(positionKey: string) {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [snapshotKey, setSnapshotKey] = useState(positionKey);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [rackOddsPending, setRackOddsPending] = useState(false);
  const [defenseProgress, setDefenseProgress] = useState<number>();
  const [boardOddsProgress, setBoardOddsProgress] = useState<{
    checked: number;
    total: number;
  }>();
  const [boardOddsError, setBoardOddsError] = useState("");
  const worker = useRef<Worker | null>(null);
  const oddsWorker = useRef<Worker | null>(null);
  const nextId = useRef(0);
  const solving = useRef<number | undefined>(undefined);
  const visibleSearch = useRef<number | undefined>(undefined);
  const queries = useRef(new Map<number, (message?: QueryReply) => void>());
  const saved = useRef(new Map<string, Snapshot>());
  const restore = useRef<string | null>(null);

  function stopBoardOdds() {
    oddsWorker.current?.terminate();
    oddsWorker.current = null;
    setBoardOddsProgress(undefined);
  }

  function stopSearch() {
    const id = solving.current;
    if (id === undefined) return;
    solving.current = undefined;
    if (visibleSearch.current === undefined && !saved.current.size) {
      worker.current?.terminate();
      worker.current = null;
      for (const complete of queries.current.values()) complete();
      queries.current.clear();
    } else {
      worker.current?.postMessage({
        kind: "cancel",
        searchId: id,
      } satisfies SolverRequest);
      if (id !== visibleSearch.current) discard(id);
    }
    setBusy("");
    setRackOddsPending(false);
    setDefenseProgress(undefined);
  }

  function discard(searchId: number | undefined) {
    if (
      searchId === undefined ||
      Array.from(saved.current.values()).some(
        (item) => item.results?.searchId === searchId,
      )
    )
      return;
    worker.current?.postMessage({
      kind: "discard",
      searchId,
    } satisfies SolverRequest);
  }

  useEffect(() => {
    stopSearch();
    stopBoardOdds();
    const restored =
      restore.current === positionKey
        ? saved.current.get(positionKey)
        : undefined;
    restore.current = null;
    const previous = visibleSearch.current;
    visibleSearch.current = restored?.results?.searchId;
    if (previous !== visibleSearch.current) discard(previous);
    setSnapshotKey(positionKey);
    setSnapshot(restored ?? emptySnapshot);
    setBusy("");
    setError("");
    setRackOddsPending(false);
    setDefenseProgress(undefined);
    setBoardOddsError("");
  }, [positionKey]);

  useEffect(
    () => () => {
      worker.current?.terminate();
      oddsWorker.current?.terminate();
      worker.current = oddsWorker.current = null;
      for (const complete of queries.current.values()) complete();
      queries.current.clear();
    },
    [],
  );

  function startWorker() {
    if (worker.current) return worker.current;
    const active = new Worker(new URL("./solver.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = active;
    active.onmessage = ({ data: message }: MessageEvent<SolverMessage>) => {
      if (worker.current !== active) return;
      if (message.kind === "page" || message.kind === "shortlist") {
        const complete = queries.current.get(message.id);
        queries.current.delete(message.id);
        complete?.(message);
        return;
      }
      if (message.id !== solving.current) return;
      switch (message.kind) {
        case "solve-status":
          setBusy(message.status);
          break;
        case "solve-error":
          solving.current = undefined;
          setError(message.error);
          setBusy("");
          break;
        case "moves": {
          discard(visibleSearch.current);
          visibleSearch.current = message.id;
          const { results, warnings, elapsed } = message;
          setSnapshot({ results, warnings, elapsed });
          setBusy("");
          const pending = results.total > 0;
          setRackOddsPending(pending);
          setDefenseProgress(pending ? 0 : undefined);
          if (!pending) solving.current = undefined;
          break;
        }
        case "defense":
          if (message.defense)
            setSnapshot((current) => ({
              ...current,
              defense: message.defense,
            }));
          if (message.done) setDefenseProgress(undefined);
          break;
        case "defense-progress":
          setDefenseProgress(message.checked);
          break;
        case "rack-odds":
          solving.current = undefined;
          setRackOddsPending(false);
          setSnapshot((current) => ({ ...current, rackOdds: message.odds }));
          break;
      }
    };
    active.onerror = () => {
      if (worker.current !== active) return;
      active.terminate();
      worker.current = null;
      solving.current = visibleSearch.current = undefined;
      saved.current.clear();
      for (const complete of queries.current.values()) complete();
      queries.current.clear();
      setSnapshot(emptySnapshot);
      setBusy("");
      setRackOddsPending(false);
      setDefenseProgress(undefined);
      setError("The solver stopped unexpectedly. Try again.");
    };
    return active;
  }

  function solve(game: Game) {
    if (busy) {
      stopSearch();
      return;
    }
    stopSearch();
    stopBoardOdds();
    setError("");
    setBusy("Finding moves…");
    setSnapshot((current) => ({
      ...current,
      rackOdds: undefined,
      defense: undefined,
      boardOdds: undefined,
    }));
    setBoardOddsError("");
    const id = ++nextId.current;
    try {
      const active = startWorker();
      solving.current = id;
      const { dictionaryId, board, rack, excludedRackSlots, template } = game;
      active.postMessage({
        id,
        kind: "solve",
        dictionaryId,
        board,
        rack,
        excludedRackSlots,
        template,
      } satisfies SolverRequest);
    } catch {
      stopSearch();
      setBusy("");
      setError("The solver could not start. Try again.");
    }
  }

  function runBoardOdds(game: Game, candidates: Move[], bagSize: number) {
    if (
      solving.current !== undefined ||
      oddsWorker.current ||
      !candidates.length
    )
      return;
    setSnapshot((current) => ({ ...current, boardOdds: undefined }));
    setBoardOddsError("");
    setBoardOddsProgress({ checked: 0, total: candidates.length });
    try {
      const active = new Worker(
        new URL("./solver.worker.ts", import.meta.url),
        {
          type: "module",
        },
      );
      oddsWorker.current = active;
      const id = ++nextId.current;
      active.onmessage = ({ data: message }: MessageEvent<SolverMessage>) => {
        if (oddsWorker.current !== active || message.id !== id) return;
        if (message.kind === "board-odds-progress") {
          setBoardOddsProgress({
            checked: message.checked,
            total: candidates.length,
          });
        } else if (message.kind === "board-odds") {
          stopBoardOdds();
          setSnapshot((current) => ({ ...current, boardOdds: message.odds }));
          setBoardOddsError(message.error ?? "");
        }
      };
      active.onerror = () => {
        if (oddsWorker.current !== active) return;
        stopBoardOdds();
        setBoardOddsError("The board check stopped unexpectedly. Try again.");
      };
      const { dictionaryId, board, rack, template } = game;
      active.postMessage({
        id,
        kind: "board-odds",
        dictionaryId,
        board,
        rack,
        template,
        candidates,
        bagSize,
      } satisfies SolverRequest);
    } catch {
      stopBoardOdds();
      setBoardOddsError("The board check could not start. Try again.");
    }
  }

  const query = useCallback(
    (
      request:
        | Omit<Extract<SolverRequest, { kind: "page" }>, "id">
        | Omit<Extract<SolverRequest, { kind: "shortlist" }>, "id">,
    ) =>
      new Promise<QueryReply | undefined>((resolve) => {
        const active = worker.current;
        if (!active) return resolve(undefined);
        const id = ++nextId.current;
        queries.current.set(id, resolve);
        try {
          active.postMessage({ ...request, id });
        } catch {
          queries.current.delete(id);
          resolve(undefined);
        }
      }),
    [],
  );
  const page = useCallback(
    async (
      searchId: number,
      options: MoveQuery,
    ): Promise<MovePage | undefined> => {
      const result = await query({ kind: "page", searchId, query: options });
      return result?.kind === "page" ? result.page : undefined;
    },
    [query],
  );
  const shortlist = useCallback(
    async (
      searchId: number,
      options: ShortlistOptions,
    ): Promise<ShortlistEntry[] | undefined> => {
      const result = await query({ kind: "shortlist", searchId, options });
      return result?.kind === "shortlist" ? result.shortlist : undefined;
    },
    [query],
  );

  function rememberResults() {
    if (!snapshot.results) return;
    const cache = saved.current;
    const old = cache.get(positionKey);
    cache.delete(positionKey);
    cache.set(positionKey, snapshot);
    if (old?.results?.searchId !== visibleSearch.current)
      discard(old?.results?.searchId);
    if (cache.size > MOVE_CACHE_LIMIT) {
      const key = cache.keys().next().value!;
      const dropped = cache.get(key);
      cache.delete(key);
      discard(dropped?.results?.searchId);
    }
  }

  return {
    ...(snapshotKey === positionKey ? snapshot : emptySnapshot),
    busy,
    error,
    rackOddsPending,
    defenseProgress,
    boardOddsProgress,
    boardOddsError,
    solve,
    page,
    shortlist,
    runBoardOdds,
    cancelBoardOdds: stopBoardOdds,
    rememberResults,
    restoreOnUndo: (key: string) => {
      restore.current = key;
    },
  };
}
