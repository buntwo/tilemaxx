import { useLayoutEffect, useRef, useState } from "react";

// Allow 720px for the board and moves plus two 16px workspace gutters.
const WIDE_WORKSPACE_WIDTH = 752;
// At this width a 200px docked sidebar still leaves 760px for the game.
const SIDEBAR_DOCK_WIDTH = 992;

function layoutAtWidth(width: number) {
  return {
    narrowLayout: width < WIDE_WORKSPACE_WIDTH,
    sidebarOverlay: width < SIDEBAR_DOCK_WIDTH,
  };
}

export function useWorkspaceLayout(ready: boolean) {
  const shell = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(() => layoutAtWidth(window.innerWidth));

  useLayoutEffect(() => {
    const element = shell.current;
    if (!ready || !element) return;

    // The shell width stays the same when the sidebar opens or closes.
    function update(width: number) {
      const next = layoutAtWidth(width);
      setLayout((current) =>
        current.narrowLayout === next.narrowLayout &&
        current.sidebarOverlay === next.sidebarOverlay
          ? current
          : next,
      );
    }

    update(element.clientWidth || window.innerWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready]);

  return { shell, ...layout };
}
