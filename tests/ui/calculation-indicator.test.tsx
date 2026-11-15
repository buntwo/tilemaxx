import { act, render } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import CalculationIndicator from "../../src/components/CalculationIndicator";
import {
  GameCalculations,
  useGameCalculating,
  useGameCalculation,
} from "../../src/components/GameCalculations";

function Work({ pending }: { pending: boolean }) {
  useGameCalculation(pending);
  return null;
}

function Indicator() {
  return <CalculationIndicator active={useGameCalculating()} />;
}

test("overlapping calculations share the indicator and short handoffs do not swap back to the star", () => {
  vi.useFakeTimers();
  try {
    const workspace = (first: boolean, second: boolean) => (
      <GameCalculations>
        <Work pending={first} />
        {second && <Work pending />}
        <Indicator />
      </GameCalculations>
    );
    const { container, rerender, unmount } = render(workspace(false, false));
    const phase = () =>
      container
        .querySelector(".calculation-indicator")
        ?.getAttribute("data-phase");

    expect(phase()).toBe("idle");
    rerender(workspace(true, true));
    expect(phase()).toBe("active");
    rerender(workspace(false, true));
    act(() => vi.advanceTimersByTime(500));
    expect(phase()).toBe("active");
    rerender(workspace(false, false));
    act(() => vi.advanceTimersByTime(100));
    expect(phase()).toBe("active");
    rerender(workspace(true, false));
    act(() => vi.advanceTimersByTime(150));
    expect(phase()).toBe("active");

    rerender(workspace(false, false));
    act(() => vi.advanceTimersByTime(140));
    expect(phase()).toBe("settling");
    act(() => vi.advanceTimersByTime(230));
    expect(phase()).toBe("idle");
    unmount();
  } finally {
    vi.useRealTimers();
  }
});
