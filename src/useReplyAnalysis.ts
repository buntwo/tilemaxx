import { useEffect, useMemo, useRef, useState } from "react";
import {
  REPLY_LIMIT,
  replyScorelessLimit,
  type ReplyDetailOptions,
  type ReplyPosition,
  type ReplyRequest,
  type ReplyResult,
} from "../shared/reply-analysis";
import type { EndgameLine } from "../shared/endgame";
import type { Game, Move } from "../shared/model";
import { MOVE_CACHE_LIMIT } from "../shared/move-results";
import { unseenTiles } from "../shared/tile-pool";

type WorkerMessage = {
  id: number;
  kind: ReplyRequest["kind"];
  moveId?: string;
  result?: ReplyResult;
  line?: EndgameLine;
  done?: boolean;
  error?: string;
};
type Summary = {
  moveList: Move[];
  runKey: string;
  results: Record<string, ReplyResult | undefined>;
  done: boolean;
  error?: string;
};

type Detail = {
  key: string;
  runKey: string;
  pending: boolean;
  result?: ReplyResult;
  line?: EndgameLine;
  error?: string;
};

export function useReplyAnalysis(
  game: Game | undefined,
  positionKey: string | undefined,
  moves: Move[] | null,
  enabled: boolean,
) {
  const [settings, setSettings] = useState<
    Record<string, { bagSize: number; scorelessTurns: number }>
  >({});
  const [summary, setSummary] = useState<Summary>();
  const cache = useRef(new Map<Move[], Summary>());
  const details = useRef(new WeakMap<Move[], Detail>());
  const [detail, setDetail] = useState<Detail>();
  const worker = useRef<Worker | null>(null);
  const activeDetail = useRef<{ id: number; key: string } | undefined>(
    undefined,
  );
  const requestId = useRef(0);
  const pool = useMemo(
    () => game && unseenTiles(game, game.template),
    [game?.board, game?.rack, game?.template],
  );
  const minimumBag =
    pool && game ? Math.max(0, pool.total - game.template.rackSize) : 0;
  const options = settings[positionKey ?? ""];
  const confirmed = !!options;
  const bagSize = options?.bagSize ?? minimumBag;
  const scorelessTurns = options?.scorelessTurns ?? 0;
  const moveList = enabled && moves?.length ? moves : undefined;
  const runKey = JSON.stringify([positionKey, bagSize, scorelessTurns]);
  const cached = moveList && cache.current.get(moveList);
  const current =
    summary?.moveList === moveList && summary?.runKey === runKey
      ? summary
      : cached?.runKey === runKey
        ? cached
        : undefined;
  // Solve results arrive in score order. Keep that order when the view is filtered or sorted.
  const target = useMemo(
    () => moveList?.slice(0, REPLY_LIMIT) ?? [],
    [moveList],
  );
  const reference = target[0];
  const invalid = !!pool?.excess.length;
  const bagAssumedEmpty = bagSize === 0 && !confirmed && (pool?.total ?? 0) > 0;
  const opponentRack =
    bagSize === 0 && pool && !invalid
      ? pool.tiles.map(({ symbol, count }) => symbol.repeat(count)).join("")
      : "";
  const position: ReplyPosition | undefined = game && {
    board: game.board,
    rack: game.rack,
    template: game.template,
    bagSize,
    scorelessTurns,
  };
  const dictionaryId = game?.dictionaryId;

  useEffect(() => {
    setSummary(undefined);
    setDetail(undefined);
    if (!moveList || !reference || !position || !dictionaryId || invalid)
      return;
    const active = new Worker(new URL("./reply.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = active;
    const id = ++requestId.current;
    function publish(next: Summary) {
      cache.current.delete(moveList!);
      cache.current.set(moveList!, next);
      if (cache.current.size > MOVE_CACHE_LIMIT + 1)
        cache.current.delete(cache.current.keys().next().value!);
      setSummary(next);
    }
    let previous = cache.current.get(moveList);
    if (previous?.runKey !== runKey) previous = undefined;
    active.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (worker.current !== active) return;
      const message = event.data;
      if (message.kind === "reply-summary") {
        if (message.id !== id) return;
        const results = previous?.results ?? {};
        previous = {
          moveList,
          runKey,
          results: message.moveId
            ? { ...results, [message.moveId]: message.result }
            : results,
          done: !!message.done,
          error: message.error,
        };
        publish(previous);
      } else if (message.id === activeDetail.current?.id) {
        const next = {
          key: activeDetail.current.key,
          runKey,
          pending: false,
          result: message.result,
          line: message.line,
          error: message.error,
        };
        const saved = details.current.get(moveList);
        const result =
          next.result ??
          (saved?.key === next.key && saved.runKey === runKey
            ? saved.result
            : undefined);
        const resolved = { ...next, result };
        if (!resolved.error) details.current.set(moveList, resolved);
        setDetail(resolved);
      }
    };
    active.onerror = () => {
      if (worker.current !== active) return;
      active.terminate();
      worker.current = null;
      const error = "Reply analysis stopped unexpectedly.";
      setSummary((current) => ({
        moveList,
        runKey,
        results: current?.results ?? {},
        done: true,
        error,
      }));
      setDetail((current) =>
        current?.pending ? { ...current, pending: false, error } : current,
      );
    };
    const request: ReplyRequest = {
      ...position,
      dictionaryId,
      id,
      reference,
      kind: "reply-summary",
      candidates: target,
    };
    if (!previous?.done || previous.error) {
      const remaining = target.filter(
        ({ id }) => !(id in (previous?.results ?? {})),
      );
      active.postMessage({ ...request, candidates: remaining });
    }
    return () => {
      if (worker.current === active) worker.current = null;
      active.terminate();
      activeDetail.current = undefined;
    };
  }, [moveList, runKey, dictionaryId, invalid]);

  function requestDetail(candidate: Move, options: ReplyDetailOptions) {
    if (!worker.current || !reference || !position || !dictionaryId) return;
    const key = `${options.kind}:${candidate.id}`;
    const id = ++requestId.current;
    activeDetail.current = { id, key };
    setDetail((previous) => ({
      key,
      runKey,
      pending: true,
      result:
        previous?.key === key && previous.runKey === runKey
          ? previous.result
          : undefined,
    }));
    const request: ReplyRequest = {
      ...position,
      dictionaryId,
      id,
      ...options,
      candidate,
      reference,
    };
    worker.current.postMessage(request);
  }

  return {
    enabled,
    bagSize,
    minimumBag,
    unseen: pool?.total ?? 0,
    invalid,
    bagAssumedEmpty,
    opponentRack,
    maxScorelessTurns: game ? replyScorelessLimit(game.template) - 1 : 5,
    scorelessTurns,
    setOptions: (bagSize: number, scorelessTurns: number) =>
      setSettings((current) =>
        Object.fromEntries(
          [
            ...Object.entries(current).filter(
              ([key]) => key !== (positionKey ?? ""),
            ),
            [positionKey ?? "", { bagSize, scorelessTurns }],
          ].slice(-(MOVE_CACHE_LIMIT + 1)),
        ),
      ),
    target,
    results: current?.results,
    pending: !!moveList && !invalid && !current?.done,
    error: current?.error,
    reference,
    detail:
      detail?.runKey === runKey
        ? detail
        : moveList && details.current.get(moveList)?.runKey === runKey
          ? details.current.get(moveList)
          : undefined,
    requestDetail,
  };
}
