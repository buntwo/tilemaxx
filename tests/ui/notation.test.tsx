import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { emptyBoard, type Move, type Game } from "../../shared/model";
import { PRESETS } from "../../shared/presets";
import { scorePlacement } from "../../shared/game-scoring";
import MoveWord, { MoveLetters } from "../../src/components/MoveWord";
import OptimalReplyDetails from "../../src/components/OptimalReplyDetails";
import { ScoreBreakdownContent } from "../../src/components/ScoreBreakdown";

const move: Move = {
  id: "word",
  word: "CATS",
  row: 7,
  col: 6,
  direction: "across",
  score: 4,
  tiles: [
    { index: 111, letter: "C" },
    { index: 113, letter: "t" },
    { index: 114, letter: "S" },
  ],
  leave: "",
  blanks: 1,
  crosses: [],
};
const board = emptyBoard(15);
board[112] = "a";

test("colored words show grouped existing letters and distinguish old and new blanks", () => {
  const { container } = render(
    <MoveLetters move={move} size={15} board={board} />,
  );
  expect(container.textContent).toBe("C(a)tS");
  expect(container.querySelector(".existing.assigned-blank")?.textContent).toBe(
    "a",
  );
  expect(container.querySelector(".played.assigned-blank")?.textContent).toBe(
    "t",
  );
  expect(
    [...container.querySelectorAll(".move-parenthesis")].map(
      (e) => e.textContent,
    ),
  ).toEqual(["(", ")"]);
});

test("plain word labels and recorded words use the same notation and preserve bingo markers", () => {
  const { container, rerender } = render(
    <MoveWord
      move={move}
      rules={{ ...PRESETS[0], rackSize: 3 }}
      board={board}
    />,
  );
  expect(container.textContent).toBe("C(a)tS ");
  expect(screen.getByRole("img", { name: "Bingo" })).toBeTruthy();
  rerender(
    <MoveWord word="CATS" position={{ board, tiles: move.tiles }} size={15} />,
  );
  expect(container.textContent).toBe("C(a)tS");
});

test("endgame continuations use tournament locations and retain earlier blank identities", () => {
  const game: Game = {
    id: "g",
    profileId: "p",
    name: "Notation",
    dictionaryId: "test",
    board,
    rack: "C?S",
    template: PRESETS[0],
    past: [],
    future: [],
    updatedAt: "",
    revision: 0,
    archived: false,
  };
  const reply: Move = {
    ...move,
    word: "TO",
    row: 7,
    col: 8,
    direction: "down",
    tiles: [{ index: 128, letter: "O" }],
  };
  render(
    <OptimalReplyDetails
      game={game}
      opponentRack="O"
      line={{ line: [move, reply], points: { you: 4, opponent: 2 }, spread: 2 }}
    />,
  );
  const table = screen.getByRole("table", { name: "Optimal endgame line" });
  expect(within(table).getByText("You · 8G")).toBeTruthy();
  expect(within(table).getByText("Opponent · I8")).toBeTruthy();
  expect(
    table.querySelectorAll(".optimal-reply-turn-word")[0].textContent,
  ).toBe("C(a)tS");
  expect(
    table.querySelectorAll(".optimal-reply-turn-word")[1].textContent,
  ).toBe("(t)O");
});

test("score breakdown uses the same word notation while square labels keep their addresses", () => {
  const after = [...board];
  for (const tile of move.tiles) after[tile.index] = tile.letter;
  const breakdown = scorePlacement(board, after, PRESETS[0], "across")!;
  const { container } = render(<ScoreBreakdownContent breakdown={breakdown} />);
  expect(screen.getByText("C(a)tS")).toBeTruthy();
  expect(container.textContent).toContain("H8 A: blank (0 pts)");
  expect(container.textContent).toContain("I8 T: blank (0 pts)");
});
