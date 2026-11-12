import { beforeEach, afterEach, expect, test, vi } from "vitest";
import {
  render,
  screen,
  within,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../src/App";
import { store } from "../../src/store";
import { PRESETS } from "../../shared/presets";
import { emptyBoard, type AppState, type Game } from "../../shared/model";
import { Lexicon } from "../../shared/lexicon";
import { solve } from "../../shared/solver";

let remote: AppState;
const game = (): Game => ({
  id: "g",
  profileId: "p",
  name: "First game",
  template: structuredClone(PRESETS[0]),
  dictionaryId: "test",
  board: emptyBoard(15),
  rack: "",
  past: [],
  future: [],
  revision: 0,
  updatedAt: "",
  archived: false,
});
const current = () =>
  store.getSnapshot().data!.games.find((g) => g.id === "g")!;
class SolverWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  terminate = vi.fn();
  postMessage(request: {
    id: number;
    board: string[];
    rack: string;
    template: (typeof PRESETS)[0];
  }) {
    const moves = solve(
      new Lexicon(["AT", "CAT", "CATS", "ACT", "DOG", "RAT", "ART", "TAR"]),
      request.board,
      request.rack,
      request.template,
    );
    queueMicrotask(() =>
      this.onmessage?.({
        data: { id: request.id, moves, warnings: [], elapsed: 1 },
      }),
    );
  }
}
beforeEach(() => {
  localStorage.clear();
  remote = {
    profiles: [{ id: "p", name: "My profile" }],
    games: [game()],
    templates: structuredClone(PRESETS),
    dictionaries: [
      {
        id: "test",
        name: "Test words",
        count: 8,
        builtin: true,
        description: "",
      },
    ],
  };
  clearTimeout(store.timer);
  store.drafts.clear();
  store.busy = false;
  store.refreshing = false;
  store.snapshot = {
    data: structuredClone(remote),
    online: true,
    error: "",
    pending: [],
    conflicts: {},
    storageError: false,
  };
  vi.stubGlobal("Worker", SolverWorker);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      let value: unknown = remote;
      const body = options?.body ? JSON.parse(options.body as string) : null;
      if (url.startsWith("/api/games/") && options?.method === "PUT") {
        value = { ...body, revision: body.revision + 1 };
        remote.games = remote.games.map((g) =>
          g.id === body.id ? (value as Game) : g,
        );
      } else if (url === "/api/games" && options?.method === "POST") {
        value = {
          ...body,
          id: `g${remote.games.length}`,
          revision: 0,
          updatedAt: "",
        };
        remote.games.push(value as Game);
      } else if (
        url.startsWith("/api/profiles/") &&
        options?.method === "PUT"
      ) {
        value = { id: "p", name: body.name };
        remote.profiles[0] = value as (typeof remote.profiles)[0];
      } else if (
        url.startsWith("/api/templates/") &&
        options?.method === "PUT"
      ) {
        value = body;
        remote.templates = remote.templates.map((t) =>
          t.id === body.id ? body : t,
        );
      } else if (url === "/api/templates" && options?.method === "POST") {
        value = { ...body, id: "custom", builtin: false };
        remote.templates.push(value as (typeof PRESETS)[0]);
      }
      return new Response(JSON.stringify(value), {
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});
afterEach(() => clearTimeout(store.timer));
async function start() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: /First game/ });
  return user;
}
const entry = () =>
  screen.getByRole("textbox", { name: "Word to enter on board" });

test("enter across/down, skip existing letters, mark blanks, erase and undo/redo", async () => {
  const user = await start();
  await user.click(screen.getByRole("button", { name: "H8: DW, start" }));
  await user.type(entry(), "CAT{Enter}");
  expect(current().board.slice(112, 115)).toEqual(["C", "A", "T"]);
  await user.click(screen.getByRole("button", { name: "I8: A" }));
  await user.type(entry(), "R");
  await user.keyboard("{Shift>}{Enter}{/Shift}");
  expect(
    screen.getByRole("button", { name: "Toggle entry direction" }).textContent,
  ).toContain("Down");
  expect(document.activeElement).toBe(entry());
  expect(current().board[113]).toBe("A");
  await user.clear(entry());
  await user.type(entry(), ".RT{Enter}");
  expect([
    current().board[113],
    current().board[128],
    current().board[143],
  ]).toEqual(["A", "R", "T"]);
  await user.click(screen.getByRole("button", { name: "Blank tile: off" }));
  expect(current().board[113]).toBe("a");
  await user.click(screen.getByRole("button", { name: "Erase selected tile" }));
  expect(current().board[113]).toBe("");
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(current().board[113]).toBe("a");
  await user.click(screen.getByRole("button", { name: "Redo" }));
  expect(current().board[113]).toBe("");
});

