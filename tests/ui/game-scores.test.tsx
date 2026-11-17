import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { emptyScoring } from "../../shared/game-scoring";
import { emptyBoard, type Game } from "../../shared/model";
import { PRESETS } from "../../shared/presets";
import GameScores from "../../src/components/GameScores";

function gameWithScores(you: number, opponent: number): Game {
  const scoring = emptyScoring();
  scoring.you.points = you;
  scoring.opponent.points = opponent;
  return {
    id: "score-ui", name: "Score UI", profileId: "p", dictionaryId: "test",
    board: emptyBoard(15), rack: "", template: PRESETS[0],
    past: [], future: [], revision: 0, updatedAt: "", archived: false,
    trackScores: true, scoring,
  };
}

function show(game: Game) {
  return render(<GameScores game={game} onToggle={vi.fn()} onRecord={vi.fn()}
    onCorrection={vi.fn()} onChange={vi.fn()} />);
}

test.each([
  [340, 346, "−6 pts", "value-bad"],
  [346, 340, "+6 pts", "value-good"],
  [340, 340, "0 pts", undefined],
] as const)("Game scores shows the signed score difference for %s–%s", (you, opponent, text, tone) => {
  const { container } = show(gameWithScores(you, opponent));
  const margin = screen.getByText(text);
  expect(margin.classList.contains("score-margin")).toBe(true);
  if (tone) expect(margin.classList.contains(tone)).toBe(true);
  else expect(margin.className).not.toMatch(/value-good|value-bad/);
  expect([...container.querySelectorAll(".score-players dt")].map(el => el.textContent)).toEqual(["You", "Opponent"]);
  expect([...container.querySelectorAll(".score-total")].map(el => el.textContent)).toEqual([`${you} pts`, `${opponent} pts`]);
});

test("partial scores keep their explanation instead of claiming a complete score difference", () => {
  const game = gameWithScores(340, 346);
  game.scoring!.incomplete = true;
  const { container } = show(game);
  expect(screen.getByText(/Partial scores/)).toBeTruthy();
  expect(container.querySelector(".score-margin")).toBeNull();
});
