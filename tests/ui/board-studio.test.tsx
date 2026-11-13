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
  expect(screen.getAllByText("Read-only")).toHaveLength(3);
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
  expect(screen.getAllByText("Read-only")).toHaveLength(3);
});
