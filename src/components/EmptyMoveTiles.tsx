import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { tileScore, type Rules } from "../../shared/model";
import { canAnimateTiles } from "./tile-motion";

const words = [
  "AHA", "YAY", "WOW", "OOH", "HMM", "HUH", "OOF", "EEK", "AWW",
  "YEP", "NAH", "BRO", "SUP", "LOL", "OMG", "QAT", "WAT",
  "RAD", "ACE", "YUM", "OHO",
];
const angles = [-10, 4, 13];
const heights = [0, -9, 0];
const transform = (x: number, y: number, angle: number, scale = 1) =>
  `translate(${x}px, ${y}px) rotate(${angle}deg) scale(${scale})`;

type Gesture = { id: number; x: number; y: number };

export default function EmptyMoveTiles({ rules }: { rules: Rules }) {
  const [tiles, setTiles] = useState(() => {
    const word = words[Math.floor(Math.random() * words.length)];
    return [...word].map((letter, id) => ({ letter, id, green: Math.random() < 0.5 }));
  });
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const motion = useRef<Animation[]>([]);
  const rotating = useRef(false);

  function clearMotion() {
    for (const animation of motion.current) animation.cancel();
    motion.current = [];
    for (const element of root.current?.children ?? [])
      (element as HTMLElement).style.removeProperty("z-index");
    rotating.current = false;
  }
  useLayoutEffect(clearMotion, [tiles]);
  useEffect(() => () => {
    gesture.current = null;
    clearMotion();
  }, []);

  function moveTiles(direction: -1 | 1) {
    if (rotating.current) return;
    gesture.current = null;
    root.current?.removeAttribute("data-dragging");
    const elements = [...(root.current?.children ?? [])] as HTMLElement[];
    const next = direction < 0
      ? [...tiles.slice(1), tiles[0]]
      : [tiles[2], ...tiles.slice(0, 2)];
    if (!canAnimateTiles()) {
      setTiles(next);
      return;
    }
    rotating.current = true;
    const animations = elements.map((element, index) => {
      const target = (index + direction + 3) % 3;
      const wrap = Math.abs(target - index) === 2;
      const frames = Array.from({ length: 49 }, (_, step) => {
        const t = step / 48;
        const arc = wrap ? Math.sin(Math.PI * t) : 0;
        return {
          transform: transform(
            (target - index) * 52 * t,
            heights[index] + (heights[target] - heights[index]) * t - 48 * .56 * arc,
            angles[index] + (angles[target] - angles[index]) * t,
            1 - .32 * arc,
          ),
          opacity: 1 - .32 * arc,
        };
      });
      element.style.zIndex = wrap ? "0" : "1";
      return element.animate(frames, {
        duration: 465,
        easing: "cubic-bezier(.42,0,.22,1)",
        fill: "both",
      });
    });
    motion.current = animations;
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (motion.current !== animations) return;
      setTiles(next);
    });
  }

  function finish(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    const horizontal = !cancelled && Math.abs(dx) >= 18 && Math.abs(dx) > Math.abs(dy);
    gesture.current = null;
    event.currentTarget.removeAttribute("data-dragging");
    if (horizontal) moveTiles(dx < 0 ? -1 : 1);
  }

  return (
    <div
      ref={root}
      className="illustrated-tiles empty-move-tiles"
      role="group"
      tabIndex={0}
      aria-label={`${tiles.map(({ letter }) => letter).join("")} tiles. Swipe or use left and right arrow keys to rotate.`}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          moveTiles(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}
      onPointerDown={(event) => {
        if (rotating.current || gesture.current || event.button !== 0) return;
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = gesture.current;
        if (!drag || drag.id !== event.pointerId) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (Math.abs(dy) > 24 && Math.abs(dx) < Math.abs(dy)) {
          gesture.current = null;
          event.currentTarget.removeAttribute("data-dragging");
          return;
        }
        if (Math.abs(dx) >= 7) event.currentTarget.dataset.dragging = "";
      }}
      onPointerUp={finish}
      onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={(event) => finish(event, true)}
    >
      {tiles.map(({ letter, id, green }) => (
        <span key={id} className={green ? "illustrated-tile-green" : undefined} aria-hidden="true">
          {letter}<small>{tileScore(letter, rules)}</small>
        </span>
      ))}
    </div>
  );
}
