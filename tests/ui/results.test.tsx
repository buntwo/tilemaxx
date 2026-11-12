import { useState } from "react";
import { expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Results from "../../src/components/Results";
import { type Move } from "../../shared/model";
const moves: Move[] = [
  {
    id: "a",
    word: "CATS",
    score: 20,
    row: 7,
    col: 7,
    direction: "across",
    tiles: [
      { index: 112, letter: "C" },
      { index: 113, letter: "A" },
      { index: 114, letter: "T" },
      { index: 115, letter: "s" },
    ],
    leave: "Z",
    blanks: 1,
    crosses: [],
  },
  {
    id: "b",
    word: "CAT",
    score: 10,
    row: 7,
    col: 7,
    direction: "across",
    tiles: [
      { index: 112, letter: "C" },
      { index: 113, letter: "A" },
      { index: 114, letter: "T" },
    ],
    leave: "AS",
    blanks: 0,
    crosses: [],
  },
  {
    id: "c",
    word: "AT",
    score: 4,
    row: 7,
    col: 7,
    direction: "across",
    tiles: [
      { index: 112, letter: "A" },
      { index: 113, letter: "T" },
    ],
    leave: "AS",
    blanks: 0,
    crosses: [],
  },
];
function setup(mobile = false) {
  vi.stubGlobal("matchMedia", () => ({ matches: !mobile }));
  const onPlay = vi.fn(),
    onPreview = vi.fn();
  function Harness() {
    const [preview, setPreview] = useState<Move | null>(null);
    return (
      <Results
        moves={moves}
        busy=""
        elapsed={4}
        error=""
        size={15}
        preview={preview}
        onPreview={(m) => {
          setPreview(m);
          onPreview(m);
        }}
        onPlay={onPlay}
        onSolve={() => {}}
        hasRack
      />
    );
  }
  render(<Harness />);
  return { onPlay, onPreview, user: userEvent.setup() };
}
const rows = () => screen.getAllByRole("button", { name: /points,/ });
test("sort by word, length, tiles, leave and blanks; filter without losing original results", async () => {
  const { user } = setup();
  const sort = screen.getByRole("combobox", { name: "Sort moves" });
  await user.selectOptions(sort, "word");
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^AT,/);
  for (const by of ["length", "tiles", "score"]) {
    await user.selectOptions(sort, by);
    expect(rows()[0].getAttribute("aria-label")).toMatch(/^CATS,/);
  }
  for (const by of ["leave", "blanks"]) {
    await user.selectOptions(sort, by);
    expect(rows()[0].getAttribute("aria-label")).toMatch(/^CAT,/);
  }
  await user.type(
    screen.getByRole("textbox", { name: "Filter moves" }),
    "CATS",
  );
  expect(rows()).toHaveLength(1);
  await user.clear(screen.getByRole("textbox", { name: "Filter moves" }));
  expect(rows()).toHaveLength(3);
});
test("desktop hover previews and one click plays", async () => {
  const { user, onPlay, onPreview } = setup();
  // Define a pointer event because jsdom only provides MouseEvent.
  const enter = new MouseEvent("pointerover", { bubbles: true });
  Object.defineProperty(enter, "pointerType", { value: "mouse" });
  fireEvent(rows()[0], enter);
  expect(onPreview).toHaveBeenCalledWith(moves[0]);
  expect(onPlay).not.toHaveBeenCalled();
  await user.click(rows()[0]);
  expect(onPlay).toHaveBeenCalledOnce();
});
test("phone first tap previews, a different tap switches preview, second tap plays", async () => {
  const { user, onPlay, onPreview } = setup(true);
  await user.click(rows()[0]);
  expect(onPlay).not.toHaveBeenCalled();
  expect(onPreview).toHaveBeenLastCalledWith(moves[0]);
  await user.click(rows()[1]);
  expect(onPlay).not.toHaveBeenCalled();
  await user.click(rows()[1]);
  expect(onPlay).toHaveBeenCalledExactlyOnceWith(moves[1]);
});
