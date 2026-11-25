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
const RACK_WITH_DRAW_WIDTH = 68;
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
  drawShelf,
  resizeDisabled,
  board,
  warnings,
  rack,
}: {
  phone: boolean;
  drawShelf: boolean;
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

  const rackWidth = drawShelf ? RACK_WITH_DRAW_WIDTH : RACK_WIDTH;
  const dividerMax = Math.max(rackWidth, maxInset);
  const boardInset = Math.max(rackWidth, Math.min(savedInset, dividerMax));
  const boardReduction = boardInset - rackWidth;
  return (
    <div
      ref={column}
      className={phone ? "board-column phone-board-column" : "board-column"}
      style={phone ? {
        "--phone-rack-width": rackWidth + "px",
        "--phone-rack-gap": DIVIDER_GAP + "px",
        "--phone-board-reduction": boardReduction + "px",
        "--phone-divider-range": `${dividerMax - rackWidth}px`,
      } as CSSProperties : undefined}
    >
      {board}
      {phone && (
        <input
          className="phone-rack-divider"
          type="range"
          aria-label="Board size"
          aria-valuetext={boardReduction ? `${boardReduction} pixels narrower` : "Widest board"}
          min={rackWidth}
          max={dividerMax}
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

const DESKTOP_BOARD_WIDTH_KEY = "tilemaxx:desktop-board-width";
const DESKTOP_MIN_BOARD = 272;
const DESKTOP_MIN_SIDE = 320;
const DESKTOP_GUTTER = 14;

function readDesktopBoardWidth() {
  try {
    const width = Number(localStorage.getItem(DESKTOP_BOARD_WIDTH_KEY));
    if (Number.isSafeInteger(width) && width >= DESKTOP_MIN_BOARD) return width;
  } catch {}
}

function useDesktopDivider(root: { current: HTMLDivElement | null }, narrow: boolean) {
  const [savedWidth, setSavedWidth] = useState(readDesktopBoardWidth);
  const [space, setSpace] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useLayoutEffect(() => {
    const workspace = root.current;
    if (!workspace || narrow) return;
    function measure(width: number) {
      const height = window.innerHeight;
      setSpace((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    }
    const onResize = () => measure(workspace.clientWidth || window.innerWidth);
    onResize();
    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(workspace);
    window.addEventListener("resize", onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [narrow, root]);

  const max = Math.max(
    DESKTOP_MIN_BOARD,
    Math.floor(space.width) - DESKTOP_GUTTER - DESKTOP_MIN_SIDE,
  );
  const defaultWidth = Math.min(space.width * .54, Math.max(320, space.height - 188));
  const value = Math.max(
    DESKTOP_MIN_BOARD,
    Math.min(max, savedWidth ?? Math.round(defaultWidth)),
  );
  return {
    max,
    value,
    style: {
      "--desktop-board-width": `${value}px`,
      "--desktop-board-min": `${DESKTOP_MIN_BOARD}px`,
      "--desktop-divider-width": `${DESKTOP_GUTTER}px`,
      "--desktop-divider-range": `${max - DESKTOP_MIN_BOARD}px`,
    } as CSSProperties,
    saveWidth(width: number) {
      setSavedWidth(width);
      try {
        localStorage.setItem(DESKTOP_BOARD_WIDTH_KEY, String(width));
      } catch {}
    },
  };
}

export default function GameWorkspace({
  definitionRules,
  positionKey,
  narrow,
  resizeDisabled,
  reviewing,
  replaying,
  hasWarnings,
  children,
}: {
  definitionRules: Rules;
  positionKey: string;
  narrow: boolean;
  resizeDisabled: boolean;
  reviewing: boolean;
  replaying: boolean;
  hasWarnings: boolean;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const divider = useDesktopDivider(root, narrow);
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
      <div
        ref={root}
        className={`workspace-grid${reviewing ? " move-review" : ""}${replaying ? " replay-workspace" : ""}`}
        style={narrow ? undefined : divider.style}
      >
        {children}
        {!narrow && (
          <>
            <span className="desktop-divider-line" aria-hidden="true" />
            <input
              className="desktop-board-divider"
              type="range"
              aria-label="Board size"
              aria-valuetext={`${divider.value} pixels wide`}
              min={DESKTOP_MIN_BOARD}
              max={divider.max}
              value={divider.value}
              disabled={resizeDisabled || divider.max === DESKTOP_MIN_BOARD}
              onChange={(event) => divider.saveWidth(event.currentTarget.valueAsNumber)}
            />
          </>
        )}
      </div>
    </MoveDefinitions>
  );
}
