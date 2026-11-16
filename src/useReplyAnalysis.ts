import { useEffect, useMemo, useRef, useState } from "react";
import {
  REPLY_LIMIT,
  type ReplyDetailOptions,
  type ReplyPosition,
  type ReplyRequest,
  type ReplyResult,
} from "../shared/reply-analysis";
import {
  endgameStreaks,
  type EndgameLine,
  type EndgameSettings,
} from "../shared/endgame";
import type { Game, Move } from "../shared/model";
import { MOVE_CACHE_LIMIT, type EndgameRanking } from "../shared/move-results";
import { unseenTiles } from "../shared/tile-pool";
import type { RankEndgame } from "./useSolver";
import { useEndgameLines } from "./useEndgameLines";

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
  endgame?: { searchId: number | undefined; rank: RankEndgame },
) {
  const [settings, setSettings] = useState<
    Record<string, { bagSize: number } & EndgameSettings>
  >({});
  const [summary, setSummary] = useState<Summary>();
  const cache = useRef(new Map<Move[], Summary>());
  const details = useRef(new WeakMap<Move[], Detail>());
  const [detail, setDetail] = useState<Detail>();
  const [estimateResult, setEstimateResult] = useState<{
    key: string;
    ranking?: EndgameRanking;
  }>();
  const [skippedEstimate, setSkippedEstimate] = useState<string>();
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
  const opponentHasFinalTurn = options?.opponentHasFinalTurn ?? true;
  const crossplay = game?.template.rules === "crossplay";
  const streak = game && endgameStreaks[game.template.rules];
  const invalid = !!pool?.excess.length;
  const runKey = JSON.stringify([
    positionKey,
    bagSize,
    scorelessTurns,
    opponentHasFinalTurn,
  ]);
  const searchId = endgame?.searchId;
  const rank = endgame?.rank;
  const eligibleEstimate =
    rank &&
    searchId !== undefined &&
    enabled &&
    moves?.length &&
    bagSize === 0 &&
    !invalid &&
    pool &&
    (pool.total || crossplay)
      ? JSON.stringify([searchId, runKey])
      : undefined;
  const estimateKey =
    eligibleEstimate === skippedEstimate ? undefined : eligibleEstimate;
  const estimateRun =
    estimateKey && estimateResult?.key === estimateKey
      ? estimateResult
      : undefined;
  const ranking = estimateRun?.ranking;
  const moveList =
    enabled && moves?.length
      ? ranking?.checked
        ? ranking.head
        : moves
      : undefined;
  useEffect(() => {
    if (!rank || searchId === undefined || !estimateKey || !game) return;
    const key = estimateKey;
    const abort = new AbortController();
    function finish(ranking?: EndgameRanking) {
      if (!abort.signal.aborted) setEstimateResult({ key, ranking });
    }
    void rank(
      searchId,
      game,
      { scorelessTurns, opponentHasFinalTurn },
      abort.signal,
    ).then(finish, () => finish());
    return () => abort.abort();
  }, [rank, searchId, estimateKey, scorelessTurns, opponentHasFinalTurn]);
  const cached = moveList && cache.current.get(moveList);
  const current =
    summary?.moveList === moveList && summary?.runKey === runKey
      ? summary
      : cached?.runKey === runKey
        ? cached
        : undefined;
  // Give inline replies to the ranked suggestions while retaining the raw
  // top-scoring play as the baseline for reply comparisons.
  const target = useMemo(() => {
    if (!moveList) return [];
    const head = moveList.slice(0, REPLY_LIMIT);
    if (moveList !== moves) {
      const ids = new Set(head.map(({ id }) => id));
      head.push(
        ...(moves?.slice(0, REPLY_LIMIT).filter(({ id }) => !ids.has(id)) ??
          []),
      );
    }
    return head;
  }, [moveList, moves]);
  const reference = moveList && moves?.[0];
  const opponentRack =
    bagSize === 0 && pool && !invalid
      ? pool.tiles.map(({ symbol, count }) => symbol.repeat(count)).join("")
      : "";
  const position = useMemo<ReplyPosition | undefined>(
    () => game && {
      board: game.board,
      rack: game.rack,
      template: game.template,
      bagSize,
      scorelessTurns,
      opponentHasFinalTurn,
    },
    [game?.board, game?.rack, game?.template, bagSize, scorelessTurns, opponentHasFinalTurn],
  );
  const dictionaryId = game?.dictionaryId;
  const { cachedEndgame, endgameProgress } = useEndgameLines(
    estimateRun ? moveList : undefined,
    position,
    dictionaryId,
    runKey,
  );

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
    const key = `${options.kind}:${candidate.id}`;
    const line = options.kind === "reply-line" ? cachedEndgame(candidate.id) : undefined;
    if (line) {
      activeDetail.current = undefined;
      setDetail({ key, runKey, pending: false, line });
      return;
    }
    if (!worker.current || !reference || !position || !dictionaryId) return;
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

  const savedDetail = moveList && details.current.get(moveList);
  const currentDetail =
    detail?.runKey === runKey
      ? detail
      : savedDetail?.runKey === runKey
        ? savedDetail
        : undefined;
  const linePrefix = "reply-line:";
  const backgroundLine = currentDetail?.key.startsWith(linePrefix)
    ? cachedEndgame(currentDetail.key.slice(linePrefix.length))
    : undefined;

  return {
    enabled,
    bagSize,
    minimumBag,
    unseen: pool?.total ?? 0,
    invalid,
    bagConfirmed: confirmed,
    opponentRack,
    maxScorelessTurns: (streak?.limit ?? 1) - 1,
    passesOnly: !!streak?.passesOnly,
    crossplay,
    scorelessTurns,
    opponentHasFinalTurn,
    cachedEndgame,
    endgameProgress,
    ranking,
    estimatingEndgame: !!estimateKey && !estimateRun,
    skipEndgameEstimate: () => setSkippedEstimate(estimateKey),
    endgameEstimateUnavailable: !!estimateRun && !ranking?.checked,
    setOptions: (
      bagSize: number,
      scorelessTurns: number,
      opponentHasFinalTurn = true,
    ) =>
      setSettings((current) =>
        Object.fromEntries(
          [
            ...Object.entries(current).filter(
              ([key]) => key !== (positionKey ?? ""),
            ),
            [
              positionKey ?? "",
              { bagSize, scorelessTurns, opponentHasFinalTurn },
            ],
          ].slice(-(MOVE_CACHE_LIMIT + 1)),
        ),
      ),
    target,
    results: current?.results,
    pending: !!moveList && !invalid && !current?.done,
    error: current?.error,
    reference,
    detail:
      currentDetail && backgroundLine
        ? { ...currentDetail, pending: false, error: undefined, line: backgroundLine }
        : currentDetail,
    requestDetail,
  };
}
