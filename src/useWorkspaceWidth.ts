import { useLayoutEffect, useRef, useState } from "react";

const TWO_COLUMN_WIDTH = 720;

export function useWorkspaceWidth(ready: boolean) {
  const main = useRef<HTMLElement>(null);
  const [twoColumns, setTwoColumns] = useState(false);

  useLayoutEffect(() => {
    const element = main.current;
    if (!ready || !element) return;

    const { paddingLeft, paddingRight } = getComputedStyle(element);
    const padding = (parseFloat(paddingLeft) || 0) + (parseFloat(paddingRight) || 0);
    setTwoColumns(element.clientWidth - padding >= TWO_COLUMN_WIDTH);

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setTwoColumns(entry.contentRect.width >= TWO_COLUMN_WIDTH);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready]);

  return { main, twoColumns };
}
