import { useEffect, useMemo, useState } from "react";
import {
  moveComparator,
  type MovePage,
  type MoveQuery,
  type MoveResults,
} from "../shared/move-results";

export const visibleMoveRows = 30;
export const moveRowHeight = 58;

export type FetchMovePage = (
  searchId: number,
  query: MoveQuery,
) => Promise<MovePage | undefined>;

export function useMoveResults(
  results: MoveResults | null,
  query: MoveQuery,
  fetchPage: FetchMovePage,
  enabled: boolean,
) {
  const {
    filter,
    requiredSquares,
    sort,
    reversed,
    offset,
    rackOdds,
    boardOdds,
    replyDeltas,
    endgameId,
    exactEndgameSpreads,
  } = query;
  const searchId = results?.searchId;
  const key = useMemo(
    () =>
      JSON.stringify([
        searchId,
        filter,
        requiredSquares,
        sort,
        reversed,
        endgameId,
      ]),
    [searchId, filter, requiredSquares, sort, reversed, endgameId],
  );
  const orderData = useMemo(
    () => ({ rackOdds, boardOdds, replyDeltas, exactEndgameSpreads }),
    [rackOdds, boardOdds, replyDeltas, exactEndgameSpreads],
  );
  const [received, setReceived] = useState<{
    key: string;
    page?: MovePage;
    orderData: typeof orderData;
  }>();
  const response = received?.key === key ? received : undefined;
  const page = response?.page;
  const initialHead = useMemo(() => {
    if (!results || filter.trim() || requiredSquares?.indices.length || endgameId !== undefined)
      return undefined;
    if (sort === "score" && !reversed) return results.head;
    if (sort !== "reply-adjusted") return undefined;

    // The opening reply batch covers the score-ranked head. Apply its order
    // immediately when every adjusted move is already in that local window.
    const ids = new Set(results.head.map(({ id }) => id));
    if (Object.keys(replyDeltas ?? {}).some((id) => !ids.has(id))) return undefined;
    return [...results.head].sort(moveComparator({ sort, reversed, replyDeltas }));
  }, [results, filter, requiredSquares, endgameId, sort, reversed, replyDeltas]);
  const head = page?.head ?? initialHead ?? [];
  const total = page?.total ?? (initialHead ? results?.total : 0) ?? 0;
  const start = Math.min(offset, Math.max(0, total - visibleMoveRows));
  const slice =
    page ?? (initialHead && { offset: 0, rows: initialHead });
  const visible =
    slice?.rows.slice(
      Math.max(0, start - slice.offset),
      Math.max(0, start + visibleMoveRows - slice.offset),
    ) ?? [];
  const hasWindow =
    !!slice &&
    start >= slice.offset &&
    Math.min(total, start + visibleMoveRows) <=
      slice.offset + slice.rows.length;
  const orderChanged = !!response && response.orderData !== orderData;
  const unavailable = !!response && !page && !orderChanged;
  const needsPage =
    enabled && !!results && (orderChanged || (!unavailable && !hasWindow));
  // New analysis can reorder moves while the user is scrolled into this page.
  const previousOrder = orderChanged && hasWindow ? page : undefined;
  // Keep a window wider than the rendered rows. A small overlapping scroll
  // stays synchronous, and only a new page boundary needs a worker message.
  const pageOffset = Math.max(0, Math.floor((start - 12) / 16) * 16);
  const target = !page && !initialHead ? 0 : pageOffset;
  useEffect(() => {
    if (!needsPage || searchId === undefined) return;
    let current = true;
    const settle = (next?: MovePage) => {
      if (current)
        setReceived({ key, page: next ?? previousOrder, orderData });
    };
    void fetchPage(searchId, {
      filter,
      requiredSquares,
      sort,
      reversed,
      offset: target,
      endgameId,
      ...orderData,
    }).then(settle, () => settle());
    return () => {
      current = false;
    };
  }, [
    needsPage,
    searchId,
    key,
    target,
    fetchPage,
    filter,
    requiredSquares,
    sort,
    reversed,
    endgameId,
    orderData,
    previousOrder,
  ]);

  return {
    total,
    bingoCount: page?.bingoCount ?? (initialHead ? results?.bingoCount : 0) ?? 0,
    head,
    start: Math.max(start, slice?.offset ?? 0),
    visible,
    scoreRanks: page?.scoreRanks,
    endgame: page?.endgame,
    exactEndgameCount: page?.exactEndgameCount,
    pending: needsPage && !page && !initialHead,
    unavailable,
  };
}
