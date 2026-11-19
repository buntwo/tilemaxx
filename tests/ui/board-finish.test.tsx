import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import BoardFinishOverlay from "../../src/components/BoardFinishOverlay";

const motion = Object.assign(new EventTarget(), { matches: false });

function setReducedMotion(matches: boolean) {
  motion.matches = matches;
  act(() => motion.dispatchEvent(new Event("change")));
}

function win() {
  const view = render(
    <BoardFinishOverlay
      finish={{
        outcome: "win",
        scores: { you: 400, opponent: 350 },
        opponent: "Practice opponent",
        size: 15,
        square: 112,
      }}
      onDismiss={() => undefined}
    />,
  );
  return {
    ...view,
    bursts: () => [...view.container.querySelectorAll(".board-finish-burst")],
  };
}

function advance(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
}

beforeEach(() => {
  vi.useFakeTimers();
  motion.matches = false;
  vi.stubGlobal("matchMedia", () => motion);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("win fireworks launch again, overlap, and clean up each burst after it ends", () => {
  // These two uniform draws give a normal sample of about -1.18.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const { bursts, unmount } = win();
  const heading = screen.getByRole("heading", { name: "You win!" });
  const [first] = bursts();
  expect(bursts()).toHaveLength(1);
  expect(first.children).toHaveLength(16);

  advance(800);
  expect(bursts()).toEqual([first]);
  advance(30);
  expect(bursts()).toHaveLength(2);
  const [, second] = bursts();
  fireEvent.animationEnd(first.firstElementChild!);
  expect(bursts()).toEqual([first, second]);
  fireEvent.animationEnd(first.lastElementChild!);
  expect(bursts()).toEqual([second]);

  advance(830);
  expect(bursts()).toHaveLength(2);
  expect(bursts()[0]).toBe(second);
  expect(screen.getByRole("heading", { name: "You win!" })).toBe(heading);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test("a negative delay floors to 100 ms, and reduced motion stops the fireworks", () => {
  const random = vi.spyOn(Math, "random").mockReturnValue(0.25);
  motion.matches = true;
  const { bursts } = win();
  expect(bursts()).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);

  // Draw a negative interval for the next launch, then 2 s for later gaps.
  random.mockReturnValueOnce(0.99).mockReturnValueOnce(0.5);
  setReducedMotion(false);
  expect(bursts()).toHaveLength(1);
  advance(99);
  expect(bursts()).toHaveLength(1);
  advance(1);
  expect(bursts()).toHaveLength(2);
  advance(1999);
  expect(bursts()).toHaveLength(2);
  advance(1);
  expect(bursts()).toHaveLength(3);

  setReducedMotion(true);
  expect(bursts()).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
  advance(10_000);
  expect(bursts()).toHaveLength(0);
});
