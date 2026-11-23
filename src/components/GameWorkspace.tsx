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
const MAX_BOARD_INSET = 104;

function readBoardInset() {
  try {
    const saved = localStorage.getItem(DIVIDER_POSITION_KEY);
    if (saved !== null) {
      const inset = Number(saved);
      if (Number.isInteger(inset) && inset >= RACK_WIDTH && inset <= MAX_BOARD_INSET) {
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
  const [boardInset, setBoardInset] = useState(readBoardInset);
  const [details, setDetails] = useState<HTMLDivElement | null>(null);
  const boardReduction = boardInset - RACK_WIDTH;
  return (
    <div
      className={phone ? "board-column phone-board-column" : "board-column"}
      style={phone ? {
        "--phone-rack-width": RACK_WIDTH + "px",
        "--phone-board-inset": boardInset + "px",
        "--phone-divider-range": `${MAX_BOARD_INSET - RACK_WIDTH}px`,
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
          max={MAX_BOARD_INSET}
          value={boardInset}
          disabled={resizeDisabled}
          onChange={(event) => {
            const inset = event.currentTarget.valueAsNumber;
            setBoardInset(inset);
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
