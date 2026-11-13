import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import Brand from "../../src/components/Brand";
import { attachBrandSparkle } from "../../src/components/brand-sparkle";

function setup(reducedMotion = false) {
  vi.useFakeTimers();
  vi.mocked(window.matchMedia).mockReturnValue({
    matches: reducedMotion,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  });
  const cancel = vi.fn();
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));
  const animate = vi.fn(() => ({ finished, cancel }));
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: animate,
  });
  vi.stubGlobal("PointerEvent", MouseEvent);
  const random = vi.spyOn(Math, "random").mockReturnValue(0);
  render(<Brand />);
  const brand = screen
    .getByRole("link", { name: "Tilemaxx" })
    .closest(".brand")!;
  const word = brand.querySelector<HTMLElement>(".brand-word")!;
  const base = word.querySelector(".brand-highlight")!;
  const [preview, other] = [...word.children].filter(
    (letter) => letter !== base,
  );
  const effect = () =>
    brand.querySelector<HTMLElement>(".brand-motion")?.dataset.effect;
  function hover(letter: Element) {
    pointer(letter, "pointerover", "mouse");
  }
  function wait(ms: number) {
    act(() => vi.advanceTimersByTime(ms));
  }
  return {
    brand,
    word,
    base,
    preview,
    other,
    animate,
    finish,
    cancel,
    random,
    effect,
    hover,
    wait,
  };
}

function pointer(target: Element, type: string, pointerType: string) {
  const event = new MouseEvent(type, { bubbles: true });
  Object.defineProperties(event, {
    pointerType: { value: pointerType },
    pointerId: { value: 1 },
    isPrimary: { value: true },
  });
  fireEvent(target, event);
}

afterEach(() => {
  sessionStorage.clear();
  Reflect.deleteProperty(Element.prototype, "animate");
  vi.useRealTimers();
});

test("only the completed fire combo queues a fire tile and shows a burst", () => {
  const { brand, word, animate, wait } = setup();
  const key = "tilemaxx:fire-next-refresh";
  function tap(index: number) {
    const letter = word.children[index];
    pointer(letter, "pointerdown", "mouse");
    pointer(letter, "pointerup", "mouse");
  }
  [6, 7, 4].forEach(tap);
  wait(2100);
  [5, 6, 7].forEach(tap);
  expect(sessionStorage.getItem(key)).toBeNull();

  [6, 7, 5, 4, 6, 7].forEach(tap);
  expect(sessionStorage.getItem(key)).toBeNull();
  expect(animate).not.toHaveBeenCalled();
  const wasOnFire = brand.classList.contains("on-fire");
  [6, 7, 4, 5, 6, 7].forEach(tap);
  expect(sessionStorage.getItem(key)).toBe("1");
  expect(brand.querySelectorAll(".brand-ember")).toHaveLength(24);
  expect(brand.classList.contains("on-fire")).toBe(wasOnFire);
  expect(animate).toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ opacity: 1 })]),
    expect.objectContaining({ duration: 560 }),
  );
});

test("each return chooses an effect after the 500 ms pause", async () => {
  const brand = setup();
  brand.hover(brand.preview);
  fireEvent.pointerOut(brand.preview);
  brand.wait(499);
  expect(brand.preview.classList.contains("brand-highlight")).toBe(true);
  expect(brand.random).not.toHaveBeenCalled();
  brand.wait(1);
  expect(brand.effect()).toBe("wipe");
  await act(async () => brand.finish());
  expect(brand.effect()).toBeUndefined();
  expect(brand.base.classList.contains("brand-highlight")).toBe(true);

  brand.random.mockReturnValue(0.99);
  brand.hover(brand.preview);
  fireEvent.pointerOut(brand.preview);
  const calls = brand.random.mock.calls.length;
  brand.wait(500);
  expect(brand.effect()).toBe("snap");
  expect(brand.random).toHaveBeenCalledTimes(calls + 1);
});

test("reentering cancels both a pending and an active return", () => {
  const brand = setup();
  brand.hover(brand.preview);
  fireEvent.pointerOut(brand.preview);
  brand.wait(300);
  brand.hover(brand.other);
  brand.wait(500);
  expect(brand.animate).not.toHaveBeenCalled();
  fireEvent.pointerOut(brand.other);
  brand.wait(500);
  expect(brand.effect()).toBe("wipe");
  brand.hover(brand.preview);
  expect(brand.cancel).toHaveBeenCalled();
  expect(brand.effect()).toBeUndefined();
  expect(brand.preview.classList.contains("brand-highlight")).toBe(true);
});

test("reduced motion returns directly to the default after the pause", () => {
  const brand = setup(true);
  brand.hover(brand.preview);
  fireEvent.pointerOut(brand.preview);
  brand.wait(500);
  expect(brand.animate).not.toHaveBeenCalled();
  expect(brand.base.classList.contains("brand-highlight")).toBe(true);
});

test("touch release and lost capture share the same pause", () => {
  const brand = setup();
  const capture = vi.fn();
  brand.word.setPointerCapture = capture;
  pointer(brand.preview, "pointerdown", "touch");
  expect(capture).toHaveBeenCalledWith(1);
  expect(brand.preview.classList.contains("brand-highlight")).toBe(true);
  pointer(brand.word, "pointerup", "touch");
  brand.wait(300);
  pointer(brand.word, "lostpointercapture", "touch");
  brand.wait(199);
  expect(brand.effect()).toBeUndefined();
  brand.wait(1);
  expect(brand.effect()).toBe("wipe");
});

test.each([
  { onFire: false, perSecond: 10, burst: 48 },
  { onFire: true, perSecond: 25, burst: 84 },
])(
  "tile sparkle emits $perSecond flecks per second and $burst per click or tap",
  async ({ onFire, perSecond, burst }) => {
    const { animate, finish, cancel, wait } = setup();
    const button = document.createElement("button");
    const tile = document.createElement("span");
    button.append(tile);
    const { detach } = attachBrandSparkle(button, tile, onFire)!;
    const count = () =>
      button.querySelector(".brand-sparkle")!.childElementCount;
    try {
      pointer(button, "pointerenter", "mouse");
      const initial = count();
      wait(1000);
      expect(count()).toBe(initial + perSecond);
      fireEvent.click(button);
      expect(count()).toBe(initial + perSecond + burst);
      expect(animate).toHaveBeenCalledWith(
        expect.arrayContaining([{ scale: 0.87, offset: 0.32 }]),
        expect.objectContaining({ duration: 175 }),
      );
      pointer(button, "pointerleave", "mouse");
      wait(1000);
      expect(count()).toBe(initial + perSecond + burst);
      await act(async () => finish());
      expect(count()).toBe(0);
      fireEvent.click(button);
      expect(count()).toBe(burst);
    } finally {
      detach();
    }
    expect(button.children).toHaveLength(1);
    expect(cancel).toHaveBeenCalled();
  },
);
