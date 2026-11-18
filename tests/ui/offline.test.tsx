import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import OfflineStatus from "../../src/components/OfflineStatus";
import { prepareOfflineApp } from "../../src/offline";
import { loadWordList } from "../../src/word-list-cache";
import { emptyBoard, type Game } from "../../shared/model";
import { PRESETS } from "../../shared/presets";

vi.mock("../../src/offline", () => ({ prepareOfflineApp: vi.fn() }));
vi.mock("../../src/word-list-cache", () => ({
  dictionaryUrl: (id: string) => `/api/dictionaries/${id}`,
  familiarWordsUrl: "/dictionaries/moby-frequent.txt",
  loadWordList: vi.fn(),
}));
const game: Game = {
  id: "game",
  profileId: "profile",
  name: "Offline",
  dictionaryId: "words",
  template: PRESETS[0],
  board: emptyBoard(15),
  rack: "",
  past: [],
  future: [],
  revision: 0,
  updatedAt: "",
  archived: false,
};
beforeEach(() => {
  vi.mocked(prepareOfflineApp).mockReset().mockResolvedValue();
  vi.mocked(loadWordList)
    .mockReset()
    .mockResolvedValue({ text: "CAT", persisted: true });
});

test("offline readiness waits for assets and persisted word lists", async () => {
  let finish!: () => void;
  vi.mocked(prepareOfflineApp).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<OfflineStatus game={game} online />);
  expect(screen.getByText("Preparing offline…")).toBeTruthy();
  await act(async () => finish());
  const ready = await screen.findByText("Available offline");
  expect(ready.closest("details")).toBeNull();
  fireEvent.click(ready);
  expect(
    screen.queryByText(/Edits sync when Tilemaxx is reachable again/),
  ).toBeNull();
  expect(loadWordList).toHaveBeenCalledWith("/api/dictionaries/words", {
    refresh: true,
  });
});

test("failed preparation reports the reason and can be retried", async () => {
  vi.mocked(prepareOfflineApp).mockRejectedValueOnce(
    new Error("Offline reopening needs an HTTPS address."),
  );
  render(<OfflineStatus game={game} online />);
  expect(await screen.findByText("Offline setup")).toBeTruthy();
  fireEvent.click(screen.getByText("Offline setup"));
  expect(
    screen.getByText("Offline reopening needs an HTTPS address."),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry offline setup" }));
  expect(await screen.findByText("Available offline")).toBeTruthy();
});

test("changing dictionaries ignores a stale preparation response", async () => {
  let finish!: (value: { text: string; persisted: boolean }) => void;
  vi.mocked(loadWordList).mockImplementation(async (url) => {
    if (url.endsWith("/words"))
      return new Promise((resolve) => {
        finish = resolve;
      });
    throw new Error("New dictionary needs downloading.");
  });
  const view = render(<OfflineStatus game={game} online={false} />);
  view.rerender(
    <OfflineStatus game={{ ...game, dictionaryId: "new" }} online={false} />,
  );
  expect(await screen.findByText("Offline setup")).toBeTruthy();
  await act(async () => finish({ text: "CAT", persisted: true }));
  expect(screen.queryByText("Available offline")).toBeNull();
});

test("failed game storage cannot be presented as ready for offline use", async () => {
  render(<OfflineStatus game={game} online storageError />);
  await waitFor(() => expect(screen.getByText("Offline setup")).toBeTruthy());
  expect(screen.queryByText("Available offline")).toBeNull();
});


test("a removed historical word list does not block current-game offline readiness", async () => {
  vi.mocked(loadWordList).mockImplementation(async (url) => {
    if (url.includes("removed")) throw new Error("Dictionary not found.");
    return { text: "CAT", persisted: true };
  });
  const review = { board: game.board, rack: "CAT", dictionaryId: "removed", tiles: [] };
  const move = { player: "you" as const, word: "CAT", score: 10, at: "", review };
  render(<OfflineStatus game={{ ...game, trackedMoves: [move],
    past: [{ board: game.board, rack: "CAT", at: "", label: "CAT", review }],
    future: [{ board: game.board, rack: "CAT", at: "", label: "CAT", review }],
  }} online />);
  expect(await screen.findByText("Available offline")).toBeTruthy();
  expect(vi.mocked(loadWordList).mock.calls.map(([url]) => url)).toEqual([
    "/api/dictionaries/words", "/dictionaries/moby-frequent.txt",
  ]);
});
