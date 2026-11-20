import { useState } from "react";
import type { MoveStyle } from "../shared/move-results";

export type MoveListView = "all" | "shortlist" | "style";

export function useMoveListNavigation(searchId?: number, style?: MoveStyle) {
  const [navigation, setNavigation] = useState<{
    searchId: number;
    path: MoveListView[];
  }>();
  const home: MoveListView = style ? "style" : "all";
  const path: MoveListView[] = navigation && navigation.searchId === searchId
    ? navigation.path : [home];
  const view = path.at(-1) ?? home;
  const previousView = path.at(-2);

  function toggle(target: Exclude<MoveListView, "style">) {
    if (searchId === undefined || (target === view && !previousView)) return false;
    // Returning to a view already on the path drops the views opened after it.
    const earlier = path.indexOf(target);
    const next = target === view
      ? path.slice(0, -1)
      : earlier >= 0 ? path.slice(0, earlier + 1) : [...path, target];
    setNavigation({ searchId, path: next });
    return true;
  }

  return { view, previousView, toggle, reset: () => setNavigation(undefined) };
}

export type MoveListNavigation = ReturnType<typeof useMoveListNavigation>;
