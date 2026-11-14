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
  const { filter, sort, offset, rackOdds, boardOdds, replyDeltas } = query;
  const searchId = results?.searchId;
  const key = useMemo(
    () =>
      JSON.stringify([
        searchId,
        filter,
        sort,
        rackOdds,
        boardOdds,
        replyDeltas,
      ]),
    [searchId, filter, sort, rackOdds, boardOdds, replyDeltas],
  );
  const [received, setReceived] = useState<{ key: string; page?: MovePage }>();
  const response = received?.key === key ? received : undefined;
  const page = response?.page;
  const initial = !!results && !filter.trim() && sort === "score";
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
  const needsPage = enabled && !!results && !unavailable && !hasWindow;
  // Keep a window wider than the rendered rows. A small overlapping scroll
  // stays synchronous, and only a new page boundary needs a worker message.
  const pageOffset = Math.max(0, Math.floor((start - 12) / 16) * 16);
  const target = !page && !initial ? 0 : pageOffset;
  useEffect(() => {
    if (!needsPage || searchId === undefined) return;
    let current = true;
    const settle = (next?: MovePage) => {
      if (current) setReceived({ key, page: next });
    };
    void fetchPage(searchId, {
      filter,
      sort,
      offset: target,
      rackOdds,
      boardOdds,
      replyDeltas,
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
    sort,
    rackOdds,
    boardOdds,
    replyDeltas,
  ]);

  return {
    total,
    head,
    start: Math.max(start, slice?.offset ?? 0),
    visible,
    pending: needsPage && !page && !initial,
    unavailable,
  };
}
