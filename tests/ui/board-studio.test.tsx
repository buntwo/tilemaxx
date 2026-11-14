import { useState } from "react";
import { test, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BoardStudio from "../../src/components/BoardStudio";
import { PRESETS } from "../../shared/presets";
test("custom board deletion requires confirmation, permits cancel and retry, and leaves built-ins read-only", async () => {
  const deleted = vi
    .fn()
    .mockRejectedValueOnce(new Error("Server unavailable"))
    .mockResolvedValueOnce(undefined);
  function Harness() {
    const [templates, setTemplates] = useState([
      ...PRESETS,
      { ...PRESETS[0], id: "custom", builtin: false, name: "Mini" },
    ]);
    return (
      <BoardStudio
        templates={templates}
        onSave={async () => {}}
        onBack={() => {}}
        onDelete={async (id) => {
          await deleted(id);
          setTemplates((items) => items.filter((t) => t.id !== id));
        }}
      />
    );
  }
  const user = userEvent.setup();
  render(<Harness />);
  expect(screen.queryByRole("button", { name: "Delete Scrabble" })).toBeNull();
  expect(screen.getAllByText("Read-only")).toHaveLength(PRESETS.length);
  await user.click(screen.getByRole("button", { name: "Delete Mini" }));
  expect(deleted).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Keep board" }));
  expect(screen.getByRole("button", { name: "Edit Mini" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Delete Mini" }));
  await user.click(screen.getByRole("button", { name: "Delete permanently" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Server unavailable",
  );
  await user.click(screen.getByRole("button", { name: "Delete permanently" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Edit Mini" })).toBeNull(),
  );
  expect(screen.getByRole("button", { name: "New custom board" })).toBeTruthy();
  expect(screen.getAllByText("Read-only")).toHaveLength(PRESETS.length);
});

test("starting a custom board from Lexulous copies its bag, rack size, and tile values", async () => {
  const saved = vi.fn().mockResolvedValue(undefined);
  render(
    <BoardStudio
      templates={PRESETS}
      onSave={saved}
      onDelete={async () => {}}
      onBack={() => {}}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "New custom board" }));
  await user.selectOptions(screen.getByLabelText("Start from"), "lexulous");
  expect(screen.getByLabelText<HTMLInputElement>("Rack size").value).toBe("8");
  expect(screen.getByLabelText<HTMLSelectElement>("Tile values").value).toBe(
    "lexulous",
  );
  expect(screen.getByText("Starting tile counts · 89 tiles")).toBeTruthy();
  await user.click(screen.getByText(/Additional play bonuses/));
  const seven = screen.getByLabelText<HTMLInputElement>("Bonus for 7 tiles");
  const five = screen.getByLabelText<HTMLInputElement>("Bonus for 5 tiles");
  expect(seven.value).toBe("40");
  expect(screen.getByLabelText<HTMLInputElement>("Full-rack bonus").value).toBe(
    "50",
  );
  await user.clear(seven);
  await user.type(seven, "35");
  await user.type(five, "15");
  await user.selectOptions(screen.getByLabelText("Tile values"), "scrabble");
  await user.click(screen.getByRole("button", { name: "Save board template" }));
  expect(saved).toHaveBeenCalledWith(
    expect.objectContaining({
      rules: "scrabble",
      rackSize: 8,
      bingo: 50,
      builtin: false,
      additionalBonuses: { 5: 15, 7: 35 },
    }),
    false,
  );
});
