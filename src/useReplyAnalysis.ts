import { useEffect, useMemo, useRef, useState } from "react";
import {
  REPLY_LIMIT,
  type ReplyDetailOptions,
  type ReplyPosition,
  type ReplyRequest,
  type ReplyResult,
  type ReplySearchLimit,
  type ReplyWorkerMessage,
} from "../shared/reply-analysis";
import {
  endgameStreaks,
  type EndgameLine,
  type EndgameSettings,
} from "../shared/endgame";
import type { Game, Move } from "../shared/model";
import type { ReplyCandidate } from "../shared/reply-candidates";
import { MOVE_CACHE_LIMIT, type EndgameRanking } from "../shared/move-results";
import { unseenTiles } from "../shared/tile-pool";
import type { RankEndgame } from "./useSolver";
import { useEndgameLines } from "./useEndgameLines";
import { computeWorkerLimit } from "./compute-workers";

type Summary = {
  moveList: Move[];
  runKey: string;
  results: Record<string, ReplyResult | undefined>;
  done: boolean;
  elapsed?: number;
  error?: string;
  limit?: ReplySearchLimit;
  skippedLimits?: Record<string, ReplySearchLimit>;
};

type Detail = {
  key: string;
  runKey: string;
  pending: boolean;
  racksChecked?: number;
  result?: ReplyResult;
  line?: EndgameLine;
  error?: string;
  limit?: ReplySearchLimit;
};

export function useReplyAnalysis(
  game: Game | undefined,
  positionKey: string | undefined,
  moves: Move[] | null,
  enabled: boolean,
  endgame?: { searchId: number | undefined; rank: RankEndgame },
  workerLimit = computeWorkerLimit(),
  extraCandidates?: ReplyCandidate[] | null,
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
    elapsed: number;
  }>();
  const [skippedEstimate, setSkippedEstimate] = useState<string>();
  const worker = useRef<Worker | null>(null);
  const activeDetail = useRef<{ id: number; key: string; moveId: string } | undefined>(
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
  const extras = bagSize > 0 ? extraCandidates : undefined;
  const planning = enabled && extras === null;
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
    const started = performance.now();
    function finish(ranking?: EndgameRanking) {
      if (!abort.signal.aborted)
        setEstimateResult({ key, ranking, elapsed: performance.now() - started });
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
    } else if (extras) {
      head.push(...extras.map(({ move }) => move));
    }
    return head;
  }, [moveList, moves, extras]);
  const extraReasons = useMemo(
    () => Object.fromEntries((extras ?? []).map(({ move, reason }) => [move.id, reason])),
    [extras],
  );
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
  const endgameMoves = estimateRun ? moveList : undefined;
  const {
    cachedEndgame, exactEndgameSpreads, rememberEndgame, endgameProgress,
    canContinueEndgames, continueEndgames,
  } = useEndgameLines(
    endgameMoves,
    position,
    dictionaryId,
    runKey,
    workerLimit,
  );

  useEffect(() => {
    setSummary(undefined);
    setDetail(undefined);
    if (!moveList || !reference || !position || !dictionaryId || invalid || planning)
      return;
    const active = new Worker(new URL("./reply.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = active;
    const id = ++requestId.current;
    const started = performance.now();
    function publish(next: Summary) {
      cache.current.delete(moveList!);
      cache.current.set(moveList!, next);
      if (cache.current.size > MOVE_CACHE_LIMIT + 1)
        cache.current.delete(cache.current.keys().next().value!);
      setSummary(next);
    }
    let previous = cache.current.get(moveList);
    if (previous?.runKey !== runKey) previous = undefined;
    active.onmessage = (event: MessageEvent<ReplyWorkerMessage>) => {
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
          elapsed: message.done ? performance.now() - started : undefined,
          error: message.error,
          limit: message.moveId ? undefined : message.limit,
          skippedLimits:
            message.moveId && message.limit
              ? { ...previous?.skippedLimits, [message.moveId]: message.limit }
              : previous?.skippedLimits,
        };
        publish(previous);
      } else if (message.id === activeDetail.current?.id) {
        const { key, moveId } = activeDetail.current;
        const { racksChecked } = message;
        if (racksChecked !== undefined) {
          setDetail((current) =>
            current?.pending && current.key === key && current.runKey === runKey
              ? { ...current, racksChecked }
              : current,
          );
          return;
        }
        activeDetail.current = undefined;
        if (message.line) rememberEndgame(moveId, message.line);
        const next = {
          key,
          runKey,
          pending: false,
          result: message.result,
          line: message.line,
          error: message.error,
          limit: message.limit,
        };
        const saved = details.current.get(moveList);
        const result =
          next.result ??
          (saved?.key === next.key && saved.runKey === runKey
            ? saved.result
            : undefined);
        const resolved = { ...next, result };
        if (message.kind === "reply-histogram" && message.result?.kind === "distribution") {
          const skippedLimits = { ...previous?.skippedLimits };
          delete skippedLimits[moveId];
          previous = {
            moveList,
            runKey,
            done: false,
            ...previous,
            results: { ...previous?.results, [moveId]: message.result },
            skippedLimits,
          };
          publish(previous);
        }
        if (!resolved.error && !resolved.limit)
          details.current.set(moveList, resolved);
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
        elapsed: performance.now() - started,
        error,
        skippedLimits: current?.skippedLimits,
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
      workerLimit,
    };
    const remaining = target.filter(({ id }) => !(id in (previous?.results ?? {})));
    if (!previous?.done || previous.error || previous.limit || remaining.length) {
      if (previous?.done && remaining.length) {
        previous = { ...previous, done: false, elapsed: undefined };
        publish(previous);
      }
      active.postMessage({ ...request, candidates: remaining });
    }
    return () => {
      if (worker.current === active) worker.current = null;
      active.terminate();
      activeDetail.current = undefined;
    };
  }, [moveList, runKey, dictionaryId, invalid, workerLimit, planning, target]);

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
    activeDetail.current = { id, key, moveId: candidate.id };
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

  const pending = !!moveList && !invalid && !current?.done;
  const estimatingEndgame = !!estimateKey && !estimateRun;
  const detailResult = currentDetail && backgroundLine
    ? { ...currentDetail, pending: false, error: undefined, line: backgroundLine }
    : currentDetail;
  const calculatingEndgameLines =
    !!endgameMoves && !!dictionaryId && (endgameProgress?.pending ?? true);

  return {
    enabled,
    calculating:
      pending || estimatingEndgame || calculatingEndgameLines || !!detailResult?.pending,
    bagSize,
    minimumBag,
    unseen: pool?.total ?? 0,
    unseenPool: pool,
    invalid,
    bagConfirmed: confirmed,
    opponentRack,
    maxScorelessTurns: (streak?.limit ?? 1) - 1,
    passesOnly: !!streak?.passesOnly,
    crossplay,
    scorelessTurns,
    opponentHasFinalTurn,
    cachedEndgame,
    exactEndgameSpreads,
    rememberEndgame,
    endgameProgress,
    canContinueEndgames,
    continueEndgames,
    repliesElapsed: current?.elapsed,
    estimatesElapsed: estimateRun?.elapsed,
    ranking,
    estimatingEndgame,
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
    extraReasons,
    canRequestHistogram: enabled && !!reference && bagSize > 0 && !invalid && !planning,
    results: current?.results,
    pending,
    error: current?.error,
    limit: current?.limit,
    skippedLimits: current?.skippedLimits,
    reference,
    detail: detailResult,
    requestDetail,
  };
}