test("direction button retains input focus and text; edge entry is rejected", async () => {
  const user = await start();
  await user.click(screen.getByRole("button", { name: "O15: TW" }));
  await user.type(entry(), "CAT");
  await user.click(
    screen.getByRole("button", { name: "Toggle entry direction" }),
  );
  expect(document.activeElement).toBe(entry());
  expect((entry() as HTMLInputElement).value).toBe("CAT");
  await user.keyboard("{Enter}");
  expect(screen.getByRole("alert").textContent).toContain("edge");
  expect(current().board.some(Boolean)).toBe(false);
});

test("rack → real solver → hover preview → play → undo/redo → save", async () => {
  const user = await start();
  await user.type(
    screen.getByRole("textbox", { name: "Rack letters" }),
    "CATS",
  );
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  const row = await screen.findAllByRole("button", { name: /^CATS, / });
  fireEvent.pointerEnter(row[0], { pointerType: "mouse" });
  expect(current().board.some(Boolean)).toBe(false);
  await user.click(row[0]);
  expect(current().board.filter(Boolean).join("")).toBe("CATS");
  expect(current().rack).toBe("");
  expect(current().past.at(-1)?.score).toBeGreaterThan(0);
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(current().rack).toBe("CATS");
  expect(current().board.some(Boolean)).toBe(false);
  await user.click(screen.getByRole("button", { name: "Redo" }));
  await store.flush();
  expect(remote.games[0].board).toEqual(current().board);
  expect(remote.games[0].rack).toBe("");
});

test("rename profile preserves games and stable profile selection", async () => {
  const user = await start();
  await user.click(
    screen.getByRole("button", { name: "Rename current profile" }),
  );
  const field = screen.getByRole("textbox", { name: "Profile name" });
  await user.clear(field);
  await user.type(field, "New name");
  await user.click(screen.getByRole("button", { name: "Save name" }));
  await waitFor(() =>
    expect(store.snapshot.data!.profiles[0].name).toBe("New name"),
  );
  expect(
    (
      screen.getByRole("combobox", {
        name: "Current profile",
      }) as HTMLSelectElement
    ).value,
  ).toBe("p");
  expect(current().profileId).toBe("p");
  expect(current().name).toBe("First game");
});

test("custom template creation/editing persists one template and built-ins have no edit action", async () => {
  const user = await start();
  await user.click(screen.getByRole("button", { name: "Board studio" }));
  expect(screen.getAllByText("Read-only")).toHaveLength(3);
  expect(screen.queryByRole("button", { name: "Edit Scrabble" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "New custom board" }));
  await user.clear(screen.getByLabelText("Board name"));
  await user.type(screen.getByLabelText("Board name"), "Mini");
  await user.selectOptions(screen.getByLabelText("Board size"), "5");
  await user.click(screen.getByRole("button", { name: "Save board template" }));
  await user.click(await screen.findByRole("button", { name: "Edit Mini" }));
  await user.clear(screen.getByLabelText("Board name"));
  await user.type(screen.getByLabelText("Board name"), "Mini revised");
  await user.clear(screen.getByLabelText("Full-rack bonus"));
  await user.type(screen.getByLabelText("Full-rack bonus"), "25");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("button", { name: "Edit Mini revised" });
  expect(remote.templates).toHaveLength(4);
  expect(remote.templates[3].bingo).toBe(25);
  expect(current().template).toEqual(PRESETS[0]);
});

test("multiple games retain separate racks and theme selection survives remount", async () => {
  const user = await start();
  await user.type(screen.getByRole("textbox", { name: "Rack letters" }), "CAT");
  await user.click(screen.getByRole("button", { name: "New game" }));
  await user.type(
    screen.getByRole("textbox", { name: "Game name" }),
    "Second game",
  );
  await user.click(screen.getByRole("button", { name: "Create game" }));
  await screen.findByRole("heading", { name: /Second game/ });
  await user.type(screen.getByRole("textbox", { name: "Rack letters" }), "DOG");
  await user.click(screen.getByRole("button", { name: "First game Scrabble" }));
  expect(
    (screen.getByRole("textbox", { name: "Rack letters" }) as HTMLInputElement)
      .value,
  ).toBe("CAT");
  await user.click(screen.getByRole("button", { name: "dark theme" }));
  expect(localStorage.getItem("tilewise:theme")).toBe("dark");
  expect(
    store.snapshot.data!.games.find((g) => g.name === "Second game")!.rack,
  ).toBe("DOG");
});

test("editing the rack terminates an active search and permits new input", async () => {
  let running: SolverWorker | undefined;
  class DeferredWorker extends SolverWorker {
    constructor() {
      super();
      running = this;
    }
    postMessage() {}
  }
  vi.stubGlobal("Worker", DeferredWorker);
  const user = await start();
  await user.type(
    screen.getByRole("textbox", { name: "Rack letters" }),
    "???????",
  );
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  expect(screen.getByRole("button", { name: "Cancel search" })).toBeTruthy();
  await user.clear(screen.getByRole("textbox", { name: "Rack letters" }));
  expect(running!.terminate).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Cancel search" })).toBeNull();
  await user.type(screen.getByRole("textbox", { name: "Rack letters" }), "CAT");
  expect(current().rack).toBe("CAT");
});
