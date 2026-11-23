import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

function capture(viewport: VisualViewport) {
  return {
    width: viewport.width,
    height: viewport.height,
    scrollY: window.scrollY,
    opened: false,
    shifted: false,
    manualScroll: false,
  };
}

export function useRackKeyboard(
  phone: boolean,
  reviewing: boolean,
  cursor: number,
  rack: RefObject<HTMLDivElement | null>,
  input: RefObject<HTMLInputElement | null>,
) {
  const session = useRef<ReturnType<typeof capture>>(null);
  const schedule = useRef<() => void>(null);

  useLayoutEffect(() => {
    if (reviewing) session.current = null;
    else schedule.current?.();
  }, [reviewing, cursor]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!phone || !viewport) return;
    let frame = 0;
    function adjust() {
      frame = 0;
      const edit = session.current;
      if (!edit || !viewport) return;
      if (viewport.scale !== 1 || Math.abs(viewport.width - edit.width) > 1) {
        session.current = null;
        return;
      }
      const active = document.activeElement;
      const rackFocused = active === input.current;
      const heightLost = edit.height - viewport.height;
      const keyboardInset = window.innerHeight - viewport.height;
      // Ignore ordinary browser toolbar changes. Wait for the keyboard to
      // finish closing before restoring the document's scroll position.
      if (heightLost < (edit.opened ? 48 : 80) && keyboardInset < 100) {
        if (!edit.opened) return;
        if (
          edit.shifted &&
          !edit.manualScroll &&
          (rackFocused || active === document.body)
        )
          window.scrollTo({ top: edit.scrollY, behavior: "instant" });
        session.current = rackFocused ? capture(viewport) : null;
        return;
      }
      if (!rackFocused || edit.manualScroll) return;
      edit.opened = true;
      const top = viewport.offsetTop + 8;
      const bottom = viewport.offsetTop + viewport.height - 8;
      const tray = rack.current?.getBoundingClientRect();
      if (!tray) return;
      const rect = tray.height <= bottom - top
        ? tray
        : rack.current?.querySelector(".rack-tile.selected")?.getBoundingClientRect();
      if (!rect) return;
      const offset =
        rect.bottom > bottom
          ? rect.bottom - bottom
          : Math.min(0, rect.top - top);
      if (Math.abs(offset) < 1) return;
      const before = window.scrollY;
      window.scrollBy({ top: offset, behavior: "instant" });
      edit.shifted ||= window.scrollY !== before;
    }
    function queueAdjust() {
      if (!frame) frame = requestAnimationFrame(adjust);
    }
    function allowManualScroll() {
      if (session.current?.opened) session.current.manualScroll = true;
    }
    schedule.current = queueAdjust;
    viewport.addEventListener("resize", queueAdjust);
    viewport.addEventListener("scroll", queueAdjust);
    window.addEventListener("touchmove", allowManualScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", queueAdjust);
      viewport.removeEventListener("scroll", queueAdjust);
      window.removeEventListener("touchmove", allowManualScroll);
      session.current = null;
      schedule.current = null;
    };
  }, [phone, input, rack]);

  return function trackFocus() {
    const viewport = window.visualViewport;
    if (!phone || !viewport || viewport.scale !== 1) return;
    session.current = capture(viewport);
    schedule.current?.();
  };
}
