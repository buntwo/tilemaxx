import { expect, test, vi } from "vitest";
import { PRESETS } from "../../shared/presets";
import { flyTiles } from "../../src/components/tile-motion";

test.each([false, true])("tile flight staggers the trial color with each tile (trial=%s)", (trial) => {
  const board = document.createElement("div");
  for (const index of [0, 1]) {
    const target = document.createElement("button");
    target.dataset.cell = String(index);
    target.innerHTML = '<span class="tile-letter"></span><small class="tile-points"></small>';
    target.getBoundingClientRect = () => new DOMRect(80 + index * 25, 100, 24, 24);
    board.append(target);
  }
  document.body.append(board);
  const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
  const finished = new Promise<void>(() => {});
  const animate = vi.fn((_keyframes: Keyframe[] | PropertyIndexedKeyframes, _timing: KeyframeAnimationOptions) => ({
    finished,
    cancel() {},
  }));
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animate });
  let stop: (() => void) | undefined;
  try {
    stop = flyTiles(
      board,
      [{ index: 0, letter: "A" }, { index: 1, letter: "t" }],
      [new DOMRect(80, 160, 32, 32), new DOMRect(113, 160, 32, 32)],
      PRESETS[0].rules,
      () => {},
      trial,
    );
    const colors = animate.mock.calls.filter(([, timing]) => timing.duration === 0);
    expect(colors).toEqual(trial ? [
      [{ backgroundColor: "var(--archive-tile)", color: "var(--archive-tile-ink)" },
        { delay: 0, duration: 0, fill: "forwards" }],
      [{ backgroundColor: "var(--archive-tile)", color: "var(--archive-blank-ink)" },
        { delay: 62, duration: 0, fill: "forwards" }],
    ] : []);
    expect(animate.mock.calls.filter(([, timing]) => timing.duration !== 0)
      .map(([, timing]) => timing.delay)).toEqual([0, 62]);
  } finally {
    stop?.();
    board.remove();
    if (originalAnimate) Object.defineProperty(Element.prototype, "animate", originalAnimate);
    else Reflect.deleteProperty(Element.prototype, "animate");
  }
});
