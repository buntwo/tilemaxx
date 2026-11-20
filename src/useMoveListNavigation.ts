import { useState } from "react";
import type { MoveStyle } from "../shared/move-results";

type AlternateView = "all" | "shortlist";
export type MoveListView = AlternateView | "style";

export function useMoveListNavigation(searchId?: number, style?: MoveStyle) {
  const [alternate, setAlternate] = useState<{
    searchId: number;
    view: AlternateView;
  }>();
  const home: MoveListView = style ? "style" : "all";
  const view: MoveListView = alternate && alternate.searchId === searchId
    ? alternate.view
    : home;
  const returnView = view === home ? undefined : home;

  function toggle(target: AlternateView) {
    if (searchId === undefined || (target === view && !returnView)) return false;
    setAlternate(target === view || target === home ? undefined : { searchId, view: target });
    return true;
  }

  return { view, returnView, toggle, reset: () => setAlternate(undefined) };
}

export type MoveListNavigation = ReturnType<typeof useMoveListNavigation>;
