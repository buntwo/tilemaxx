import { useEffect, useMemo, useState } from "react";
import {
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
        rackOdds,
        boardOdds,
        replyDeltas,
        endgameId,
      ]),
    [
      searchId,
      filter,
      requiredSquares,
      sort,
      reversed,
      rackOdds,
      boardOdds,
      replyDeltas,
      endgameId,
    ],
  );
  const [received, setReceived] = useState<{
    key: string;
    page?: MovePage;
    exactEndgameSpreads?: MoveQuery["exactEndgameSpreads"];
  }>();
  const response = received?.key === key ? received : undefined;
  const page = response?.page;
  const initial =
    !!results &&
    !filter.trim() &&
    !requiredSquares?.indices.length &&
    sort === "score" &&
    endgameId === undefined &&
    !reversed;
  const head = page?.head ?? (initial ? results.head : []);
  const total = page?.total ?? (initial ? results.total : 0);
  const start = Math.min(offset, Math.max(0, total - visibleMoveRows));
  const slice =
    page ?? (initial ? { offset: 0, rows: results.head } : undefined);
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
  const unavailable = !!response && !page;
  const orderChanged = response?.exactEndgameSpreads !== exactEndgameSpreads;
  const needsPage =
    enabled && !!results && (orderChanged || (!unavailable && !hasWindow));
  // Keep the current rows visible while the worker applies new exact scores.
  const previousOrder = orderChanged && hasWindow ? page : undefined;
  // Keep a window wider than the rendered rows. A small overlapping scroll
  // stays synchronous, and only a new page boundary needs a worker message.
  const pageOffset = Math.max(0, Math.floor((start - 12) / 16) * 16);
  const target = !page && !initial ? 0 : pageOffset;
  useEffect(() => {
    if (!needsPage || searchId === undefined) return;
    let current = true;
    const settle = (next?: MovePage) => {
      if (current)
        setReceived({ key, page: next ?? previousOrder, exactEndgameSpreads });
    };
    void fetchPage(searchId, {
      filter,
      requiredSquares,
      sort,
      reversed,
      offset: target,
      rackOdds,
      boardOdds,
      replyDeltas,
      endgameId,
      exactEndgameSpreads,
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
    rackOdds,
    boardOdds,
    replyDeltas,
    endgameId,
    exactEndgameSpreads,
    previousOrder,
  ]);

  return {
    total,
    bingoCount: page?.bingoCount ?? (initial ? results.bingoCount : 0),
    head,
    start: Math.max(start, slice?.offset ?? 0),
    visible,
    endgame: page?.endgame,
    exactEndgameCount: page?.exactEndgameCount,
    pending: needsPage && !page && !initial,
    unavailable,
  };
}
