import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { emptyBoard, type Move, type Game } from "../../shared/model";
import { PRESETS } from "../../shared/presets";
import { emptyScoring, scorePlacement } from "../../shared/game-scoring";
import GameScores from "../../src/components/GameScores";
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

test("colored move words keep ordinary spelling and distinguish old and new tiles", () => {
  const { container } = render(
    <MoveLetters move={move} size={15} board={board} />,
  );
  expect(container.textContent).toBe("CATS");
  expect(container.querySelector(".existing.assigned-blank")?.textContent).toBe(
    "A",
  );
  expect(container.querySelector(".played.assigned-blank")?.textContent).toBe(
    "T",
  );
  expect(
    [...container.querySelectorAll(".move-parenthesis")].map(
      (e) => e.textContent,
    ),
  ).toEqual([]);
});

test("plain word labels keep ordinary spelling and preserve bingo markers", () => {
  const { container, rerender } = render(
    <MoveWord move={move} rules={{ ...PRESETS[0], rackSize: 3 }} />,
  );
  expect(container.textContent).toBe("CATS ");
  expect(screen.getByRole("img", { name: "Bingo" })).toBeTruthy();
  rerender(<MoveWord word="CATS" />);
  expect(container.textContent).toBe("CATS");
});

test("endgame continuations keep tournament locations and ordinary word spelling", () => {
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
  ).toBe("CATS");
  expect(
    table.querySelectorAll(".optimal-reply-turn-word")[1].textContent,
  ).toBe("TO");
});

test("score breakdown keeps ordinary spelling and square addresses", () => {
  const after = [...board];
  for (const tile of move.tiles) after[tile.index] = tile.letter;
  const breakdown = scorePlacement(board, after, PRESETS[0], "across")!;
  const { container } = render(<ScoreBreakdownContent breakdown={breakdown} />);
  expect(screen.getByText("CATS")).toBeTruthy();
  expect(container.textContent).toContain("H8 A: blank (0 pts)");
  expect(container.textContent).toContain("I8 T: blank (0 pts)");
});

test.each(["you", "opponent"] as const)(
  "only Game scores history uses word notation for %s, with safe fallback",
  (player) => {
    const scoring = emptyScoring();
    scoring[player].points = 4;
    scoring[player].moves = 2;
    const game: Game = {
      id: "history",
      profileId: "p",
      name: "Notation",
      dictionaryId: "test",
      board,
      rack: "C?S",
      template: PRESETS[0],
      past: [],
      future: [],
      revision: 0,
      updatedAt: "",
      archived: false,
      trackScores: true,
      scoring,
      trackedMoves: [
        {
          player,
          word: "CATS",
          score: 4,
          at: "2026-11-17",
          review: {
            board,
            rack: "C?S",
            dictionaryId: "test",
            tiles: move.tiles,
            direction: "across",
          },
        },
        { player, word: "UNKNOWN", score: 0, at: "2026-11-17" },
      ],
    };
    render(
      <GameScores
        game={game}
        onToggle={vi.fn()}
        onRecord={vi.fn()}
        onCorrection={vi.fn()}
        onChange={vi.fn()}
      />,
    );
    const history = screen.getByRole("table", {
      name: "Tracked moves",
      hidden: true,
    });
    expect(history.textContent).toContain("C(a)tS");
    expect(history.textContent).toContain("UNKNOWN");
    // The stored word remains untouched for edits, scoring, and solver input.
    expect(game.trackedMoves![0].word).toBe("CATS");
  },
);
