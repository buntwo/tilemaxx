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

const RACK_WIDTH_KEY = "tilewise:phone-rack-width";
const RACK_MIN_WIDTH = 44;
const RACK_MAX_WIDTH = 64;

function readRackWidth() {
  try {
    const saved = localStorage.getItem(RACK_WIDTH_KEY);
    if (saved !== null) {
      const width = Number(saved);
      if (Number.isInteger(width) && width >= RACK_MIN_WIDTH && width <= RACK_MAX_WIDTH) {
        return width;
      }
    }
  } catch {}
  return RACK_MIN_WIDTH;
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
  const [rackWidth, setRackWidth] = useState(readRackWidth);
  const [details, setDetails] = useState<HTMLDivElement | null>(null);
  return (
    <div
      className={phone ? "board-column phone-board-column" : "board-column"}
      style={phone ? {
        "--phone-rack-width": rackWidth + "px",
        "--phone-rack-min": RACK_MIN_WIDTH + "px",
        "--phone-rack-range": `${RACK_MAX_WIDTH - RACK_MIN_WIDTH}px`,
      } as CSSProperties : undefined}
    >
      {board}
      {phone && (
        <input
          className="phone-rack-divider"
          type="range"
          aria-label="Rack width"
          aria-valuetext={rackWidth + " pixels"}
          min={RACK_MIN_WIDTH}
          max={RACK_MAX_WIDTH}
          value={rackWidth}
          disabled={resizeDisabled}
          onChange={(event) => {
            const width = event.currentTarget.valueAsNumber;
            setRackWidth(width);
            try {
              localStorage.setItem(RACK_WIDTH_KEY, String(width));
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
