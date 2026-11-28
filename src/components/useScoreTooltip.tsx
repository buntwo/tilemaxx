import {
  useEffect, useId, useLayoutEffect, useRef, useState,
  type ButtonHTMLAttributes, type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export function useScoreTooltip<T>(describe: (item: T) => ReactNode) {
  const id = useId();
  const [active, setActive] = useState<{
    item: T;
    key: string | number;
    anchor: HTMLButtonElement;
    pinned: boolean;
  }>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const held = useRef(false);
  const touchStart = useRef<{ x: number; y: number }>(undefined);
  const tip = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>();
  function cancelTimer() {
    clearTimeout(timer.current);
  }
  function close() {
    cancelTimer();
    setActive(undefined);
  }
  function show(item: T, key: string | number, anchor: HTMLButtonElement, pinned = false) {
    cancelTimer();
    setActive((current) =>
      current?.anchor === anchor && current.pinned && !pinned
        ? current
        : { item, key, anchor, pinned },
    );
  }
  function leave() {
    cancelTimer();
    timer.current = setTimeout(() => {
      setActive((current) => (current?.pinned ? current : undefined));
    }, 150);
  }
  useEffect(() => cancelTimer, []);
  useEffect(() => {
    if (!active) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest(".definition-tooltip, .definition-sheet")) return;
      if (
        event.target instanceof Node &&
        !active?.anchor.contains(event.target) &&
        !tip.current?.contains(event.target)
      )
        close();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    function scroll(event: Event) {
      if (event.target !== tip.current) close();
    }
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
    };
  }, [active]);
  useLayoutEffect(() => {
    if (!active || !tip.current) return;
    const anchor = active.anchor.getBoundingClientRect();
    const { width, height } = tip.current.getBoundingClientRect();
    const below = anchor.bottom + 4;
    setPosition({
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)),
      top: Math.max(
        8,
        below + height <= window.innerHeight - 8
          ? below
          : anchor.top - height - 4,
      ),
    });
  }, [active]);

  const content = active && describe(active.item);
  return {
    close,
    triggerProps(item: T, key: string | number, label: string): ButtonHTMLAttributes<HTMLButtonElement> {
      return {
        type: "button",
        "aria-label": label,
        "aria-describedby": active?.key === key && content ? id : undefined,
        onFocus: (event) => {
          if (event.currentTarget.matches(":focus-visible"))
            show(item, key, event.currentTarget);
        },
        onBlur: leave,
        onPointerEnter: (event) => {
          if (event.pointerType !== "mouse") return;
          cancelTimer();
          const anchor = event.currentTarget;
          timer.current = setTimeout(() => show(item, key, anchor), 250);
        },
        onPointerLeave: (event) => {
          if (event.pointerType === "mouse") leave();
        },
        onPointerDown: (event) => {
          if (event.isPrimary === false) return;
          held.current = false;
          if (event.pointerType !== "touch") return;
          cancelTimer();
          touchStart.current = { x: event.clientX, y: event.clientY };
          const anchor = event.currentTarget;
          timer.current = setTimeout(() => {
            held.current = true;
            show(item, key, anchor, true);
          }, 450);
        },
        onPointerMove: (event) => {
          if (
            event.pointerType === "touch" &&
            touchStart.current &&
            Math.hypot(
              event.clientX - touchStart.current.x,
              event.clientY - touchStart.current.y,
            ) > 10
          )
            cancelTimer();
        },
        onPointerUp: cancelTimer,
        onPointerCancel: cancelTimer,
        onContextMenu: (event) => event.preventDefault(),
        onClick: (event) => {
          if (held.current) {
            held.current = false;
            return;
          }
          if (active?.anchor === event.currentTarget && active.pinned)
            close();
          else show(item, key, event.currentTarget, true);
        },
      };
    },
    popup: content && createPortal(
      <div
        id={id}
        ref={tip}
        className="move-score-tooltip"
        role="tooltip"
        style={position}
        onPointerEnter={cancelTimer}
        onPointerLeave={leave}
      >
        {content}
      </div>,
      document.body,
    ),
  };
}
