import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import EmptyMoveTiles from "../../src/components/EmptyMoveTiles";

function setup(reduced = true) {
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
  vi.spyOn(Math, "random").mockReturnValueOnce(17.5 / 21)
    .mockReturnValueOnce(.1).mockReturnValueOnce(.8).mockReturnValueOnce(.2);
  const view = render(<EmptyMoveTiles rules="scrabble" />);
  const root = screen.getByRole("group");
  const tiles = [...root.children];
  return { ...view, root, tiles };
}

function pointer(root: Element, type: string, pointerType: string, x: number, y = 20) {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { pointerType, pointerId: 1, button: 0, clientX: x, clientY: y });
  fireEvent(root, event);
}

test.each(["mouse", "touch"])("%s rotates the same physical tiles in both directions", (type) => {
  const { root, tiles, rerender } = setup();
  expect(root.textContent).toBe("R1A1D2");
  pointer(root, "pointerdown", type, 100);
  pointer(root, "pointermove", type, 60);
  expect([...root.children]).toEqual(tiles);
  expect(tiles.every((tile) => !(tile as HTMLElement).style.transform)).toBe(true);
  pointer(root, "pointerup", type, 60);
  expect([...root.children]).toEqual([tiles[1], tiles[2], tiles[0]]);
  expect(root.textContent).toBe("A1D2R1");
  expect(root.children[0].classList.contains("illustrated-tile-green")).toBe(false);
  expect(root.children[1].classList.contains("illustrated-tile-green")).toBe(true);
  pointer(root, "pointerdown", type, 40);
  pointer(root, "pointerup", type, 90);
  expect([...root.children]).toEqual(tiles);
  rerender(<EmptyMoveTiles rules="wwf" />);
  expect([...root.children]).toEqual(tiles);
});

test("vertical scrolls, short drags, and cancellation keep the tile order", () => {
  const { root, tiles } = setup();
  pointer(root, "pointerdown", "touch", 100);
  pointer(root, "pointermove", "touch", 102, 80);
  pointer(root, "pointerup", "touch", 102, 80);
  expect([...root.children]).toEqual(tiles);
  pointer(root, "pointerdown", "touch", 100);
  pointer(root, "pointerup", "touch", 95);
  expect([...root.children]).toEqual(tiles);
  pointer(root, "pointerdown", "touch", 100);
  pointer(root, "pointermove", "touch", 50);
  pointer(root, "pointercancel", "touch", 50);
  expect([...root.children]).toEqual(tiles);
  expect([...root.children].every((tile) => !(tile as HTMLElement).style.transform)).toBe(true);
});

test("the 465 ms depth loop blocks overlapping gestures and cleans up on completion", async () => {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  const animations: { cancel: ReturnType<typeof vi.fn> }[] = [];
  const animate = vi.fn(() => {
    const animation = { finished, cancel: vi.fn() };
    animations.push(animation);
    return animation;
  });
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animate });
  try {
    const { root, tiles } = setup(false);
    pointer(root, "pointerdown", "touch", 100);
    pointer(root, "pointermove", "touch", 60);
    expect(animate).not.toHaveBeenCalled();
    expect(tiles.every((tile) => !(tile as HTMLElement).style.transform)).toBe(true);
    pointer(root, "pointerup", "touch", 60);
    fireEvent.keyDown(root, { key: "ArrowRight" });
    expect(animate).toHaveBeenCalledTimes(3);
    expect([...root.children]).toEqual(tiles);
    const [frames, timing] = (animate.mock.calls[0] as unknown) as [Keyframe[], KeyframeAnimationOptions];
    expect(frames[0].transform).toBe("translate(0px, 0px) rotate(-10deg) scale(1)");
    expect(Number(frames[24].opacity)).toBeCloseTo(.68);
    expect(timing).toEqual({ duration: 465, easing: "cubic-bezier(.42,0,.22,1)", fill: "both" });
    await act(async () => finish());
    expect([...root.children]).toEqual([tiles[1], tiles[2], tiles[0]]);
    expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
  } finally {
    if (original) Object.defineProperty(Element.prototype, "animate", original);
    else Reflect.deleteProperty(Element.prototype, "animate");
  }
});
