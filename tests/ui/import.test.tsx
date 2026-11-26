import { beforeEach, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScreenshotImport from "../../src/components/ScreenshotImport";
import { findBoard } from "../../src/detect-board";
import { convertHeif } from "../../src/heif";
import { recognizeBoard } from "../../src/recognize";
import { saveScreenshotExample } from "../../src/screenshot-example";
import { emptyBoard, type Premium } from "../../shared/model";
import { PRESETS, templateForLanguage } from "../../shared/presets";
vi.mock("../../src/detect-board", () => ({ findBoard: vi.fn(() => null) }));
vi.mock("../../src/heif", () => ({ convertHeif: vi.fn() }));
vi.mock("../../src/recognize", () => ({ recognizeBoard: vi.fn() }));
vi.mock("../../src/screenshot-example", () => ({
  saveScreenshotExample: vi.fn(),
}));
beforeEach(() => {
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 750;
      naturalHeight = 750;
      src = "";
      async decode() {}
    },
  );
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
  vi.mocked(recognizeBoard).mockReset();
  vi.mocked(convertHeif).mockReset();
});
async function setup(
  file = new File(["fixture"], "board.png", { type: "image/png" }),
  template = PRESETS[0],
) {
  const onApply = vi.fn(),
    onClose = vi.fn(),
    user = userEvent.setup();
  render(
    <ScreenshotImport
      template={template}
      onApply={onApply}
      onClose={onClose}
    />,
  );
  await user.upload(screen.getByLabelText("Screenshot file"), file);
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Read board" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  return { user, onApply, onClose };
}
test("recognition is a draft until applied; corrections and blanks reach the import", async () => {
  const board = emptyBoard(15);
  board[112] = "C";
  board[113] = "A";
  board[114] = "T";
  vi.mocked(recognizeBoard).mockResolvedValue({
    board,
    uncertain: [113],
    candidates: 3,
  });
  const { user, onApply } = await setup();
  await user.click(screen.getByRole("button", { name: "Read board" }));
  await screen.findByRole("button", { name: "Use this board" });
  expect(onApply).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "I8: A" }));
  await user.keyboard(" E");
  expect(screen.getByRole("button", { name: "I8: E blank" })).toBeTruthy();
  expect(screen.getByLabelText("Screenshot tile J8")).toBeTruthy();
  vi.mocked(saveScreenshotExample).mockResolvedValueOnce({
    id: "12345678-abcd",
  });
  await user.click(
    screen.getByRole("button", { name: "Save corrected example" }),
  );
  await screen.findByText(/Corrected example saved/);
  const [, , , original, corrected] = vi
    .mocked(saveScreenshotExample)
    .mock.calls.at(-1)!;
  expect(original.board[113]).toBe("A");
  expect(corrected[113]).toBe("e");
  expect(onApply).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Use this board" }));
  expect(onApply.mock.calls[0][0][113]).toBe("e");
  expect(board[113]).toBe("A");
});
test("cancel aborts recognition and never applies a partial board", async () => {
  let signal: AbortSignal | undefined;
  vi.mocked(recognizeBoard).mockImplementation(
    async (_image, _crop, _size, _progress, s) => {
      signal = s;
      return new Promise(() => {});
    },
  );
  const { user, onApply, onClose } = await setup();
  await user.click(screen.getByRole("button", { name: "Read board" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(signal?.aborted).toBe(true);
  expect(onApply).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledOnce();
});
test("confirming a marked square advances, wraps, and preserves the recognized letters", async () => {
  const board = emptyBoard(15);
  board[112] = "C";
  board[113] = "A";
  board[114] = "T";
  vi.mocked(recognizeBoard).mockResolvedValue({
    board,
    uncertain: [112, 113, 114],
    candidates: 3,
  });
  const { user, onApply } = await setup();
  await user.click(screen.getByRole("button", { name: "Read board" }));
  await screen.findByLabelText("Screenshot tile H8");
  await user.click(screen.getByRole("button", { name: "J8: T" }));
  const confirm = () =>
    user.click(screen.getByRole("button", { name: "Confirm square" }));
  await confirm();
  expect(screen.getByLabelText("Screenshot tile H8")).toBeTruthy();
  expect(screen.getByText("2 marked")).toBeTruthy();
  await confirm();
  expect(screen.getByLabelText("Screenshot tile I8")).toBeTruthy();
  await confirm();
  expect(screen.queryByRole("button", { name: "Confirm square" })).toBeNull();
  expect(screen.getByLabelText("Screenshot tile I8")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Use this board" }));
  expect(onApply).toHaveBeenCalledWith(board);
  expect(
    screen.queryByRole("checkbox", {
      name: "Clear board and start score tracking",
    }),
  ).toBeNull();
});
test("recognition errors leave import unapplied and allow retry", async () => {
  vi.mocked(recognizeBoard).mockRejectedValue(
    new Error("Recognition unavailable"),
  );
  const { user, onApply } = await setup();
  await user.click(screen.getByRole("button", { name: "Read board" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Recognition unavailable",
  );
  expect(onApply).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("button", { name: "Read board" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});

test("HEIF import falls back to conversion when native decoding fails", async () => {
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 750;
      naturalHeight = 750;
      src = "";
      attempt = 0;
      async decode() {
        if (!this.attempt++) throw new Error("Native decoder unavailable");
      }
    },
  );
  vi.mocked(convertHeif).mockResolvedValue(
    new Blob(["png"], { type: "image/png" }),
  );
  const file = new File(["heif"], "board.HEIF");
  const { onApply } = await setup(file);
  expect(convertHeif).toHaveBeenCalledOnce();
  expect(vi.mocked(convertHeif).mock.calls[0][0]).toBe(file);
  expect(onApply).not.toHaveBeenCalled();
});

test("native HEIC decoding skips fallback conversion", async () => {
  await setup(new File(["heic"], "board.heic", { type: "image/heic" }));
  expect(convertHeif).not.toHaveBeenCalled();
});

test("detected board preselects the crop and keeps manual adjustment available", async () => {
  vi.mocked(findBoard).mockReturnValueOnce({
    left: 10,
    top: 20,
    width: 600,
    height: 600,
  });
  const { user } = await setup();
  expect(screen.getByText(/Board detected/)).toBeTruthy();
  await user.click(screen.getByText("Fine-tune crop (pixels)"));
  expect((screen.getByLabelText("Crop left") as HTMLInputElement).value).toBe(
    "10",
  );
  await user.clear(screen.getByLabelText("Crop left"));
  await user.type(screen.getByLabelText("Crop left"), "12");
  expect((screen.getByLabelText("Crop left") as HTMLInputElement).value).toBe(
    "12",
  );
});

test("manual review accepts a missed tile and can clear a false positive", async () => {
  const { user, onApply } = await setup();
  await user.click(screen.getByRole("button", { name: "Enter manually" }));
  await user.click(screen.getByRole("button", { name: /^H8:/ }));
  await user.keyboard("CAT");
  await user.click(screen.getByRole("button", { name: "J8: T" }));
  await user.keyboard("{Delete}");
  await user.click(screen.getByRole("button", { name: "Use this board" }));
  expect(onApply.mock.calls[0][0].slice(112, 115)).toEqual(["C", "A", ""]);
});

test("premium imports default to a cleared board with score tracking", async () => {
  const board = emptyBoard(15);
  board[112] = "A";
  vi.mocked(recognizeBoard).mockResolvedValue({
    board,
    uncertain: [],
    candidates: 1,
    premiums: { style: "scrabble-go", squares: [...PRESETS[0].premiums] },
  });
  const { user, onApply } = await setup();
  await user.click(screen.getByRole("button", { name: "Read board" }));
  const clear = await screen.findByRole("checkbox", {
    name: "Clear board and start score tracking",
  });
  expect(clear).toHaveProperty("checked", true);
  await user.click(screen.getByRole("button", { name: "Use this board" }));
  expect(onApply).toHaveBeenCalledWith(board, expect.any(Array), true);
});

test.each(["en", "fr"] as const)(
  "Wordfeud premium review infers and applies the layout for %s",
  async (language) => {
    const template = templateForLanguage(
      PRESETS.find(({ id }) => id === "wordfeud")!,
      language,
    );
    const board = emptyBoard(15);
    board[111] = "A";
    board[112] = "T";
    const squares: (Premium | null)[] = [...template.premiums];
    squares[111] = squares[112] = null;
    squares[0] = "DW";
    vi.mocked(recognizeBoard).mockResolvedValue({
      board,
      uncertain: [],
      candidates: 2,
      premiums: { style: "wordfeud", squares },
    });
    const worker = {
      onmessage: undefined as ((event: unknown) => void) | undefined,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    };
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          return worker;
        }
      },
    );
    const { user, onApply } = await setup(undefined, template);
    await user.click(screen.getByRole("button", { name: "Read board" }));
    await user.click(
      await screen.findByRole("button", { name: "Premium squares" }),
    );
    expect(screen.queryByText(/For Wordfeud tile values/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "G8: empty, unknown premium" }),
    ).toBeTruthy();
    await user.click(screen.getByText("Use opening play scores"));
    await user.type(
      screen.getByRole("spinbutton", { name: "First play points · AT" }),
      "3",
    );
    await user.click(
      screen.getByRole("button", { name: "Infer covered squares" }),
    );
    expect(worker.postMessage.mock.calls[0][0][3]).toEqual([3]);
    worker.onmessage?.({ data: { matches: 1, certain: [[111, "DL"]] } });
    expect(await screen.findByRole("button", { name: "G8: DL" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "TW" }));
    await user.click(screen.getByRole("button", { name: "A1: DW" }));
    await user.click(
      screen.getByRole("checkbox", {
        name: "Clear board and start score tracking",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Use this board" }));
    const [appliedBoard, appliedPremiums, clearBoard] = onApply.mock.calls[0];
    expect(appliedBoard).toEqual(board);
    expect(clearBoard).toBe(false);
    expect(appliedPremiums[0]).toBe("TW");
    expect(appliedPremiums[111]).toBe("DL");
    expect(appliedPremiums[112]).toBe("");
  },
);
