import { useEffect, useLayoutEffect, useRef, type PointerEvent, type RefObject } from "react";
import { movedRackSlots, shuffledRackSlots, trimRack } from "../../shared/rack-entry";
import { canAnimateTiles } from "./tile-motion";

const SHUFFLE_MS = 250;
const SHUFFLE_ARC = 22;
const DROP_MS = 150;

type Slot = { button: HTMLButtonElement; bounds: DOMRect };
type Drag = {
  index: number;
  target: number;
  pointer: number;
  x: number;
  y: number;
  slots?: Slot[];
  floating?: HTMLElement;
  marker?: HTMLElement;
};

function clearShift(button: HTMLElement) {
  delete button.dataset.rackShift;
  button.style.removeProperty("--rack-shift-x");
}

function setBounds(element: HTMLElement, bounds: DOMRect, tray: HTMLElement) {
  const origin = tray.getBoundingClientRect();
  Object.assign(element.style, {
    left: `${bounds.left - origin.left - tray.clientLeft}px`,
    top: `${bounds.top - origin.top - tray.clientTop}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
  });
}

function copyTile(button: HTMLButtonElement, bounds: DOMRect, tray: HTMLElement) {
  const tile = document.createElement("span");
  tile.className = button.className;
  tile.classList.remove("selected", "move-preview");
  tile.classList.add("rack-reorder-tile");
  tile.setAttribute("aria-hidden", "true");
  const face = button.querySelector(".rack-slot");
  if (face) tile.append(face.cloneNode(true));
  setBounds(tile, bounds, tray);
  tray.append(tile);
  return tile;
}

function flightFrames(dx: number, dy: number, lift: number, scale: number) {
  return Array.from({ length: 17 }, (_, index) => {
    const t = index / 16;
    const x = dx * (1 - t);
    const y = dy * (1 - t) - lift * 4 * t * (1 - t);
    return { transform: `translate(${x}px, ${y}px) scale(${1 + (scale - 1) * (1 - t)})` };
  });
}

export function useRackReorder({
  rack,
  letters,
  positionKey,
  enabled,
  prepare,
  onReorder,
}: {
  rack: RefObject<HTMLDivElement | null>;
  letters: string;
  positionKey: string;
  enabled: boolean;
  prepare: () => void;
  onReorder: (order: number[]) => void;
}) {
  const drag = useRef<Drag>(null);
  const flights = useRef<{ rack: string; stop: () => void }>(null);

  function readSlots() {
    return Array.from(
      rack.current?.querySelectorAll<HTMLButtonElement>("[data-rack-slot]") ?? [],
      (button) => ({ button, bounds: button.getBoundingClientRect() }),
    );
  }

  function clearDrag() {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    active.slots?.forEach(({ button }) => clearShift(button));
    active.floating?.remove();
    active.marker?.remove();
    const source = active.slots?.[active.index].button;
    if (source) delete source.dataset.rackLifted;
  }

  function cancel() {
    clearDrag();
    flights.current?.stop();
  }

  useLayoutEffect(() => {
    clearDrag();
  }, [positionKey, enabled]);
  useLayoutEffect(() => {
    if (!enabled || flights.current?.rack !== letters) flights.current?.stop();
  }, [letters, enabled]);
  useEffect(() => {
    function reset() {
      cancel();
    }
    window.addEventListener("blur", reset);
    window.addEventListener("resize", reset);
    return () => {
      window.removeEventListener("blur", reset);
      window.removeEventListener("resize", reset);
      cancel();
    };
  }, []);

  function animate(
    order: number[],
    slots: Slot[],
    origins: DOMRect[],
    mode: "shuffle" | "drop",
    lifted?: number,
  ) {
    const tray = rack.current;
    if (!tray || !canAnimateTiles()) return;
    const finishes = new Set<() => void>();
    const stop = () => {
      for (const finish of finishes) finish();
      if (flights.current?.stop === stop) flights.current = null;
    };
    flights.current = {
      rack: trimRack(order.map((i) => letters[i] ?? ".").join("")),
      stop,
    };
    order.forEach((from, to) => {
      if (!letters[from] || letters[from] === "." || (from === to && from !== lifted))
        return;
      const source = slots[from];
      const dest = slots[to];
      const before = origins[from];
      if (!source || !dest || !before?.width || !dest.bounds.width) return;
      const dx = before.left + before.width / 2 - dest.bounds.left - dest.bounds.width / 2;
      const dy = before.top + before.height / 2 - dest.bounds.top - dest.bounds.height / 2;
      if (Math.hypot(dx, dy) < .25 && from !== lifted) return;
      const shuffled = mode === "shuffle";
      const lift = shuffled
        ? Math.min(SHUFFLE_ARC + 25, SHUFFLE_ARC * .62 + Math.abs(dx) * .12 + (to % 3) * 8)
        : from === lifted ? 6 : 0;
      const floating = copyTile(source.button, dest.bounds, tray);
      if (from === lifted) floating.dataset.rackDragging = "";
      dest.button.dataset.rackCovered = "";
      const animation = floating.animate(flightFrames(dx, dy, lift, from === lifted ? 1.045 : 1), {
        duration: shuffled ? SHUFFLE_MS : DROP_MS,
        delay: shuffled ? (to % 4) * 17 : 0,
        easing: shuffled ? "cubic-bezier(.36,.04,.23,1)" : "cubic-bezier(.2,.75,.24,1)",
        fill: "both",
      });
      const finish = () => {
        if (!finishes.delete(finish)) return;
        floating.remove();
        delete dest.button.dataset.rackCovered;
        animation.cancel();
        if (!finishes.size && flights.current?.stop === stop) flights.current = null;
      };
      finishes.add(finish);
      animation.finished.then(finish, finish);
    });
    if (!finishes.size) stop();
  }

  function shuffle() {
    if (!enabled) return;
    cancel();
    prepare();
    const slots = readSlots();
    const order = shuffledRackSlots(letters);
    animate(order, slots, slots.map(({ bounds }) => bounds), "shuffle");
    onReorder(order);
  }

  function begin(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (!enabled || event.button !== 0 || drag.current) return;
    flights.current?.stop();
    drag.current = {
      index,
      target: index,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function move(event: PointerEvent) {
    const active = drag.current;
    const tray = rack.current;
    if (!active || !tray || active.pointer !== event.pointerId) return false;
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    if (!active.slots) {
      if (event.pointerType === "touch" && Math.abs(dy) > Math.max(10, Math.abs(dx))) {
        clearDrag();
        return false;
      }
      if (Math.abs(dx) < 7 || Math.abs(dx) < Math.abs(dy)) return false;
      prepare();
      active.slots = readSlots();
      const source = active.slots[active.index];
      source.button.dataset.rackLifted = "";
      active.floating = copyTile(source.button, source.bounds, tray);
      active.floating.dataset.rackDragging = "";
      active.marker = document.createElement("span");
      active.marker.className = "rack-insertion-slot";
      active.marker.setAttribute("aria-hidden", "true");
      tray.append(active.marker);
    }
    const { slots, floating, marker, index } = active;
    if (!slots || !floating || !marker) return false;
    const target = slots.filter(({ bounds }, slot) =>
      slot !== index && event.clientX >= bounds.left + bounds.width / 2).length;
    active.target = target;
    setBounds(marker, slots[target].bounds, tray);
    floating.style.transform = `translate(${dx}px, ${dy - 12}px) scale(1.045)`;
    movedRackSlots(slots.length, index, target).forEach((from, to) => {
      if (from === index) return;
      const { button, bounds } = slots[from];
      if (from === to && button.dataset.rackShift === undefined) return;
      button.dataset.rackShift = "";
      button.style.setProperty("--rack-shift-x", `${slots[to].bounds.left - bounds.left}px`);
    });
    return true;
  }

  function finish(event: PointerEvent, cancelled = false) {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return false;
    if (!active.floating || !active.slots || !rack.current) {
      clearDrag();
      return false;
    }
    if (!cancelled) move(event);
    const { slots, index, target, floating } = active;
    const bounds = rack.current.getBoundingClientRect();
    const outside = cancelled ||
      event.clientX < bounds.left - 22 || event.clientX > bounds.right + 22 ||
      event.clientY < bounds.top - 46 || event.clientY > bounds.bottom + 34;
    const to = outside ? index : target;
    const fromPositions = slots.map(({ button }, i) =>
      (i === index ? floating : button).getBoundingClientRect());
    clearDrag();
    const order = movedRackSlots(slots.length, index, to);
    if (outside && canAnimateTiles()) {
      // The neighboring tiles may already have shifted to preview the drop.
      const shifted = slots.map(({ bounds }, i) => ({
        left: fromPositions[i].left - bounds.left,
        index: i,
      }));
      for (const { left, index: slot } of shifted)
        if (slot !== index && Math.abs(left) > .25)
          slots[slot].button.animate(
            [{ transform: `translateX(${left}px)` }, { transform: "translateX(0)" }],
            { duration: 160, easing: "ease-out" },
          );
    }
    animate(order, slots, fromPositions, "drop", index);
    if (to !== index) onReorder(order);
    return true;
  }

  function moveTile(index: number, to: number) {
    if (!enabled) return;
    cancel();
    prepare();
    const slots = readSlots();
    if (to < 0 || to >= slots.length) return;
    const order = movedRackSlots(slots.length, index, to);
    animate(order, slots, slots.map(({ bounds }) => bounds), "drop");
    onReorder(order);
    slots[to].button.focus({ preventScroll: true });
  }

  return { shuffle, begin, move, finish, moveTile, cancel };
}
