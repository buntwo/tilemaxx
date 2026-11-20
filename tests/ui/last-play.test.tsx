import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { emptyScoring, recordOpponentPlay } from "../../shared/game-scoring";
import {
  applyMove,
  archiveGame,
  emptyBoard,
  undo,
  type Game,
} from "../../shared/model";
import { PRESETS } from "../../shared/presets";
import { unseenTiles } from "../../shared/tile-pool";
import LastPlay from "../../src/components/LastPlay";

function opponentBingo() {
  const base = emptyBoard(15);
  [..."CAT"].forEach((letter, col) => {
    base[112 + col] = letter;
  });
  const board = [...base];
  [..."STEALER"].forEach((letter, row) => {
    board[115 + row * 15] = letter;
  });
  const game: Game = {
    id: "last-play",
    name: "Last play",
    profileId: "p",
    dictionaryId: "test",
    board,
    rack: "",
    template: PRESETS[0],
    past: [],
    future: [],
    revision: 0,
    updatedAt: "",
    archived: false,
    scoring: { ...emptyScoring(), pendingBase: base },
  };
  return recordOpponentPlay(game, null);
}

test("the archived board shows only the main word and opens the compact breakdown", async () => {
  const user = userEvent.setup();
  render(<LastPlay game={archiveGame(opponentBingo())} />);

  const trigger = screen.getByRole("button", {
    name: "Last play: Opp STEALER Bingo 70 pts K8",
  });
  expect(
    trigger.querySelector(".bingo-badge svg")?.getAttribute("height"),
  ).toBe("10");
  expect(screen.queryByRole("table")).toBeNull();

  await user.hover(trigger);
  const table = screen.getByRole("table", {
    name: "Last play point breakdown",
  });
  expect(
    within(table)
      .getAllByRole("row")
      .map((row) =>
        [
          within(row).getByRole("rowheader"),
          ...within(row).getAllByRole("cell"),
        ].map((cell) => cell.textContent),
      ),
  ).toEqual([
    ["STEALER", "K8", "7 × 2 DW", "14"],
    ["CATS", "8H", "", "6"],
    ["Bingo bonus", "50"],
    ["Total", "70 pts"],
  ]);
  await user.unhover(trigger);
  expect(screen.queryByRole("table")).toBeNull();

  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  fireEvent.pointerDown(document.body);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  await user.tab();
  expect(document.activeElement).toBe(trigger);
  await user.keyboard("{Enter}");
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  await user.keyboard("{Escape}");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

test("a one-tile down entry uses the across extension as its main word and undo shows the preceding play", () => {
  const previous = opponentBingo();
  const game = applyMove(
    { ...previous, rack: "S" },
    {
      id: "SCATS-8G",
      word: "SCATS",
      row: 7,
      col: 6,
      direction: "down",
      score: 7,
      blanks: 0,
      crosses: [],
      tiles: [{ index: 111, letter: "S" }],
      leave: "",
    },
    "you",
  );
  const { rerender } = render(<LastPlay game={game} />);
  expect(
    screen.getByRole("button", { name: "Last play: You SCATS 7 pts 8G" }),
  ).toBeTruthy();
  rerender(<LastPlay game={undo(game)} />);
  expect(
    screen.getByRole("button", {
      name: "Last play: Opp STEALER Bingo 70 pts K8",
    }),
  ).toBeTruthy();
});

test("an older score entry with no recoverable position shows its recorded word and score", () => {
  const game = opponentBingo();
  const move = game.trackedMoves![0];
  render(
    <LastPlay
      game={{
        ...game,
        past: [],
        trackedMoves: [{ ...move, review: undefined }],
      }}
    />,
  );
  expect(screen.getByText("Last play: Opp")).toBeTruthy();
  expect(screen.getByText("70 pts")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

test("the bag status includes blanks in the vowel percentage and follows the bag count", () => {
  const game = opponentBingo();
  const unseenPool = unseenTiles(game, game.template);
  const bag = { bagSize: 83, bagConfirmed: false, unseenPool };
  const { rerender } = render(<LastPlay game={game} bag={bag} />);

  const status = screen.getByText("Bag: 83 · 42% V");
  expect(status.title).toContain("including the opponent’s rack");
  expect(status.closest("button")).toBeNull();
  expect(
    screen.getByRole("button", {
      name: "Last play: Opp STEALER Bingo 70 pts K8",
    }),
  ).toBeTruthy();

  rerender(
    <LastPlay game={game} bag={{ ...bag, bagSize: 90, bagConfirmed: true }} />,
  );
  expect(screen.getByText("Bag: 90 · 42% V").title).toBe("");

  rerender(
    <LastPlay game={game} bag={{ ...bag, bagSize: 0, bagConfirmed: true }} />,
  );
  expect(screen.getByText("Bag empty")).toBeTruthy();
  expect(screen.queryByText(/% V/)).toBeNull();
});
