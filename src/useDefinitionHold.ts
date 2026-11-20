import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";

const HOLD_MS = 450;
const MAX_MOVEMENT = 10;

export function useDefinitionHold(enabled: boolean, position: unknown) {
  const [locked, setLocked] = useState(false);
  const press = useRef<{
    anchor: HTMLElement;
    pointerId: number;
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout>;
  }>(undefined);
  const held = useRef<{ anchor: HTMLElement; pointerId: number }>(undefined);
  const unlockFrame = useRef<number>(undefined);
  const cancel = useCallback(() => {
    clearTimeout(press.current?.timer);
    press.current = undefined;
  }, []);
  const cancelUnlock = useCallback(() => {
    if (unlockFrame.current !== undefined)
      cancelAnimationFrame(unlockFrame.current);
    unlockFrame.current = undefined;
  }, []);

  useLayoutEffect(() => {
    setLocked(false);
    held.current = undefined;
    return () => {
      cancel();
      cancelUnlock();
    };
  }, [enabled, position, cancel, cancelUnlock]);

  useEffect(() => {
    if (!enabled) return;
    function startNextPress(event: globalThis.PointerEvent) {
      cancel();
      if (!held.current || (event.pointerType === "touch" && !event.isPrimary))
        return;
      held.current = undefined;
      cancelUnlock();
      setLocked(false);
    }
    function unlockAfterRelease() {
      if (!held.current || unlockFrame.current !== undefined) return;
      unlockFrame.current = requestAnimationFrame(() => {
        unlockFrame.current = undefined;
        setLocked(false);
      });
    }
    function release(event: globalThis.PointerEvent) {
      if (event.pointerId === press.current?.pointerId) cancel();
      if (
        event.type === "pointerup" &&
        event.pointerId === held.current?.pointerId
      )
        unlockAfterRelease();
    }
    function endTouches(event: TouchEvent) {
      if (event.touches.length) return;
      cancel();
      // A browser can cancel pointer events while the finger is still down.
      unlockAfterRelease();
    }
    function move(event: globalThis.PointerEvent) {
      const active = press.current;
      if (active?.pointerId === event.pointerId && movedTooFar(event, active))
        cancel();
    }
    function suppressReleaseClick(event: MouseEvent) {
      if (!held.current || event.detail === 0) return;
      unlockAfterRelease();
      held.current = undefined;
      event.preventDefault();
      // The browser can target the new sheet or its backdrop on release.
      event.stopImmediatePropagation();
    }
    document.addEventListener("pointerdown", startNextPress, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    document.addEventListener("touchend", endTouches, {
      capture: true,
      passive: true,
    });
    document.addEventListener("touchcancel", endTouches, {
      capture: true,
      passive: true,
    });
    document.addEventListener("click", suppressReleaseClick, true);
    window.addEventListener("scroll", cancel, true);
    window.addEventListener("blur", cancel);
    return () => {
      document.removeEventListener("pointerdown", startNextPress, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
      document.removeEventListener("touchend", endTouches, true);
      document.removeEventListener("touchcancel", endTouches, true);
      document.removeEventListener("click", suppressReleaseClick, true);
      window.removeEventListener("scroll", cancel, true);
      window.removeEventListener("blur", cancel);
    };
  }, [enabled, cancel, cancelUnlock]);

  return {
    locked,
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
        timer: setTimeout(() => {
          cancel();
          if (!anchor.isConnected || anchor.closest("button:disabled")) return;
          held.current = { anchor, pointerId };
          setLocked(true);
          open(anchor);
        }, HOLD_MS),
      };
    },
    ownsContextMenu(target: EventTarget) {
      return (
        target instanceof Node &&
        !!(held.current?.anchor ?? press.current?.anchor)?.contains(target)
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
