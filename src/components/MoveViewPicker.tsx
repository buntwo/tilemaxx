import { useEffect, useRef, type MouseEvent, type PointerEvent } from "react";

export type MoveListView = "all" | "shortlist";

const HOLD_MS = 450;
const HOLD_MOVE_LIMIT = 10;

export default function MoveViewPicker({
  active,
  canPreview,
  count,
  onPreview,
  onSelect,
}: {
  active?: MoveListView;
  canPreview: boolean;
  count: number;
  onPreview: (view: MoveListView | undefined) => void;
  onSelect: (view: MoveListView) => void;
}) {
  const press = useRef<{
    id: number;
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout>;
  }>(undefined);
  const skipClick = useRef(false);

  useEffect(() => {
    function cancel() {
      if (!press.current) return;
      clearTimeout(press.current.timer);
      press.current = undefined;
      skipClick.current = true;
      onPreview(undefined);
    }
    window.addEventListener("blur", cancel);
    return () => {
      cancel();
      window.removeEventListener("blur", cancel);
    };
  }, [canPreview, onPreview]);

  function start(event: PointerEvent<HTMLButtonElement>, view: MoveListView) {
    if (event.isPrimary === false || event.button !== 0 || press.current) return;
    skipClick.current = false;
    if (!canPreview) return;
    const { pointerId: id, clientX: x, clientY: y, currentTarget } = event;
    currentTarget.setPointerCapture?.(id);
    const timer = setTimeout(() => {
      skipClick.current = true;
      onPreview(view);
    }, HOLD_MS);
    press.current = { id, x, y, timer };
  }

  function end(event: PointerEvent<HTMLButtonElement>, canceled = false) {
    if (press.current?.id !== event.pointerId) return;
    clearTimeout(press.current.timer);
    press.current = undefined;
    if (canceled) skipClick.current = true;
    onPreview(undefined);
  }

  function select(event: MouseEvent<HTMLButtonElement>, view: MoveListView) {
    if (skipClick.current && event.detail !== 0) {
      skipClick.current = false;
      return;
    }
    onSelect(view);
  }

  return (
    <div className="result-view-picker" role="group" aria-label="Move list view">
      {(["all", "shortlist"] as const).map((view) => (
        <button
          key={view}
          type="button"
          aria-pressed={active === view}
          aria-description={canPreview ? "Hold to preview" : undefined}
          data-move-preview-action
          onPointerDown={(event) => start(event, view)}
          onPointerMove={(event) => {
            const current = press.current;
            if (
              current?.id === event.pointerId &&
              Math.hypot(event.clientX - current.x, event.clientY - current.y) >
                HOLD_MOVE_LIMIT
            ) end(event, true);
          }}
          onPointerUp={end}
          onPointerCancel={(event) => end(event, true)}
          onLostPointerCapture={(event) => end(event, true)}
          onContextMenu={(event) => {
            if (press.current || skipClick.current) event.preventDefault();
          }}
          onClick={(event) => select(event, view)}
        >
          {view === "all" ? "All moves" : <>Shortlist <span>{count}</span></>}
        </button>
      ))}
    </div>
  );
}
