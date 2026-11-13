import { useEffect, useMemo, useRef, useState } from "react";
import {
  REPLY_LIMIT,
  replyScorelessLimit,
  type ReplyPosition,
  type ReplyRequest,
  type ReplyResult,
} from "../shared/reply-analysis";
import type { EndgameLine } from "../shared/endgame";
import type { Game, Move } from "../shared/model";
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
  const [settings, setSettings] = useState<{
    key?: string;
    bagSize?: number;
    scorelessTurns?: number;
  }>();
  const [summary, setSummary] = useState<{
    moveList: Move[];
    runKey: string;
    results: Record<string, ReplyResult | undefined>;
    done: boolean;
    error?: string;
  }>();
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
  const confirmed =
    settings?.key === positionKey && settings?.bagSize !== undefined;
  const bagSize = confirmed ? settings.bagSize! : minimumBag;
  const scorelessTurns =
    (settings?.key === positionKey ? settings?.scorelessTurns : undefined) ?? 0;
  const moveList = enabled && moves?.length ? moves : undefined;
  const runKey = JSON.stringify([positionKey, bagSize, scorelessTurns]);
  const current =
    summary?.moveList === moveList && summary?.runKey === runKey
      ? summary
      : undefined;
  // Solve results arrive in score order. Keep that order when the view is filtered or sorted.
  const target = useMemo(
    () => moveList?.slice(0, REPLY_LIMIT) ?? [],
    [moveList],
  );
  const reference = target[0];
  const invalid = !!pool?.excess.length;
  const bagAssumedEmpty = bagSize === 0 && !confirmed && (pool?.total ?? 0) > 0;
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
    active.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (worker.current !== active) return;
      const message = event.data;
      if (message.kind === "reply-summary") {
        if (message.id !== id) return;
        setSummary((current) => {
          const results =
            current?.moveList === moveList && current.runKey === runKey
              ? current.results
              : {};
          return {
            moveList,
            runKey,
            results: message.moveId
              ? { ...results, [message.moveId]: message.result }
              : results,
            done: !!message.done,
            error: message.error,
          };
        });
      } else if (message.id === activeDetail.current?.id) {
        const next = {
          key: activeDetail.current.key,
          runKey,
          pending: false,
          result: message.result,
          line: message.line,
          error: message.error,
        };
        setDetail(next);
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
    active.postMessage(request);
    return () => {
      if (worker.current === active) worker.current = null;
      active.terminate();
      activeDetail.current = undefined;
    };
  }, [moveList, runKey, dictionaryId, invalid]);

  function requestDetail(kind: "reply-refine" | "reply-line", candidate: Move) {
    if (!worker.current || !reference || !position || !dictionaryId) return;
    const key = `${kind}:${candidate.id}`;
    const id = ++requestId.current;
    activeDetail.current = { id, key };
    setDetail({ key, runKey, pending: true });
    const request: ReplyRequest = {
      ...position,
      dictionaryId,
      id,
      kind,
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
    maxScorelessTurns: game ? replyScorelessLimit(game.template) - 1 : 5,
    scorelessTurns,
    setOptions: (bagSize: number, scorelessTurns: number) =>
      setSettings({ key: positionKey, bagSize, scorelessTurns }),
    target,
    results: current?.results,
    pending: !!moveList && !invalid && !current?.done,
    error: current?.error,
    reference,
    detail: detail?.runKey === runKey ? detail : undefined,
    requestDetail,
  };
}
