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
  button.style.removeProperty("--rack-shift-y");
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

function flightFrames(dx: number, dy: number, lift: number, scale: number, vertical: boolean) {
  return Array.from({ length: 17 }, (_, index) => {
    const t = index / 16;
    const arc = lift * 4 * t * (1 - t);
    const x = dx * (1 - t) - (vertical ? arc : 0);
    const y = dy * (1 - t) - (vertical ? 0 : arc);
    return { transform: `translate(${x}px, ${y}px) scale(${1 + (scale - 1) * (1 - t)})` };
  });
}

export function useRackReorder({
  rack,
  letters,
  positionKey,
  enabled,
  vertical,
  prepare,
  onReorder,
}: {
  rack: RefObject<HTMLDivElement | null>;
  letters: string;
  positionKey: string;
  enabled: boolean;
  vertical: boolean;
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
  }, [positionKey, enabled, vertical]);
  useLayoutEffect(() => {
    if (!enabled || flights.current?.rack !== letters) flights.current?.stop();
  }, [letters, enabled]);
  useLayoutEffect(() => () => flights.current?.stop(), [vertical]);
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
        ? Math.min(SHUFFLE_ARC + 25, SHUFFLE_ARC * .62 + Math.abs(vertical ? dy : dx) * .12 + (to % 3) * 8)
        : from === lifted ? 6 : 0;
      const floating = copyTile(source.button, dest.bounds, tray);
      if (from === lifted) floating.dataset.rackDragging = "";
      dest.button.dataset.rackCovered = "";
      const animation = floating.animate(flightFrames(dx, dy, lift, from === lifted ? 1.045 : 1, vertical), {
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
    const travel = Math.abs(vertical ? dy : dx);
    const crossTravel = Math.abs(vertical ? dx : dy);
    if (!active.slots) {
      if (event.pointerType === "touch" && crossTravel > Math.max(10, travel)) {
        clearDrag();
        return false;
      }
      if (travel < 7 || travel < crossTravel) return false;
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
    const coordinate = vertical ? event.clientY : event.clientX;
    const target = slots.filter(({ bounds }, slot) => slot !== index &&
      coordinate >= (vertical ? bounds.top + bounds.height / 2 : bounds.left + bounds.width / 2)
    ).length;
    active.target = target;
    setBounds(marker, slots[target].bounds, tray);
    const floatingX = vertical ? dx - 12 : dx;
    const floatingY = vertical ? dy : dy - 12;
    floating.style.transform = `translate(${floatingX}px, ${floatingY}px) scale(1.045)`;
    movedRackSlots(slots.length, index, target).forEach((from, to) => {
      if (from === index) return;
      const { button, bounds } = slots[from];
      if (from === to && button.dataset.rackShift === undefined) return;
      button.dataset.rackShift = "";
      if (vertical)
        button.style.setProperty("--rack-shift-y", `${slots[to].bounds.top - bounds.top}px`);
      else
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
      slots.forEach(({ button, bounds }, slot) => {
        if (slot === index) return;
        const dx = fromPositions[slot].left - bounds.left;
        const dy = fromPositions[slot].top - bounds.top;
        if (Math.hypot(dx, dy) <= .25) return;
        button.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
          { duration: 160, easing: "ease-out" },
        );
      });
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
