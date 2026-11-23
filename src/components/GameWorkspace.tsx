import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Rules } from "../../shared/model";
import { MoveDefinitions } from "./MoveDefinitions";

export function useMoveReview(
  narrow: boolean,
  searchId: number | undefined,
  playingReview: boolean | undefined,
) {
  const [dismissed, setDismissed] = useState<number>();
  return {
    showing:
      narrow &&
      (playingReview ?? (searchId !== undefined && dismissed !== searchId)),
    open: () => setDismissed(undefined),
    dismiss: () => setDismissed(searchId),
  };
}

// Use the original key so saved divider positions carry over.
const DIVIDER_POSITION_KEY = "tilewise:phone-rack-width";
const RACK_WIDTH = 44;
const DIVIDER_GAP = 12;
const MIN_BOARD_WIDTH = 144;

function readBoardInset() {
  try {
    const saved = localStorage.getItem(DIVIDER_POSITION_KEY);
    if (saved !== null) {
      const inset = Number(saved);
      if (Number.isSafeInteger(inset) && inset >= RACK_WIDTH) {
        return inset;
      }
    }
  } catch {}
  return RACK_WIDTH;
}

export function GameBoardColumn({
  phone,
  resizeDisabled,
  board,
  warnings,
  rack,
}: {
  phone: boolean;
  resizeDisabled: boolean;
  board: ReactNode;
  warnings: ReactNode;
  rack: (details: HTMLDivElement | null) => ReactNode;
}) {
  const column = useRef<HTMLDivElement>(null);
  const [savedInset, setSavedInset] = useState(readBoardInset);
  const [maxInset, setMaxInset] = useState(RACK_WIDTH);
  const [details, setDetails] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const element = column.current;
    if (!phone || !element) return;
    function measure(width: number) {
      setMaxInset(Math.max(RACK_WIDTH, Math.floor(width) - DIVIDER_GAP - MIN_BOARD_WIDTH));
    }
    measure(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [phone]);

  const boardInset = Math.min(savedInset, maxInset);
  const boardReduction = boardInset - RACK_WIDTH;
  return (
    <div
      ref={column}
      className={phone ? "board-column phone-board-column" : "board-column"}
      style={phone ? {
        "--phone-rack-width": RACK_WIDTH + "px",
        "--phone-rack-gap": DIVIDER_GAP + "px",
        "--phone-board-reduction": boardReduction + "px",
        "--phone-divider-range": `${maxInset - RACK_WIDTH}px`,
      } as CSSProperties : undefined}
    >
      {board}
      {phone && (
        <input
          className="phone-rack-divider"
          type="range"
          aria-label="Board size"
          aria-valuetext={boardReduction ? `${boardReduction} pixels narrower` : "Widest board"}
          min={RACK_WIDTH}
          max={maxInset}
          value={boardInset}
          disabled={resizeDisabled}
          onChange={(event) => {
            const inset = event.currentTarget.valueAsNumber;
            setSavedInset(inset);
            try {
              localStorage.setItem(DIVIDER_POSITION_KEY, String(inset));
            } catch {}
          }}
        />
      )}
      {rack(details)}
      {phone && (
        <>
          {warnings}
          <div className="phone-rack-details" ref={setDetails} />
        </>
      )}
    </div>
  );
}

export default function GameWorkspace({
  definitionRules,
  positionKey,
  narrow,
  reviewing,
  hasWarnings,
  children,
}: {
  definitionRules: Rules;
  positionKey: string;
  narrow: boolean;
  reviewing: boolean;
  hasWarnings: boolean;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (narrow || !hasWarnings) return;
    const warning = root.current?.querySelector(".board-warnings")?.getBoundingClientRect();
    const viewportTop = window.visualViewport?.offsetTop ?? 0;
    const viewportBottom = viewportTop + (window.visualViewport?.height ?? window.innerHeight);
    if (warning && (warning.top < viewportTop || warning.bottom > viewportBottom)) {
      root.current?.scrollIntoView?.({ block: "start", behavior: "instant" });
    }
  }, [hasWarnings, narrow]);

  return (
    <MoveDefinitions rules={definitionRules} position={positionKey} phoneLayout={narrow}>
      <div ref={root} className={reviewing ? "workspace-grid move-review" : "workspace-grid"}>
        {children}
      </div>
    </MoveDefinitions>
  );
}
