import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import type { GameScoreSummary } from "../../shared/game-scoring";
import GameScoreBadge from "../../src/components/GameScoreBadge";

const score: GameScoreSummary = { you: 346, opponent: 340, outcome: "playing" };

test.each(["you", "opponent"] as const)(
  "the header shows a single chevron for %s's turn",
  (turn) => {
    const { container } = render(
      <GameScoreBadge score={score} turn={turn} showMargin />,
    );
    const badge = screen.getByRole("group", { name: "Tracked score" });
    expect(badge.getAttribute("aria-description")).toContain(
      turn === "you" ? "Your turn." : "Opponent’s turn.",
    );
    const markers = container.querySelectorAll(".game-score-turn-marker");
    expect(markers).toHaveLength(1);
    expect(markers[0].classList.contains("score-turn-chevron")).toBe(true);
    expect(markers[0].getAttribute("data-player")).toBe(turn);
    expect(markers[0].getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByLabelText("Your score").textContent).toBe("346");
    expect(screen.getByLabelText("Opponent score").textContent).toBe("340");
    expect(container.querySelector(".game-score-delta")?.textContent).toBe(
      "+6",
    );
  },
);

test("unknown turns and completed games do not guess an active player", () => {
  const { container, rerender } = render(<GameScoreBadge score={score} />);
  expect(container.querySelector(".game-score-turn-marker")).toBeNull();
  for (const outcome of ["win", "loss", "tie", "archived"] as const) {
    rerender(<GameScoreBadge score={{ ...score, outcome }} turn="you" />);
    expect(container.querySelector(".game-score-turn-marker")).toBeNull();
    expect(
      screen
        .getByRole("group", { name: "Tracked score" })
        .hasAttribute("data-turn"),
    ).toBe(false);
  }
});
