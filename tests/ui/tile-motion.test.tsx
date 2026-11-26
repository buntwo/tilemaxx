import { render } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { emptyBoard } from "../../shared/model";
import { PRESETS } from "../../shared/presets";
import Board from "../../src/components/Board";
import { RackTileFace } from "../../src/components/TileFace";
import { flyTiles } from "../../src/components/tile-motion";

test("board and rack share tile markings while keeping blank and missing tile behavior", () => {
  const template = PRESETS[0];
  const board = emptyBoard(template.size);
  const [q, blank, missing] = [template.start, template.start + 1, template.start + 2];
  board[q] = "Q";
  board[blank] = "t";
  board[missing] = "A";
  const { container } = render(
    <>
      <Board board={board} template={template} missingRackTiles={new Map([[missing, "A"]])} />
      <RackTileFace tile="Q" rules={template.rules} />
      <RackTileFace tile="?" rules={template.rules} />
    </>,
  );
  const cell = (index: number) => container.querySelector(`[data-cell="${index}"].tile-face`)!;
  const normalRack = container.querySelector(".rack-face.tile-face:not(.blank)")!;
  const blankRack = container.querySelector(".rack-face.tile-face.blank")!;
  expect(cell(q).querySelector(".tile-face-content")?.outerHTML).toBe(normalRack.innerHTML);
  expect(normalRack.querySelector(".tile-points")?.textContent).toBe("10");
  expect(cell(blank).querySelector(".tile-letter")?.textContent).toBe("T");
  expect(cell(blank).querySelector(".tile-points")?.textContent).toBe("0");
  expect(blankRack.querySelector(".tile-letter")?.textContent).toBe("");
  expect(blankRack.querySelector(".tile-points")?.textContent).toBe("0");
  expect(cell(missing).querySelector(".tile-points")).toBeNull();
});

test.each([false, true])("tile flight staggers the trial color with each tile (trial=%s)", (trial) => {
  const board = document.createElement("div");
  for (const index of [0, 1]) {
    const target = document.createElement("button");
    target.dataset.cell = String(index);
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
    const flights = animate.mock.calls.filter(([, timing]) => timing.duration !== 0);
    expect(flights.map(([, timing]) => timing.delay)).toEqual([0, 62]);
    expect(flights[0][0]).toMatchObject([
      { width: "32px", height: "32px" },
      { offset: .52 },
      { width: "24px", height: "24px" },
    ]);
    expect([...document.querySelectorAll(".flying-tile.tile-face .tile-face-content")].map((face) => face.textContent))
      .toEqual(["A1", "T0"]);
  } finally {
    stop?.();
    board.remove();
    if (originalAnimate) Object.defineProperty(Element.prototype, "animate", originalAnimate);
    else Reflect.deleteProperty(Element.prototype, "animate");
  }
});
