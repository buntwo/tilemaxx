import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type PointerEvent,
} from "react";

const HOLD_MS = 450;
const MAX_MOVEMENT = 10;

export function useDefinitionHold(enabled: boolean, position: unknown) {
  const press = useRef<{
    anchor: HTMLElement;
    pointerId: number;
    x: number;
    y: number;
    startedAt: number;
    open: (anchor: HTMLElement) => void;
  }>(undefined);
  const held = useRef<HTMLElement>(undefined);
  const cancel = useCallback(() => {
    press.current = undefined;
  }, []);

  useLayoutEffect(() => {
    held.current = undefined;
    return cancel;
  }, [enabled, position, cancel]);

  useEffect(() => {
    if (!enabled) return;
    function startNextPress() {
      cancel();
      held.current = undefined;
    }
    function release(event: globalThis.PointerEvent) {
      const active = press.current;
      if (!active || event.pointerId !== active.pointerId) return;
      cancel();
      if (
        event.type !== "pointerup" ||
        event.timeStamp - active.startedAt < HOLD_MS ||
        movedTooFar(event, active) ||
        !active.anchor.isConnected ||
        active.anchor.closest("button:disabled")
      )
        return;
      // Keep the sheet out of the way until the finger is lifted.
      held.current = active.anchor;
      active.open(active.anchor);
    }
    function move(event: globalThis.PointerEvent) {
      const active = press.current;
      if (active?.pointerId === event.pointerId && movedTooFar(event, active))
        cancel();
    }
    function suppressReleaseClick(event: MouseEvent) {
      if (!held.current || event.detail === 0) return;
      held.current = undefined;
      event.preventDefault();
      // The browser can target the new sheet or its backdrop on release.
      event.stopImmediatePropagation();
    }
    document.addEventListener("pointerdown", startNextPress, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    document.addEventListener("click", suppressReleaseClick, true);
    window.addEventListener("scroll", cancel, true);
    window.addEventListener("blur", cancel);
    return () => {
      document.removeEventListener("pointerdown", startNextPress, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
      document.removeEventListener("click", suppressReleaseClick, true);
      window.removeEventListener("scroll", cancel, true);
      window.removeEventListener("blur", cancel);
    };
  }, [enabled, cancel]);

  return {
    start(
      event: PointerEvent<HTMLElement>,
      open: (anchor: HTMLElement) => void,
    ) {
      if (
        !enabled ||
        event.pointerType !== "touch" ||
        !event.isPrimary ||
        event.button !== 0
      )
        return;
      const { currentTarget: anchor, pointerId, clientX, clientY } = event;
      press.current = {
        anchor,
        pointerId,
        x: clientX,
        y: clientY,
        startedAt: event.timeStamp,
        open,
      };
    },
    ownsContextMenu(target: EventTarget) {
      return (
        target instanceof Node &&
        !!(held.current ?? press.current?.anchor)?.contains(target)
      );
    },
  };
}

function movedTooFar(
  event: globalThis.PointerEvent,
  start: { x: number; y: number },
) {
  return (
    Math.hypot(event.clientX - start.x, event.clientY - start.y) > MAX_MOVEMENT
  );
}
