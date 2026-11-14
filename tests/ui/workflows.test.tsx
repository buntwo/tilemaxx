import { beforeEach, afterEach, expect, test, vi } from "vitest";
import {
  render,
  act,
  screen,
  within,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../src/App";
import { GameStore, store } from "../../src/store";
import { summarizeGame } from "../../shared/game-index";
import { PRESETS } from "../../shared/presets";
import { emptyBoard, type AppState, type Game } from "../../shared/model";
import { Lexicon } from "../../shared/lexicon";
import { solve, solvePosition } from "../../shared/solver";
import { analyzeMoves, type AnalysisRequest } from "../../shared/move-analysis";
import { MoveResultIndex } from "../../shared/move-results";
import type { SolverMessage, SolverRequest } from "../../src/solver-messages";
import type { PracticeRequest } from "../../src/practice.worker";
import { simulateExchange } from "../../shared/exchange";
import { TILE_SYMBOLS } from "../../shared/tile-pool";

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
const current = () => store.getSnapshot().games.g;
class SolverWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  terminate = vi.fn();
  results = new Map<number, MoveResultIndex>();
  private readonly reply: boolean;
  constructor(url?: URL) {
    this.reply = !!url?.pathname.endsWith("/reply.worker.ts");
  }
  protected rackOdds = {};
  protected exchangeRequest(
    _request: Extract<SolverRequest, { kind: "solve" }>,
  ): Extract<SolverMessage, { kind: "moves" }>["exchange"] {
    return undefined;
  }
  postMessage(request: SolverRequest) {
    if (this.reply) return;
    if (request.kind === "discard") {
      this.results.delete(request.searchId);
      return;
    }
    if (request.kind === "page" || request.kind === "shortlist") {
      const result = this.results.get(request.searchId);
      const data =
        request.kind === "page"
          ? {
              kind: request.kind,
              id: request.id,
              page: result?.page(request.query),
            }
          : {
              kind: request.kind,
              id: request.id,
              shortlist: result?.shortlist(request.options),
            };
      queueMicrotask(() => this.onmessage?.({ data }));
      return;
    }
    if (request.kind !== "solve") return;
    const moves = solvePosition(
      new Lexicon(["AT", "CAT", "CATS", "ACT", "DOG", "RAT", "ART", "TAR"]),
      request,
      request.template,
    );
    const result = new MoveResultIndex(moves);
    this.results.set(request.id, result);
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          kind: "moves",
          id: request.id,
          results: result.summary(request.id),
          warnings: [],
          elapsed: 1,
          exchange: this.exchangeRequest(request),
        },
      });
      this.onmessage?.({
        data: { kind: "defense", id: request.id, done: true },
      });
      this.onmessage?.({
        data: {
          kind: "rack-odds",
          id: request.id,
          odds: { byLeave: this.rackOdds, exact: true, bagSize: 89 },
        },
      });
    });
  }
}

test("compare mode selects moves without playing and switches model without rerunning", async () => {
  let runs = 0;
  class TestAnalysisWorker extends SolverWorker {
    postMessage(
      request: Parameters<SolverWorker["postMessage"]>[0] | AnalysisRequest,
    ) {
      if ("kind" in request) return super.postMessage(request);
      runs++;
      const result = analyzeMoves(
        new Lexicon(["AT", "CAT", "CATS", "ACT", "DOG", "RAT", "ART", "TAR"]),
        { ...request, trials: 8 },
        new Set(["AT", "CAT", "DOG", "ART"]),
      );
      queueMicrotask(() => this.onmessage?.({ data: { result } }));
    }
  }
  vi.stubGlobal("Worker", TestAnalysisWorker);
  const user = await start();
  await typeRack(user, "CATS");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await user.click(await screen.findByRole("button", { name: "Analyze" }));
  const alternative = screen
    .getAllByRole("button", { name: /^CATS, / })
    .find((row) => row.getAttribute("aria-pressed") === "false")!;
  await user.click(alternative);
  expect(alternative.getAttribute("aria-pressed")).toBe("true");
  expect(current().board.some(Boolean)).toBe(false);
  await user.click(screen.getByRole("button", { name: "Run analysis" }));
  expect(
    await screen.findAllByRole("article", { name: /^Analysis for/ }),
  ).toHaveLength(2);
  expect(screen.getByText("40+ threat removed")).toBeTruthy();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Opponent model" }),
    "casual",
  );
  expect(runs).toBe(1);
  expect(current().rack).toBe("CATS");
  await user.click(rackTile(1));
  await user.keyboard("D");
  expect(screen.queryByRole("article", { name: /^Analysis for/ })).toBeNull();
});

test("analysis counter follows worker progress and disappears on cancel", async () => {
  let analysisWorker: SolverWorker | undefined;
  class DeferredAnalysisWorker extends SolverWorker {
    postMessage(
      request: Parameters<SolverWorker["postMessage"]>[0] | AnalysisRequest,
    ) {
      if (!("kind" in request)) analysisWorker = this;
      else super.postMessage(request);
    }
  }
  vi.stubGlobal("Worker", DeferredAnalysisWorker);
  const user = await start();
  await typeRack(user, "CATS");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await user.click(await screen.findByRole("button", { name: "Analyze" }));
  await user.click(screen.getByRole("button", { name: "Run analysis" }));
  expect(screen.getByText("0 / 200 scenarios")).toBeTruthy();
  const report = (progress: {
    phase: string;
    completed: number;
    total: number;
  }) => {
    act(() => analysisWorker!.onmessage?.({ data: { progress } }));
  };
  report({ phase: "draws", completed: 20, total: 200 });
  expect(screen.getByText("20 / 200 draws")).toBeTruthy();
  report({ phase: "scenarios", completed: 70, total: 200 });
  expect(screen.getByText("70 / 200 scenarios")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Cancel analysis" }));
  report({ phase: "scenarios", completed: 80, total: 200 });
  expect(screen.queryByText(/\/ 200 scenarios/)).toBeNull();
  expect(analysisWorker!.terminate).toHaveBeenCalledOnce();
});

test("a new game defaults to imported WOW24 even from another dictionary", async () => {
  const user = await start();
  const wow = {
    id: "imported-wow",
    name: "FINAL-WOW24-Full-Alphabetical",
    count: 195383,
    builtin: false,
    description: "",
  };
  remote.dictionaries.push(wow);
  await act(() => store.refresh());
  await user.click(screen.getByRole("button", { name: "New game" }));
  const dialog = screen.getByRole("dialog");
  expect(
    (
      within(dialog).getByRole("combobox", {
        name: "Word list",
      }) as HTMLSelectElement
    ).value,
  ).toBe(wow.id);
  expect(current().dictionaryId).toBe("test");
});

test("board check uses the current filtered moves, and cancelled results stay out of the list", async () => {
  type Search = Parameters<SolverWorker["postMessage"]>[0];
  let pending:
    | { worker: SolverWorker; id: number; candidates: GameMove[] }
    | undefined;
  type GameMove = ReturnType<typeof solve>[number];
  class OddsWorker extends SolverWorker {
    protected rackOdds = { "": 0.14 };
    postMessage(request: Search | { id: number; candidates: GameMove[] }) {
      if ("candidates" in request) {
        pending = {
          worker: this,
          id: request.id,
          candidates: request.candidates,
        };
      } else {
        super.postMessage(request);
      }
    }
  }
  vi.stubGlobal("Worker", OddsWorker);
  const user = await start();
  await typeRack(user, "CATS");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  expect(
    await screen.findAllByRole("button", { name: /^CATS,.*bingo draw 14%/ }),
  ).not.toHaveLength(0);
  const search = screen.getByRole("button", { name: "Search possible moves" });
  expect(screen.queryByRole("textbox", { name: "Filter moves" })).toBeNull();
  await user.click(search);
  expect(document.activeElement).toBe(
    screen.getByRole("textbox", { name: "Filter moves" }),
  );
  await user.type(
    screen.getByRole("textbox", { name: "Filter moves" }),
    "CATS",
  );
  await user.click(
    screen.getByRole("button", { name: "Check bingo after your play" }),
  );
  expect(pending!.candidates.length).toBeGreaterThan(0);
  expect(pending!.candidates.length).toBeLessThanOrEqual(20);
  expect(pending!.candidates.every((move) => move.word === "CATS")).toBe(true);
  function finish() {
    const { worker, id, candidates } = pending!;
    act(() =>
      worker.onmessage?.({
        data: {
          id,
          kind: "board-odds",
          odds: {
            byMove: { [candidates[0].id]: { chance: 0.5, exact: false } },
            checked: 1,
            total: candidates.length,
            bagSize: 89,
          },
        },
      }),
    );
  }
  await user.click(screen.getByRole("button", { name: "Cancel bingo check" }));
  finish();
  expect(
    screen.queryByRole("button", { name: /points,.*bingo after your play/ }),
  ).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Check bingo after your play" }),
  );
  finish();
  expect(
    screen.getByRole("button", { name: /bingo after your play ≈50%/ }),
  ).toBeTruthy();
  await user.click(rackTile(1));
  await user.keyboard("D");
  expect(
    screen.queryByRole("button", { name: /points,.*bingo after your play/ }),
  ).toBeNull();
});
beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, "", "/");
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
  localStorage.setItem("tilewise:cache", JSON.stringify(remote));
  const initial = new GameStore();
  for (const [key, value] of Object.entries(initial)) {
    if (typeof value !== "function") Object.assign(store, { [key]: value });
  }
  store.snapshot = {
    ...initial.snapshot,
    online: true,
    error: "",
    pending: [],
    conflicts: {},
    saveErrors: {},
    storageError: false,
  };
  vi.stubGlobal("Worker", SolverWorker);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      let value: unknown = remote;
      const body = options?.body ? JSON.parse(options.body as string) : null;
      if (url === "/api/state/index") {
        value = { ...remote, games: remote.games.map(summarizeGame) };
      } else if (url.startsWith("/api/games/") && options?.method === "GET") {
        value = remote.games.find(({ id }) => id === url.split("/").at(-1));
      } else if (
        url.startsWith("/api/games/") &&
        options?.method === "DELETE"
      ) {
        remote.games = remote.games.filter(
          (g) => g.id !== url.split("/").at(-1),
        );
        value = { deleted: true };
      } else if (url.startsWith("/api/games/") && options?.method === "PUT") {
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
        options?.method === "DELETE"
      ) {
        const id = url.split("/").at(-1);
        value = {
          gameIds: remote.games
            .filter((g) => g.profileId === id)
            .map((g) => g.id),
        };
        remote.games = remote.games.filter((g) => g.profileId !== id);
        remote.profiles = remote.profiles.filter((p) => p.id !== id);
      } else if (url.endsWith("/game-order") && options?.method === "PUT") {
        remote.profiles[0].gameOrder = body.gameIds;
        value = { gameOrder: body.gameIds };
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
const entry = () => screen.getByRole("textbox", { name: "Type on board" });
const cell = (name: string) => screen.getByRole("button", { name });
const rackTile = (i: number) =>
  screen.getByRole("button", { name: new RegExp(`^Rack tile ${i}:`) });
async function typeRack(
  user: ReturnType<typeof userEvent.setup>,
  letters: string,
) {
  await user.click(rackTile(1));
  await user.keyboard(letters);
}
const selectedCell = () =>
  document
    .querySelector(".board-entry .square.selected")
    ?.getAttribute("data-cell");

test("board hover shows both word scores on a shared ending and keeps them across tile gaps", async () => {
  const user = await start();
  await user.click(cell("G8: empty"));
  await user.keyboard("CAT");
  await user.click(cell("Record opponent move"));
  await user.click(cell("I6: empty"));
  await user.keyboard("{ArrowDown}AR");
  const end = cell("I8: T");
  const grid = end.closest(".board-grid")!;
  const mouseOver = (element: Element) => {
    const event = new MouseEvent("pointerover", { bubbles: true });
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    fireEvent(element, event);
  };
  mouseOver(end);
  expect(
    [...end.querySelectorAll(".board-word-score")].map(
      (score) => score.textContent,
    ),
  ).toEqual(["10", "4"]);
  expect(
    end.querySelector(".board-word-score.across")?.getAttribute("aria-label"),
  ).toMatch(/^CAT across/);
  expect(
    end.querySelector(".board-word-score.down")?.getAttribute("aria-label"),
  ).toMatch(/^ART down/);
  expect(grid.querySelectorAll(".word-hover")).toHaveLength(5);
  mouseOver(grid);
  expect(grid.querySelectorAll(".word-hover")).toHaveLength(5);
  mouseOver(cell("J8: empty"));
  expect(grid.querySelector(".board-word-score")).toBeNull();
  expect(grid.querySelector(".word-hover")).toBeNull();
});

test("direct entry, skip existing letters, blanks, erase, undo/redo and persistence", async () => {
  const user = await start();
  await user.click(cell("H8: DW, start"));
  await user.keyboard("CAT");
  expect(current().board.slice(112, 115)).toEqual(["C", "A", "T"]);
  expect(selectedCell()).toBe("115");
  await user.click(cell("I8: A"));
  await user.keyboard("{ArrowDown}.R T");
  expect([
    current().board[113],
    current().board[128],
    current().board[143],
  ]).toEqual(["A", "R", "t"]);
  expect(cell("I10: T blank").classList.contains("blank")).toBe(true);
  await user.click(cell("I10: T blank"));
  await user.click(cell("Blank tile: on"));
  expect(current().board[143]).toBe("T");
  await user.click(cell("Erase selected tile"));
  expect(current().board[143]).toBe("");
  await user.click(cell("Undo"));
  expect(current().board[143]).toBe("T");
  await user.click(cell("Redo"));
  expect(current().board[143]).toBe("");
  await store.flush();
  expect(remote.games[0].board).toEqual(current().board);
  expect(current().rack).toBe("");
});

test("right/down switch direction first, then advance; left/up always move without turning", async () => {
  const user = await start();
  await user.click(cell("H8: DW, start"));
  await user.keyboard("{ArrowRight}");
  expect(selectedCell()).toBe("113");
  await user.keyboard("{ArrowDown}");
  expect(selectedCell()).toBe("113");
  expect(cell("Toggle entry direction").textContent).toContain("Down");
  await user.keyboard("{ArrowDown}");
  expect(selectedCell()).toBe("128");
  await user.keyboard("{ArrowLeft}{ArrowUp}");
  expect(selectedCell()).toBe("112");
  expect(cell("Toggle entry direction").textContent).toContain("Down");
  await user.keyboard("{ArrowRight}");
  expect(selectedCell()).toBe("112");
  expect(cell("Toggle entry direction").textContent).toContain("Across");
  await user.keyboard("{ArrowRight}");
  expect(selectedCell()).toBe("113");
  await user.keyboard("{Shift>}{Enter}{/Shift}");
  expect(cell("Toggle entry direction").textContent).toContain("Down");
});

test("repeat tap toggles direction and controls preserve the same input focus", async () => {
  const user = await start();
  await user.click(cell("C3: DW"));
  const input = entry();
  expect(selectedCell()).toBe("32");
  expect(document.activeElement).toBe(input);
  await user.click(cell("C3: DW"));
  expect(cell("Toggle entry direction").textContent).toContain("Down");
  expect(selectedCell()).toBe("32");
  expect(document.activeElement).toBe(input);
  fireEvent.input(input, {
    target: { value: "\u200bA" },
    inputType: "insertText",
    data: "A",
  });
  expect(current().board[32]).toBe("A");
  expect(selectedCell()).toBe("47");
  expect(entry()).toBe(input);
  await user.click(cell("Toggle entry direction"));
  expect(document.activeElement).toBe(input);
  await user.keyboard(" ");
  expect(document.querySelector(".pending-blank")).toBeTruthy();
  expect(current().board[47]).toBe("");
  fireEvent.input(input, {
    target: { value: "\u200be" },
    inputType: "insertText",
    data: "e",
  });
  expect(current().board[47]).toBe("e");
  // iOS can deliver deletion as an input event without a useful keydown.
  fireEvent.input(input, {
    target: { value: "" },
    inputType: "deleteContentBackward",
  });
  expect(current().board[47]).toBe("");
  expect(selectedCell()).toBe("47");
});

test("edges never wrap or repeatedly overwrite the last cell, including pasted input", async () => {
  const user = await start();
  await user.click(cell("N15: empty"));
  await user.paste("CAT");
  expect(current().board.slice(223)).toEqual(["C", "A"]);
  expect(selectedCell()).toBe("224");
  expect(screen.getByRole("status").textContent).toContain("Board edge");
  await user.keyboard("XYZ{ArrowRight}{ArrowDown}Z");
  expect(current().board[224]).toBe("Z");
  expect(current().board.filter(Boolean)).toHaveLength(2);
  await user.click(cell("A1: TW"));
  await user.keyboard("{ArrowLeft}{ArrowUp}");
  expect(selectedCell()).toBe("0");
  await user.keyboard("{Escape}");
  expect(selectedCell()).toBeUndefined();
});

test("backspace corrects previous letters, Delete erases in place, pending blanks cancel", async () => {
  const user = await start();
  await user.click(cell("H8: DW, start"));
  await user.keyboard("CAT{Backspace}");
  expect(current().board.slice(112, 115)).toEqual(["C", "A", ""]);
  expect(selectedCell()).toBe("114");
  await user.keyboard(" R{ArrowLeft}{Delete}");
  expect(current().board[114]).toBe("");
  expect(selectedCell()).toBe("114");
  await user.keyboard(" {Backspace}S");
  expect(current().board[114]).toBe("S");
  await user.click(cell("I8: A"));
  await user.keyboard("O");
  expect(current().board[113]).toBe("O");
  expect(current().rack).toBe("");
});

test("word-sized history groups typing and deletion, with direction and focus boundaries", async () => {
  const user = await start();
  await user.click(cell("H8: DW, start"));
  await user.keyboard("CAT");
  expect(current().past).toHaveLength(1);
  await user.click(cell("Undo"));
  expect(current().board.some(Boolean)).toBe(false);
  await user.click(cell("Redo"));
  expect(current().board.slice(112, 115).join("")).toBe("CAT");
  await user.click(cell("J8: T"));
  await user.keyboard("{Backspace}{Backspace}{Backspace}");
  expect(current().board.some(Boolean)).toBe(false);
  expect(current().past).toHaveLength(2);
  await user.click(cell("Undo"));
  expect(current().board.slice(112, 115).join("")).toBe("CAT");
  await user.click(cell("K8: empty"));
  await user.keyboard("S{ArrowDown}ON");
  expect(current().past).toHaveLength(3);
  await user.click(cell("Undo"));
  expect(current().board[115]).toBe("S");
  expect(current().board[116]).toBe("");
  expect(current().board[131]).toBe("");
  // Leaving the input ends the group even if direction is unchanged.
  await user.click(cell("L8: DL"));
  await user.keyboard("O");
  await user.click(rackTile(1));
  entry().focus();
  await user.keyboard("N");
  expect(current().past).toHaveLength(4);
});

test("board edits stop a running solver and game switching clears the entry cursor", async () => {
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
  await typeRack(user, "CAT");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await user.click(cell("H8: DW, start"));
  await user.keyboard("A");
  expect(running!.terminate).toHaveBeenCalledOnce();
  await user.click(cell("New game"));
  await user.type(screen.getByRole("textbox", { name: "Opponent" }), "Another");
  await user.click(cell("Create game"));
  await screen.findByRole("heading", { name: /Another/ });
  expect(selectedCell()).toBeUndefined();
  await user.click(cell("Switch game"));
  await user.click(screen.getByRole("menuitemradio", { name: /^First game/ }));
  expect(current().board[112]).toBe("A");
  expect(selectedCell()).toBeUndefined();
});

test("rack → real solver → hover preview → play → undo/redo → save", async () => {
  let solves = 0;
  let replies = 0;
  class CountingWorker extends SolverWorker {
    protected rackOdds = { "": 0.25 };
    postMessage(
      request:
        | Parameters<SolverWorker["postMessage"]>[0]
        | import("../../shared/reply-analysis").ReplyRequest,
    ) {
      if (request.kind === "reply-summary") {
        replies++;
        queueMicrotask(() => {
          for (const move of request.candidates) {
            this.onmessage?.({
              data: {
                kind: request.kind,
                id: request.id,
                moveId: move.id,
                result: {
                  kind: "distribution",
                  mean: 21,
                  difference: 0,
                  count: 500,
                  exact: false,
                  buckets: [100, 400, 0, 0, 0],
                  discordant: [0, 0, 0, 0, 0],
                  reference: { mean: 21, buckets: [100, 400, 0, 0, 0] },
                },
              },
            });
          }
          this.onmessage?.({
            data: { kind: request.kind, id: request.id, done: true },
          });
        });
        return;
      }
      if (request.kind === "reply-detail" || request.kind === "reply-line")
        return;
      super.postMessage(request);
      if (request.kind === "solve") solves++;
    }
  }
  vi.stubGlobal("Worker", CountingWorker);
  const user = await start();
  await typeRack(user, "CATS");
  await user.click(
    screen.getByText(/unseen tiles?$/, {
      selector: ".tile-pool summary strong",
    }),
  );
  const pool = within(screen.getByRole("list", { name: "Unseen tile counts" }));
  const countA = () => pool.getByRole("listitem", { name: "A: 8 unseen" });
  expect(countA()).toBeTruthy();
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  const row = await screen.findAllByRole("button", { name: /^CATS, / });
  const moveRows = () =>
    within(screen.getByLabelText("Suggested moves"))
      .getAllByRole("button")
      .map((move) => move.getAttribute("aria-label"));
  const originalRows = moveRows();
  expect(row[0].querySelector(".result-draw-odds")?.textContent).toBe("25%");
  fireEvent.pointerEnter(row[0], { pointerType: "mouse" });
  expect(current().board.some(Boolean)).toBe(false);
  expect(countA()).toBeTruthy();
  await user.click(row[0]);
  expect(current().board.filter(Boolean).join("")).toBe("CATS");
  expect(current().rack).toBe("");
  expect(countA()).toBeTruthy();
  expect(current().past.at(-1)?.score).toBeGreaterThan(0);
  expect(screen.queryByLabelText("Suggested moves")).toBeNull();
  await act(async () => store.flush());
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(current().rack).toBe("CATS");
  expect(countA()).toBeTruthy();
  expect(current().board.some(Boolean)).toBe(false);
  expect(moveRows()).toEqual(originalRows);
  expect(
    screen.getByLabelText("Suggested moves").querySelectorAll(".reply-mini")
      .length,
  ).toBeGreaterThan(0);
  expect(replies).toBe(1);
  expect(
    screen
      .getAllByRole("button", { name: /^CATS, / })[0]
      .querySelector(".result-draw-odds")?.textContent,
  ).toBe("25%");
  expect(solves).toBe(1);
  await user.click(screen.getByRole("button", { name: "Redo" }));
  expect(screen.queryByLabelText("Suggested moves")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Move history" }));
  await user.click(screen.getByRole("button", { name: "Undo last change" }));
  expect(moveRows()).toEqual(originalRows);
  expect(solves).toBe(1);
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Redo" }),
  );
  await act(async () => store.flush());
  expect(remote.games[0].board).toEqual(current().board);
  expect(remote.games[0].rack).toBe("");
});

test("undo does not restore a played move list from a different dictionary", async () => {
  remote.dictionaries.push({
    ...remote.dictionaries[0],
    id: "other",
    name: "Other words",
  });
  const user = await start();
  await typeRack(user, "CATS");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await user.click(
    (await screen.findAllByRole("button", { name: /^CATS, / }))[0],
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Game dictionary" }),
    "other",
  );
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(current().rack).toBe("CATS");
  expect(screen.queryByLabelText("Suggested moves")).toBeNull();
});

test("focus moves between board, rack and moves without leaving an inactive cursor", async () => {
  const user = await start();
  await user.click(cell("H8: DW, start"));
  await user.keyboard("A");
  expect(selectedCell()).toBe("113");
  await user.click(rackTile(1));
  expect(selectedCell()).toBeUndefined();
  expect(document.querySelector(".entry-arrow")).toBeNull();
  expect(rackTile(1).getAttribute("aria-pressed")).toBe("true");
  await user.keyboard("CAT");
  await user.click(cell("I8: empty"));
  expect(document.querySelector(".rack-tile.selected")).toBeNull();
  expect(selectedCell()).toBe("113");
  // Returning to the same square after blur must not turn the direction.
  expect(cell("Toggle entry direction").textContent).toContain("Across");
  await user.click(screen.getByRole("heading", { name: "Possible moves" }));
  expect(selectedCell()).toBeUndefined();
  await user.click(cell("I8: empty"));
  await user.keyboard(" ");
  expect(document.querySelector(".pending-blank")).toBeTruthy();
  await user.click(rackTile(2));
  expect(document.querySelector(".pending-blank")).toBeNull();
  expect(current().board[113]).toBe("");
});

test("direct rack entry supports Space blanks, replacement, paste, full-rack bounds and deletion", async () => {
  const user = await start();
  await typeRack(user, "CA T");
  expect(current().rack).toBe("CA?T");
  expect(rackTile(3).getAttribute("aria-label")).toBe("Rack tile 3: blank");
  expect(rackTile(3).classList.contains("blank")).toBe(true);
  expect(rackTile(5).getAttribute("aria-pressed")).toBe("true");
  const keyboard = screen.getByRole("textbox", { name: "Rack letters" });
  await user.click(rackTile(2));
  expect(document.activeElement).toBe(keyboard);
  await user.keyboard("O");
  expect(current().rack).toBe("CO?T");
  await user.keyboard("{Delete}");
  expect(current().rack).toBe("CO.T");
  await user.click(rackTile(4));
  await user.keyboard("{Backspace}");
  expect(current().rack).toBe("CO");
  await user.keyboard("{ArrowLeft}");
  await user.paste("AT ?XYZ");
  expect(current().rack).toBe("COAT??X");
  await user.keyboard("Y Z");
  expect(current().rack).toBe("COAT??Z");
  await user.keyboard("{Backspace}");
  expect(current().rack).toBe("COAT??");
  await user.keyboard("X");
  expect(rackTile(7).getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByText(/End of rack/)).toBeNull();
  await user.keyboard("{ArrowLeft}");
  expect(rackTile(6).getAttribute("aria-pressed")).toBe("true");
  await user.keyboard("{Control>}a{/Control}DOG");
  expect(current().rack).toBe("DOG");
  expect(current().board.some(Boolean)).toBe(false);
  await user.click(screen.getByText("Rack tools"));
  await user.click(cell("Sort rack"));
  expect(current().rack).toBe("DGO");
  expect(document.querySelector(".rack-tile.selected")).toBeNull();
  await store.flush();
  expect(remote.games[0].rack).toBe("DGO");
});

test("rack accepts mobile input/deletion events, stays focused, and Enter starts solving", async () => {
  const user = await start();
  await user.click(rackTile(1));
  const keyboard = screen.getByRole("textbox", { name: "Rack letters" });
  expect(rackTile(1).getAttribute("aria-pressed")).toBe("true");
  fireEvent.input(keyboard, {
    target: { value: "\u200b " },
    inputType: "insertText",
    data: " ",
  });
  expect(current().rack).toBe("?");
  fireEvent.input(keyboard, {
    target: { value: "\u200ba" },
    inputType: "insertText",
    data: "a",
  });
  expect(current().rack).toBe("?A");
  expect(document.activeElement).toBe(keyboard);
  await user.click(rackTile(2));
  fireEvent.input(keyboard, {
    target: { value: "" },
    inputType: "deleteContentBackward",
  });
  expect(current().rack).toBe("?");
  await user.keyboard("{Control>}a{/Control}CAT{Enter}");
  await screen.findAllByRole("button", { name: /^CAT, / });
  expect(document.querySelector(".rack-tile.selected")).toBeNull();
});

function touch(
  target: Element,
  type: string,
  extra: Record<string, unknown> = {},
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerType: "touch",
    pointerId: 1,
    isPrimary: true,
    button: 0,
    clientX: 20,
    clientY: 20,
    ...extra,
  });
  fireEvent(target, event);
}

test("touching the wordmark previews its tile and returns after a pause on release or cancel", async () => {
  await start();
  const brand = screen
    .getByRole("link", { name: "Tilemaxx" })
    .closest(".brand")!;
  const tile = brand.querySelector(".brand-mark")!;
  const highlighted = () => brand.querySelector(".brand-highlight");
  const original = highlighted();
  const originalTile = tile.textContent;
  const target = brand.querySelector(
    original?.textContent === "x"
      ? '[data-brand-letter="4"]'
      : '[data-brand-letter="7"]',
  )!;
  const capture = vi.fn();
  Object.defineProperty(target.parentElement, "setPointerCapture", {
    value: capture,
  });
  touch(target, "pointerdown");
  expect(highlighted()).toBe(target);
  expect(tile.textContent).toBe(target.textContent === "x" ? "X8" : "M3");
  expect(target.classList.contains("on-fire")).toBe(
    tile.classList.contains("on-fire"),
  );
  expect(capture).toHaveBeenCalledWith(1);
  touch(target.parentElement!, "pointerup");
  expect(highlighted()).toBe(target);
  await waitFor(() => expect(highlighted()).toBe(original));
  expect(tile.textContent).toBe(originalTile);
  touch(target, "pointerdown");
  touch(target.parentElement!, "pointercancel");
  expect(highlighted()).toBe(target);
  await waitFor(() => expect(highlighted()).toBe(original));
});

test("touch waits for click to focus the keyboard and toggles using selection from before the blur", async () => {
  const user = await start();
  const square = cell("H8: DW, start");
  touch(square, "pointerdown");
  touch(square, "pointerup");
  // Opening the keyboard before the browser's remaining events caused it
  // to immediately dismiss. There must be no focus transfer yet.
  expect(document.activeElement).not.toBe(entry());
  expect(selectedCell()).toBeUndefined();
  fireEvent.touchEnd(square);
  fireEvent.mouseDown(square);
  fireEvent.mouseUp(square);
  fireEvent.click(square, { detail: 1 });
  expect(selectedCell()).toBe("112");
  expect(document.activeElement).toBe(entry());
  expect(cell("Toggle entry direction").textContent).toContain("Across");
  touch(square, "pointerdown");
  touch(square, "pointerup");
  // Exercise a browser that transfers focus after pointerup, before click.
  act(() => square.focus());
  expect(document.activeElement).toBe(square);
  expect(selectedCell()).toBeUndefined();
  fireEvent.mouseUp(square);
  fireEvent.click(square, { detail: 1 });
  expect(document.activeElement).toBe(entry());
  expect(cell("Toggle entry direction").textContent).toContain("Down");
  expect(selectedCell()).toBe("112");
  touch(square, "pointerdown");
  touch(square, "pointerup");
  fireEvent.click(square, { detail: 1 });
  expect(cell("Toggle entry direction").textContent).toContain("Across");
  await user.click(rackTile(1));
  expect(selectedCell()).toBeUndefined();
  touch(square, "pointerdown");
  touch(square, "pointerup");
  fireEvent.click(square, { detail: 1 });
  expect(cell("Toggle entry direction").textContent).toContain("Across");
  await user.keyboard("CAT");
  expect(current().board.slice(112, 115).join("")).toBe("CAT");
  expect(current().past).toHaveLength(1);
});

test("scroll gestures and canceled board touches do not select or turn a square", async () => {
  await start();
  const square = cell("H8: DW, start");
  touch(square, "pointerdown");
  touch(square, "pointermove", { clientY: 80 });
  touch(square, "pointerup", { clientY: 80 });
  fireEvent.click(square);
  expect(selectedCell()).toBeUndefined();
  touch(square, "pointerdown");
  touch(square, "pointercancel");
  touch(square, "pointerup");
  expect(selectedCell()).toBeUndefined();
});

test("holding a played tile reveals its word score without editing and a tap still edits", async () => {
  const user = await start();
  await user.click(cell("H8: DW, start"));
  await user.keyboard("CAT");
  await user.click(rackTile(1));
  const played = cell("I8: A");
  const scores = () => document.querySelectorAll(".board-word-score");

  vi.useFakeTimers();
  try {
    const waitForHold = () => act(() => vi.advanceTimersByTime(500));
    touch(played, "pointerdown");
    touch(played, "pointermove", { clientY: 65 });
    touch(played, "pointercancel");
    waitForHold();
    expect(scores()).toHaveLength(0);

    touch(played, "pointerdown");
    const context = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    fireEvent(played, context);
    expect(context.defaultPrevented).toBe(true);
    waitForHold();
    expect(scores()[0]?.textContent).toBe("10");
    touch(played, "pointerup");
    fireEvent.click(played);
    expect(document.activeElement).not.toBe(entry());
    expect(selectedCell()).toBeUndefined();
    expect(scores()).toHaveLength(1);

    touch(played, "pointerdown");
    touch(played, "pointerup");
    fireEvent.click(played);
    waitForHold();
    expect(scores()).toHaveLength(0);
    expect(selectedCell()).toBe("113");
    expect(document.activeElement).toBe(entry());
  } finally {
    vi.useRealTimers();
  }
});

test("rack typo correction and persisted gaps keep subsequent tiles fixed and still solve", async () => {
  const user = await start();
  await typeRack(user, "COT");
  await user.click(rackTile(2));
  await user.keyboard("X");
  await user.click(rackTile(2));
  await user.keyboard("{Backspace}");
  expect(current().rack).toBe("C.T");
  expect(rackTile(2).getAttribute("aria-label")).toBe("Rack tile 2: empty");
  expect(rackTile(3).getAttribute("aria-label")).toBe("Rack tile 3: T");
  expect(rackTile(2).getAttribute("aria-pressed")).toBe("true");
  await store.flush();
  expect(remote.games[0].rack).toBe("C.T");
  await user.keyboard("A");
  expect(current().rack).toBe("CAT");
  await user.click(rackTile(2));
  await user.keyboard("{Delete}");
  expect(current().rack).toBe("C.T");
  await user.click(rackTile(5));
  await user.keyboard("A{Enter}");
  expect(current().rack).toBe("C.T.A");
  await screen.findAllByRole("button", { name: /^CAT, / });
  expect(screen.queryByText("3 / 7 tiles")).toBeNull();
});

test("rack Backspace clears a clicked tile once, then moves backward, including at rack edges", async () => {
  const user = await start();
  await typeRack(user, "CAT DOG");
  // At the end, the visible cursor is on the final tile, not past the rack.
  await user.keyboard("{Backspace}");
  expect(current().rack).toBe("CAT?DO");
  expect(rackTile(7).getAttribute("aria-pressed")).toBe("true");
  await user.keyboard("G");
  await user.click(rackTile(1));
  await user.keyboard("{Backspace}");
  expect(current().rack).toBe(".AT?DOG");
  expect(rackTile(1).getAttribute("aria-pressed")).toBe("true");
  await user.keyboard("{Backspace}");
  expect(current().rack).toBe(".AT?DOG");
  expect(rackTile(1).getAttribute("aria-pressed")).toBe("true");
  await user.keyboard("C");
  await user.click(rackTile(3));
  await user.keyboard("{Backspace}");
  expect(current().rack).toBe("CA.?DOG");
  await user.keyboard("{Backspace}");
  expect(current().rack).toBe("C..?DOG");
  expect(rackTile(2).getAttribute("aria-pressed")).toBe("true");
  await user.keyboard("AT");
  expect(current().rack).toBe("CAT?DOG");
  await user.click(rackTile(4));
  const keyboard = screen.getByRole("textbox", { name: "Rack letters" });
  fireEvent.input(keyboard, {
    target: { value: "" },
    inputType: "deleteContentBackward",
  });
  expect(current().rack).toBe("CAT.DOG");
  expect(rackTile(4).getAttribute("aria-pressed")).toBe("true");
  await user.keyboard(" ");
  expect(current().rack).toBe("CAT?DOG");
  await user.click(rackTile(7));
  await user.keyboard("{Backspace}");
  expect(current().rack).toBe("CAT?DO");
  expect(rackTile(7).getAttribute("aria-pressed")).toBe("true");
  await user.keyboard("{Backspace}");
  expect(current().rack).toBe("CAT?D");
  expect(rackTile(6).getAttribute("aria-pressed")).toBe("true");
  await user.keyboard("OG");
  expect(current().rack).toBe("CAT?DOG");
});

test("rack typing and mobile Backspace return to the erased slot without shifting neighbors", async () => {
  const user = await start();
  await typeRack(user, "CO{Backspace}AT");
  expect(current().rack).toBe("CAT");
  await user.click(rackTile(2));
  await user.keyboard("X{Backspace}");
  expect(current().rack).toBe("C.T");
  expect(rackTile(2).getAttribute("aria-pressed")).toBe("true");
  const keyboard = screen.getByRole("textbox", { name: "Rack letters" });
  fireEvent.input(keyboard, {
    target: { value: "\u200ba" },
    inputType: "insertText",
    data: "a",
  });
  expect(current().rack).toBe("CAT");
  fireEvent.input(keyboard, {
    target: { value: "" },
    inputType: "deleteContentBackward",
  });
  expect(current().rack).toBe("C.T");
  expect(rackTile(2).getAttribute("aria-pressed")).toBe("true");
  // Clicking even an empty slot arms a single in-place deletion.
  await user.click(rackTile(2));
  fireEvent.input(keyboard, {
    target: { value: "" },
    inputType: "deleteContentBackward",
  });
  expect(current().rack).toBe("C.T");
  expect(rackTile(2).getAttribute("aria-pressed")).toBe("true");
  fireEvent.input(keyboard, {
    target: { value: "" },
    inputType: "deleteContentBackward",
  });
  expect(current().rack).toBe("..T");
  expect(rackTile(1).getAttribute("aria-pressed")).toBe("true");
  await user.keyboard("CA");
  expect(current().rack).toBe("CAT");
});

test("rename profile preserves games and stable profile selection", async () => {
  const user = await start();
  await user.click(
    screen.getByRole("button", { name: "Edit current profile" }),
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

test("profile deletion requires the exact name and allows a new profile after deleting the last one", async () => {
  const user = await start();
  await user.click(
    screen.getByRole("button", { name: "Edit current profile" }),
  );
  await user.click(screen.getByRole("button", { name: "Delete profile…" }));
  const confirm = screen.getByRole("button", { name: "Delete permanently" });
  const input = screen.getByRole("textbox", {
    name: "Type My profile to confirm",
  });
  expect(confirm.hasAttribute("disabled")).toBe(true);
  await user.type(input, "my profile");
  expect(confirm.hasAttribute("disabled")).toBe(true);
  await user.click(screen.getByRole("button", { name: "Keep profile" }));
  expect(current()).toBeDefined();
  await user.click(screen.getByRole("button", { name: "Delete profile…" }));
  await user.type(
    screen.getByRole("textbox", { name: "Type My profile to confirm" }),
    "My profile",
  );
  await user.click(screen.getByRole("button", { name: "Delete permanently" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Create a profile" }),
    ).toBeTruthy(),
  );
  expect(remote.profiles).toEqual([]);
  expect(remote.games).toEqual([]);
  await user.click(screen.getByRole("button", { name: "Create a profile" }));
  expect(screen.getByRole("textbox", { name: "Profile name" })).toBeTruthy();
});

test("custom template creation/editing persists one template and built-ins have no edit action", async () => {
  const user = await start();
  await user.click(screen.getByRole("button", { name: "Board studio" }));
  expect(location.hash).toBe("#board-studio");
  expect(screen.getByRole("heading", { name: "Board studio" })).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Your rack" })).toBeNull();
  expect(document.querySelectorAll(".layout-thumbnail")).toHaveLength(
    PRESETS.length,
  );
  expect(screen.getAllByText("Read-only")).toHaveLength(PRESETS.length);
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
  await user.click(screen.getByText(/Additional play bonuses/));
  await user.type(screen.getByLabelText("Bonus for 3 tiles"), "12");
  await user.type(screen.getByLabelText("Bonus for 5 tiles"), "20");
  await user.click(screen.getByText(/^Starting tile counts/));
  await user.clear(screen.getByLabelText("Starting Q count"));
  await user.type(screen.getByLabelText("Starting Q count"), "4");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("button", { name: "Edit Mini revised" });
  expect(remote.templates).toHaveLength(PRESETS.length + 1);
  expect(remote.templates.at(-1)?.bingo).toBe(25);
  expect(remote.templates.at(-1)?.additionalBonuses).toEqual({ 3: 12, 5: 20 });
  expect(remote.templates.at(-1)?.tileCounts?.Q).toBe(4);
  expect(current().template).toEqual(PRESETS[0]);
  await user.click(screen.getByRole("button", { name: "Back to games" }));
  expect(screen.getByRole("heading", { name: "First game" })).toBeTruthy();
});

test("unseen tiles reflect rack blanks, assigned board blanks, edits and filters", async () => {
  const user = await start();
  await typeRack(user, "A ");
  await user.click(cell("H8: DW, start"));
  await user.keyboard(" Q");
  await user.click(
    screen.getByText(/unseen tiles?$/, {
      selector: ".tile-pool summary strong",
    }),
  );
  const pool = () =>
    within(screen.getByRole("list", { name: "Unseen tile counts" }));
  expect(
    pool().getByRole("listitem", { name: "Blank: 0 unseen" }),
  ).toBeTruthy();
  expect(pool().getByRole("listitem", { name: "Q: 1 unseen" })).toBeTruthy();
  const filter = screen.getByRole("combobox", { name: "Filter unseen tiles" });
  await user.selectOptions(filter, "remaining");
  expect(pool().queryByRole("listitem", { name: /^Blank:/ })).toBeNull();
  await user.selectOptions(filter, "high");
  expect(pool().queryByRole("listitem", { name: /^A:/ })).toBeNull();
  expect(pool().getByRole("listitem", { name: "Q: 1 unseen" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Undo" }));
  await user.selectOptions(filter, "all");
  expect(
    pool().getByRole("listitem", { name: "Blank: 1 unseen" }),
  ).toBeTruthy();
});

test("multiple games retain separate racks and theme selection survives remount", async () => {
  const user = await start();
  await typeRack(user, "CAT");
  await user.click(screen.getByRole("button", { name: "New game" }));
  await user.type(
    screen.getByRole("textbox", { name: "Opponent" }),
    "Second game",
  );
  await user.type(screen.getByLabelText("Platform"), "Scrabble GO");
  await user.click(screen.getByRole("button", { name: "Create game" }));
  await screen.findByRole("heading", { name: /Second game/ });
  expect(
    store.snapshot.data!.games.find((g) => g.name === "Second game")!.platform,
  ).toBe("Scrabble GO");
  expect(
    store.snapshot.data!.games.find((g) => g.name === "Second game")!.startedOn,
  ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await typeRack(user, "DOG");
  await user.click(cell("Switch game"));
  await user.click(screen.getByRole("menuitemradio", { name: /^First game/ }));
  expect(current().rack).toBe("CAT");
  await user.click(screen.getByRole("button", { name: "dark theme" }));
  expect(localStorage.getItem("tilewise:theme")).toBe("dark");
  expect(
    Object.values(store.snapshot.games).find((g) => g.name === "Second game")!
      .rack,
  ).toBe("DOG");
});

test("dates are editable, the keyboard picker shows active games, and the sidebar opens archived games", async () => {
  const user = await start();
  const archivedBoard = emptyBoard(15);
  archivedBoard[112] = "Z";
  remote.games.push({
    ...game(),
    id: "archived",
    name: "Saved match",
    rack: "DOG",
    board: archivedBoard,
    archived: true,
    startedOn: "2025-04-20",
  });
  await act(() => store.refresh());

  await user.click(cell("Game options"));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: /^Edit game details/,
    }),
  );
  fireEvent.change(screen.getByLabelText("Date"), {
    target: { value: "2026-03-15" },
  });
  await user.click(cell("Save details"));
  expect(current().startedOn).toBe("2026-03-15");
  const trigger = cell("Switch game");
  trigger.focus();
  await user.keyboard("{ArrowDown}");
  const menu = screen.getByRole("menu", { name: "Active games" });
  const option = within(menu).getByRole("menuitemradio", {
    name: /First game.*2026/,
  });
  expect(document.activeElement).toBe(option);
  const pickerPreview = option.querySelector(".board-thumbnail")!;
  expect(pickerPreview.querySelector('[fill="var(--tw)"]')).toBeTruthy();
  expect(pickerPreview.querySelector(".thumbnail-played")).toBeNull();
  expect(within(menu).queryByText("Saved match")).toBeNull();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu", { name: "Active games" })).toBeNull();
  expect(document.activeElement).toBe(trigger);
  remote.games.push(
    {
      ...game(),
      id: "newer",
      name: "Zoe",
      archived: true,
      startedOn: "2026-05-12",
    },
    {
      ...game(),
      id: "undated",
      name: "Alex",
      archived: true,
    },
  );
  await act(() => store.refresh());
  await user.click(cell("Archived games"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Your rack" })).toBeNull();
  const archived = () =>
    within(screen.getByRole("region", { name: "Archived games" }));
  const originalPreview = archived().getByRole("button", {
    name: /Saved match.*2025/,
  });
  const thumbnail = originalPreview.querySelector(".board-thumbnail")!;
  expect(thumbnail.querySelector('[fill="var(--tw)"]')).toBeTruthy();
  expect(thumbnail.querySelector(".thumbnail-played")).toBeTruthy();
  await user.click(archived().getByRole("button", { name: "Back to games" }));
  expect(screen.getByRole("heading", { name: "First game" })).toBeTruthy();
  await user.click(cell("Archived games"));
  const names = () =>
    archived()
      .getAllByRole("listitem")
      .map((row) => within(row).getAllByRole("button")[0].textContent);
  expect(names()).toEqual([
    "ZoeMay 12, 2026",
    "Saved matchApr 20, 2025",
    "AlexDate not set",
  ]);
  await user.selectOptions(archived().getByLabelText("Sort by"), "opponent");
  expect(
    names().map((name) => name?.match(/^(Zoe|Saved match|Alex)/)?.[0]),
  ).toEqual(["Alex", "Saved match", "Zoe"]);
  await user.click(
    archived().getByRole("button", { name: "Edit game with Saved match" }),
  );
  const edit = within(screen.getByRole("dialog"));
  await user.clear(edit.getByLabelText("Opponent"));
  await user.type(edit.getByLabelText("Opponent"), "Sam");
  await user.type(edit.getByLabelText("Platform"), "Club night");
  await user.type(edit.getByLabelText("Notes"), "Review the endgame.");
  fireEvent.change(edit.getByLabelText("Date"), {
    target: { value: "2026-06-01" },
  });
  await user.click(edit.getByRole("button", { name: "Save details" }));
  await user.selectOptions(archived().getByLabelText("Sort by"), "date");
  expect(names()[0]).toBe("SamClub night · Jun 1, 2026");
  await store.flush();
  expect(remote.games.find((g) => g.id === "archived")).toMatchObject({
    name: "Sam",
    platform: "Club night",
    startedOn: "2026-06-01",
    archived: true,
    notes: "Review the endgame.",
  });
  await user.click(
    archived().getByRole("button", { name: /Sam.*Club night.*2026/ }),
  );
  expect(screen.getByRole("heading", { name: "Sam" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Switch game" })).toBeNull();
  expect(cell("Archived games").getAttribute("aria-current")).toBe("page");
  expect(cell("My games").getAttribute("aria-current")).toBeNull();
  expect(rackTile(1).getAttribute("aria-label")).toBe("Rack tile 1: D");
  await user.click(screen.getByText("Notes", { selector: "summary" }));
  expect(screen.getByText("Review the endgame.")).toBeTruthy();
  expect(cell("H8: Z, start").classList.contains("archive-edit")).toBe(false);
  await user.click(cell("I8: empty"));
  await user.keyboard("Z");
  expect(
    cell("I8: Z, edited after archiving").classList.contains("archive-edit"),
  ).toBe(true);
  expect(
    screen.getByText("Check tile counts").querySelector("svg"),
  ).toBeTruthy();
  await user.click(cell("Undo"));
  expect(screen.queryByText("Check tile counts")).toBeNull();
  await user.click(cell("Redo"));
  await store.flush();
  await act(() => store.refresh());
  expect(cell("I8: Z, edited after archiving")).toBeTruthy();
  expect(remote.games.find((g) => g.id === "archived")?.archivedBoard).toEqual(
    archivedBoard,
  );
  await user.click(cell("Restore game"));
  expect(cell("I8: empty")).toBeTruthy();
  expect(cell("H8: Z, start")).toBeTruthy();
  expect(screen.queryByText("Check tile counts")).toBeNull();
  expect(screen.getByText("Review the endgame.")).toBeTruthy();
  await store.flush();
  expect(remote.games.find((g) => g.id === "archived")).toMatchObject({
    archived: true,
    board: archivedBoard,
  });
  await user.click(cell("Back to archived games"));
  expect(location.hash).toBe("#archived-games");
  expect(names()[0]).toBe("SamClub night · Jun 1, 2026");
  expect(screen.queryByRole("heading", { name: "Sam" })).toBeNull();
  await user.click(cell("My games"));
  expect(screen.getByRole("heading", { name: "First game" })).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Back to archived games" }),
  ).toBeNull();
  expect(cell("Switch game")).toBeTruthy();
  expect(cell("My games").getAttribute("aria-current")).toBe("page");
});

test("the game picker and archive show the full move history icon on complete games", async () => {
  const user = await start();
  await user.click(cell("H8: DW, start"));
  await user.keyboard("CAT");
  await user.click(cell("Record opponent move"));
  await store.flush();
  expect(
    within(cell("Switch game")).getByRole("img", { name: "Full move history" }),
  ).toBeTruthy();
  expect(screen.queryByText("TIP", { exact: true })).toBeNull();

  const complete = current();
  remote.games.push(
    {
      ...complete,
      id: "archived-tracked",
      name: "Tracked match",
      archived: true,
    },
    {
      ...game(),
      id: "archived-partial",
      name: "Partial match",
      board: complete.board,
      archived: true,
    },
  );
  await act(() => store.refresh());
  await user.click(cell("Switch game"));
  const active = screen.getByRole("menuitemradio", { name: /^First game/ });
  expect(
    within(active).getByRole("img", { name: "Full move history" }),
  ).toBeTruthy();
  await user.keyboard("{Escape}");
  await user.click(cell("Archived games"));
  const tracked = screen.getByRole("button", { name: /^Tracked match/ });
  expect(
    within(tracked).getByRole("img", { name: "Full move history" }),
  ).toBeTruthy();
  const partial = screen.getByRole("button", { name: /^Partial match/ });
  expect(
    within(partial).queryByRole("img", { name: "Full move history" }),
  ).toBeNull();
});

test.each(["phone", "tablet", "desktop"])(
  "game scores use the expected panel order on the %s layout",
  async (layout) => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches:
        (query === "(max-width: 650px)" && layout === "phone") ||
        (query === "(min-width: 1000px)" && layout === "desktop"),
      addEventListener() {},
      removeEventListener() {},
    }));
    await start();
    const scores = screen.getByRole("region", { name: "Game scores" });
    const moves = screen.getByRole("heading", { name: "Possible moves" });
    expect(moves.compareDocumentPosition(scores)).toBe(
      layout === "phone"
        ? Node.DOCUMENT_POSITION_FOLLOWING
        : Node.DOCUMENT_POSITION_PRECEDING,
    );
  },
);

test("the phone layout keeps settings, board help and move filtering accessible", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 650px)",
    addEventListener() {},
    removeEventListener() {},
  }));
  const user = await start();
  const main = within(screen.getByRole("main"));
  const menu = main.getByRole("button", { name: "Open workspace menu" });
  expect(menu.closest(".game-heading")).toBeTruthy();
  expect(document.querySelector(".breadcrumb")).toBeNull();
  expect(main.queryByRole("button", { name: "dark theme" })).toBeNull();
  await user.click(menu);
  await user.click(within(screen.getByRole("complementary")).getByRole("button", { name: "dark theme" }));
  expect(document.documentElement.dataset.theme).toBe("dark");
  await user.click(within(screen.getByRole("complementary")).getByRole("button", { name: "My games" }));

  const legend = main.getByText("Triple word");
  const help = legend.closest("details")!;
  expect(help.open).toBe(false);
  await user.click(main.getByLabelText("Board help"));
  expect(help.open).toBe(true);
  expect(main.getByRole("button", { name: "Import screenshot" })).toBeTruthy();
  await user.click(main.getByLabelText("Board help"));
  expect(help.open).toBe(false);

  await typeRack(user, "CAT");
  await user.click(within(screen.getByRole("region", { name: "Your rack" })).getByRole("button", { name: "Find moves" }));
  await screen.findAllByRole("button", { name: /^CAT, / });
  expect(main.queryByRole("textbox", { name: "Filter moves" })).toBeNull();
  await user.click(main.getByRole("button", { name: "Search possible moves" }));
  const filter = main.getByRole("textbox", { name: "Filter moves" });
  expect(document.activeElement).toBe(filter);
  await user.type(filter, "CAT");
  expect(main.queryByRole("button", { name: /^ACT, / })).toBeNull();
  await user.keyboard("{Escape}");
  expect(main.queryByRole("textbox", { name: "Filter moves" })).toBeNull();
});

test("score tracking records typed opponent moves and solver plays across undo, redo and saving", async () => {
  const user = await start();
  const scores = () =>
    within(screen.getByRole("region", { name: "Game scores" }));
  const tracking = () =>
    scores().getByRole("checkbox", {
      name: "Track scores",
    }) as HTMLInputElement;
  expect(tracking().checked).toBe(true);
  const titleScore = () =>
    screen.queryByRole("group", { name: "Tracked score" });
  expect(titleScore()?.textContent).toBe("0–0");

  await user.click(cell("H8: DW, start"));
  await user.keyboard("CAQ{Backspace}T");
  expect(current().scoring?.opponent.moves).toBe(0);
  expect(scores().getByText("CAT · 10 pts")).toBeTruthy();
  await typeRack(user, "S");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await user.click(await screen.findByRole("button", { name: /^CATS, / }));
  expect(current().scoring?.opponent).toEqual({
    points: 10,
    moves: 1,
    best: 10,
    bingos: 0,
  });
  expect(current().scoring?.you).toEqual({
    points: 6,
    moves: 1,
    best: 6,
    bingos: 0,
  });
  expect(titleScore()?.textContent).toBe("6–10");
  expect(scores().getByText(/Avg 10\.0/)).toBeTruthy();
  await user.click(scores().getByText("Tracked move history"));
  const moves = () =>
    within(scores().getByRole("table", { name: "Tracked moves" }));
  expect(
    moves()
      .getAllByRole("row")
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent),
      ),
  ).toEqual([
    ["2", "CATS (6)", "6", ""],
    ["1", "", "10", "(10) CAT"],
  ]);
  await user.click(cell("Undo"));
  expect(current().scoring?.opponent.points).toBe(10);
  expect(current().scoring?.you.points).toBe(0);
  expect(titleScore()?.textContent).toBe("0–10");
  expect(moves().getAllByRole("row").slice(1)).toHaveLength(1);
  await user.click(cell("Undo"));
  expect(scores().getByText("CAT · 10 pts")).toBeTruthy();
  await user.click(cell("Redo"));
  await user.click(cell("Redo"));
  await user.click(tracking());
  expect(tracking().checked).toBe(false);
  expect(titleScore()).toBeNull();
  expect(moves().getAllByRole("row").slice(1)).toHaveLength(2);
  await store.flush();
  expect(remote.games[0].trackScores).toBe(false);
  expect(remote.games[0].scoring?.you.points).toBe(6);
});

test("the board blank control corrects recorded scores and saves with undo and redo", async () => {
  const user = await start();
  const scores = within(screen.getByRole("region", { name: "Game scores" }));
  const titleScore = () => screen.getByRole("group", { name: "Tracked score" }).textContent;
  await user.click(cell("H8: DW, start"));
  await user.keyboard("CAT");
  await typeRack(user, "S");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await user.click(await screen.findByRole("button", { name: /^CATS, / }));
  expect(titleScore()).toBe("6–10");
  await user.click(scores.getByText("Tracked move history"));
  const points = () => within(scores.getByRole("table", { name: "Tracked moves" }))
    .getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[2].textContent);
  await user.click(cell("H8: C, start"));
  await user.click(cell("Blank tile: off"));
  expect(cell("H8: C blank, start")).toBeTruthy();
  expect(titleScore()).toBe("3–4");
  expect(points()).toEqual(["3", "4"]);
  expect(scores.queryByRole("button", { name: "Keep as correction" })).toBeNull();
  await user.click(cell("Undo"));
  expect(titleScore()).toBe("6–10");
  expect(points()).toEqual(["6", "10"]);
  await user.click(cell("Redo"));
  expect(titleScore()).toBe("3–4");
  expect(points()).toEqual(["3", "4"]);
  await store.flush();
  await act(() => store.refresh());
  expect(remote.games[0].board[112]).toBe("c");
  expect(remote.games[0].trackedMoves?.map(({ score }) => score)).toEqual([4, 3]);
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
  await typeRack(user, "???????");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  expect(screen.getByRole("button", { name: "Cancel search" })).toBeTruthy();
  await user.click(rackTile(1));
  await user.keyboard("{Control>}a{/Control}{Backspace}");
  expect(running!.terminate).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Cancel search" })).toBeNull();
  await typeRack(user, "CAT");
  expect(current().rack).toBe("CAT");
});

test("delete game requires confirmation, cancel retains it, deleting last game shows empty workspace", async () => {
  const user = await start();
  await user.click(screen.getByRole("button", { name: "Game options" }));
  await user.click(screen.getByRole("button", { name: /^Delete game/ }));
  expect(remote.games).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Keep game" }));
  expect(current()).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Game options" }));
  await user.click(screen.getByRole("button", { name: /^Delete game/ }));
  await user.click(screen.getByRole("button", { name: "Delete permanently" }));
  await waitFor(() => expect(remote.games).toHaveLength(0));
  expect(store.snapshot.data!.games).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Create a game" })).toBeTruthy();
});

test("exclude rack tiles with Down or taps, keep the unseen count, and retain held tiles when playing", async () => {
  const user = await start();
  await typeRack(user, "CATS");
  await user.click(rackTile(4));
  await user.keyboard("{ArrowDown}");
  expect(current().rack).toBe("CATS");
  expect(current().excludedRackSlots).toEqual([3]);
  expect(rackTile(4).getAttribute("aria-label")).toContain("held out");
  await user.click(screen.getByText("Rack tools"));
  await user.click(screen.getByRole("button", { name: "Exclude tiles" }));
  await user.click(rackTile(4));
  expect(current().excludedRackSlots).toBeUndefined();
  await user.click(rackTile(4));
  await user.click(screen.getByRole("button", { name: "Done" }));
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  const move = (await screen.findAllByRole("button", { name: /^CAT, / }))[0];
  expect(screen.queryAllByRole("button", { name: /^CATS, / })).toHaveLength(0);
  await user.click(screen.getByText("Options"));
  expect(screen.getByText(/89 right now/)).toBeTruthy();
  await user.click(move);
  await waitFor(() => expect(current().rack).toBe("...S"));
  expect(current().excludedRackSlots).toEqual([3]);
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(current().rack).toBe("CATS");
  expect(current().excludedRackSlots).toEqual([3]);
  await user.click(rackTile(4));
  await user.keyboard("S");
  expect(current().excludedRackSlots).toBeUndefined();
});

test("hovering a move highlights the first available copy of each rack tile it uses", async () => {
  const user = await start();
  await typeRack(user, "CAAAT?");
  await user.click(rackTile(2));
  await user.keyboard("{ArrowDown}");
  await user.click(screen.getByRole("button", { name: "Find moves" }));
  const moves = await screen.findAllByRole("button", { name: /^CAT, / });
  const move = moves.find(
    (row) =>
      row.querySelectorAll(".result-letter.played:not(.assigned-blank)")
        .length === 3,
  )!;
  const highlighted = () =>
    [1, 2, 3, 4, 5, 6].filter((index) =>
      rackTile(index).classList.contains("move-preview"),
    );
  await user.hover(move);
  expect(highlighted()).toEqual([1, 3, 5]);
  await user.unhover(move);
  expect(highlighted()).toEqual([]);

  await user.click(rackTile(1));
  await user.keyboard("{Meta>}a{/Meta}C?T{Enter}");
  const blankMove = (
    await screen.findAllByRole("button", { name: /^CAT, / })
  )[0];
  expect(blankMove.querySelector(".assigned-blank")?.textContent).toBe("A");
  await user.hover(blankMove);
  expect(highlighted()).toEqual([1, 2, 3]);
});

test("reordering My games saves the profile order without switching games", async () => {
  remote.games.push({ ...game(), id: "second", name: "Second game" });
  await store.refresh();
  const user = await start();
  await user.click(cell("Switch game"));
  const handle = screen.getByRole("menuitem", { name: "Reorder First game" });
  expect(handle.closest("[data-selected]")).toBeTruthy();
  expect(screen.getByTitle("2 active games").textContent).toBe("2");
  handle.focus();
  await user.keyboard("{ArrowDown}");
  const options = () =>
    screen
      .getAllByRole("menuitemradio")
      .map((item) => [
        item.querySelector(".game-picker-number")?.textContent,
        item.querySelector("strong")?.textContent,
      ]);
  const reordered = [
    ["1", "Second game"],
    ["2", "First game"],
  ];
  await waitFor(() => expect(options()).toEqual(reordered));
  expect(remote.profiles[0].gameOrder).toEqual(["second", "g"]);
  expect(cell("Switch game").textContent).toContain("First game");
  await act(() => store.refresh());
  expect(options()).toEqual(reordered);
  await user.keyboard("{Escape}");
  expect(screen.queryByTitle("2 active games")).toBeNull();
});

test("the opponent rack is visible before solving and follows the reply bag count", async () => {
  const game = remote.games[0];
  game.rack = "CAT";
  game.excludedRackSlots = [2];
  game.template.tileCounts = Object.fromEntries(
    TILE_SYMBOLS.map((tile) => [
      tile,
      [..."CATJJ?"].filter((letter) => tile === letter).length,
    ]),
  );
  game.revision++;
  const user = await start();
  const panel = within(screen.getByRole("region", { name: "Your rack" }));
  const opponentRack = () =>
    panel.queryByRole("img", { name: "Opponent rack: J, J, blank" });
  expect(
    await panel.findByRole("img", { name: "Opponent rack: J, J, blank" }),
  ).toBeTruthy();
  expect(panel.getByText("Bag assumed empty")).toBeTruthy();

  await user.click(panel.getByText("Rack tools"));
  await user.click(panel.getByRole("button", { name: "Exclude tiles" }));
  await user.click(panel.getByRole("button", { name: /^Rack tile 3: T/ }));
  await user.click(panel.getByRole("button", { name: "Done" }));
  expect(opponentRack()).toBeTruthy();
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await screen.findAllByRole("button", { name: /^CAT, / });
  await user.click(screen.getByText("Options", { selector: "summary" }));
  await user.click(screen.getByText("Reply settings", { selector: "summary" }));
  const bag = screen.getByRole("spinbutton", { name: "Tiles in bag" });
  await user.type(bag, "1");
  await user.click(
    screen.getByRole("button", { name: "Update reply analysis" }),
  );
  expect(opponentRack()).toBeNull();
  await user.clear(bag);
  await user.click(
    screen.getByRole("button", { name: "Update reply analysis" }),
  );
  expect(opponentRack()).toBeTruthy();
  expect(panel.getByText("Bag empty")).toBeTruthy();

  await typeRack(user, "Z");
  expect(opponentRack()).toBeNull();
  expect(panel.getByText("Check tile counts")).toBeTruthy();
});

test("overdrawn tiles show negative counts while other counts stay visible", async () => {
  const board = remote.games[0].board;
  board.fill("U", 0, 4);
  remote.games[0].revision++;
  const user = await start();
  await waitFor(() => expect(current().revision).toBe(1));
  await typeRack(user, "UUA");
  expect(
    screen
      .getByLabelText("Vowels 37, count exceeded")
      .classList.contains("tile-pool-category-alert"),
  ).toBe(true);
  expect(screen.getByText("Consonants 56")).toBeTruthy();
  expect(screen.getByText("Blanks 2")).toBeTruthy();
  await user.click(
    screen.getByText(/unseen tiles?$/, {
      selector: ".tile-pool summary strong",
    }),
  );
  const pool = within(screen.getByRole("list", { name: "Unseen tile counts" }));
  expect(pool.getByRole("listitem", { name: "U: 2 extra" }).textContent).toBe(
    "U-2",
  );
  expect(pool.getByRole("listitem", { name: "A: 8 unseen" }).textContent).toBe(
    "A8",
  );
  expect(
    screen.queryByText(/More tiles entered than this set contains/),
  ).toBeNull();
});

test("the points value opens an anchored score breakdown without playing the move", async () => {
  const user = await start();
  await typeRack(user, "CAT");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  const suggestion = (
    await screen.findAllByRole("button", { name: /^CAT, / })
  )[0];
  const action = within(suggestion.parentElement!).getByRole("button", {
    name: /Score breakdown for CAT at/,
  });
  await user.click(action);
  const tooltip = screen.getByRole("tooltip");
  expect(within(tooltip).getByText("5 × 2 = 10")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(current().board.some(Boolean)).toBe(false);
  expect(current().rack).toBe("CAT");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("tooltip")).toBeNull();

  await user.unhover(action);
  await user.hover(action);
  expect(await screen.findByRole("tooltip")).toBeTruthy();
  await user.unhover(action);
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());

  touch(action, "pointerdown");
  expect(await screen.findByRole("tooltip")).toBeTruthy();
  touch(action, "pointerup");
  fireEvent.click(action);
  expect(screen.getByRole("tooltip")).toBeTruthy();
  expect(current().board.some(Boolean)).toBe(false);
});

test("Optimal Exchange compares swap sizes and marks a choice for the simulator", async () => {
  let recommended: Extract<PracticeRequest, { kind: "optimal-exchange" }> | undefined;
  let simulation: Extract<PracticeRequest, { kind: "exchange" }> | undefined;
  vi.stubGlobal("Worker", class extends SolverWorker {
    postMessage(request: SolverRequest | PracticeRequest) {
      if (request.kind === "optimal-exchange") {
        recommended = request;
        queueMicrotask(() => this.onmessage?.({ data: { result: {
          keepBingo: false,
          checked: 7,
          screeningDraws: 64,
          refinementDraws: 600,
          bestBySize: [{ slots: [1, 2], chance: 0.35, close: false }],
        }}}));
      } else if (request.kind === "exchange") simulation = request;
      else if (!("exchange" in request) && !("turns" in request)) {
        super.postMessage(request);
      }
    }
  });
  const user = await start();
  await typeRack(user, "CAT");
  await user.click(screen.getByText("Rack tools"));
  await user.click(screen.getByRole("button", { name: "Optimal Exchange" }));
  const optimal = within(screen.getByRole("region", { name: "Optimal Exchange" }));
  expect(await optimal.findByText("≈35%")).toBeTruthy();
  expect(optimal.getByText("Keep your rack")).toBeTruthy();
  expect(recommended?.exchange.rack).toBe("CAT");
  await user.click(optimal.getByRole("button", { name: "Mark 2 tiles for exchange" }));
  expect(screen.queryByRole("region", { name: "Optimal Exchange" })).toBeNull();
  expect(screen.getByRole("region", { name: "Simulate exchange" })).toBeTruthy();
  expect(simulation?.exchange.slots).toEqual([1, 2]);
  expect(simulation?.exchange.bag).toBe(recommended?.exchange.bag);
  expect(screen.getByLabelText("Rack tile 2: A, marked for exchange")).toBeTruthy();
  expect(current().rack).toBe("CAT");
});

test("exchange simulation starts on open, shows draw scores, and closes when marks change", async () => {
  const requests: PracticeRequest[] = [];
  vi.stubGlobal(
    "Worker",
    class extends SolverWorker {
      postMessage(request: SolverRequest | PracticeRequest) {
        if (request.kind === "exchange") {
          requests.push(request);
          const result = simulateExchange(
            new Lexicon(["CAT"]),
            request.exchange,
          );
          queueMicrotask(() => this.onmessage?.({ data: { result } }));
        }
      }
    },
  );
  const user = await start();
  await typeRack(user, "CAT");
  await user.click(screen.getByText("Rack tools"));
  await user.click(screen.getByRole("button", { name: "Mark exchange" }));
  await user.click(rackTile(1));
  const simulate = screen.getByRole("button", {
    name: "Simulate exchange (1)",
  });
  await user.click(simulate);
  expect(screen.queryByRole("dialog")).toBeNull();
  const section = screen.getByRole("region", { name: "Simulate exchange" });
  expect(section.closest(".rack-panel")).toBeTruthy();
  const cat = await within(section).findByText("CAT");
  const row = within(cat.closest("li")!);
  expect(requests).toHaveLength(1);
  expect(
    row.getByText("C", { selector: ".rack-exchange-letters span" }),
  ).toBeTruthy();
  expect(row.getByRole("img", { name: "Blank tile" }).textContent).toBe("");
  expect(row.getAllByText("10 pts")).toHaveLength(2);
  expect(row.getByText("4 pts")).toBeTruthy();
  expect(within(section).getByText("90 estimated in bag")).toBeTruthy();
  expect(within(section).queryByRole("spinbutton")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Clear marks" }));
  expect(
    screen.queryByRole("region", { name: "Simulate exchange" }),
  ).toBeNull();
});

test.each(["rack", "results"])("the %s exchange suggestion preserves holds and opens the inline panel", async (source) => {
  const fromResults = source === "results";
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 650px)" && fromResults,
    addEventListener() {},
    removeEventListener() {},
  }));
  let pending: SolverWorker | undefined;
  let adviceRequest: Extract<PracticeRequest, { kind: "exchange-advice" }> | undefined;
  let simulation: Extract<PracticeRequest, { kind: "exchange" }> | undefined;
  vi.stubGlobal(
    "Worker",
    class extends SolverWorker {
      override exchangeRequest(request: Extract<SolverRequest, { kind: "solve" }>) {
        return { ...request, plays: [] };
      }
      override postMessage(
        request: SolverRequest | Extract<PracticeRequest, { kind: "exchange" | "exchange-advice" }>,
      ) {
        if (request.kind === "exchange-advice") {
          pending = this;
          adviceRequest = request;
        } else if (request.kind === "exchange") simulation = request;
        else super.postMessage(request);
      }
    },
  );
  const user = await start();
  await typeRack(user, "CATSUVW");
  await user.click(rackTile(7));
  await user.keyboard("{ArrowDown}");
  const solve = screen.getAllByRole("button", { name: "Find moves" })[0];
  await user.click(solve);
  await screen.findAllByRole("button", { name: /^CATS, / });
  expect(screen.queryByRole("button", { name: /^Swap .* pts/ })).toBeNull();
  expect(pending).toBeTruthy();
  expect(adviceRequest?.exchange.excludedRackSlots).toEqual([6]);
  await act(() => pending?.onmessage?.({
    data: { result: { slots: [4, 5], edge: 8, comparedWith: "CATS" } },
  }));
  const rack = screen.getByRole("region", { name: "Your rack" });
  const header = screen.getByRole("heading", { name: "Possible moves" }).closest("header")!;
  const swap = { name: "Swap UV · +8 pts" };
  const rackAction = within(rack).getByRole("button", swap);
  const headerAction = within(header).getByRole("button", swap);
  const tiles = within(rack).getByRole("group", { name: "Your rack tiles" });
  const scroll = vi.fn();
  tiles.scrollIntoView = scroll;
  await user.click(fromResults ? headerAction : rackAction);
  if (fromResults) expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: "start", behavior: "smooth" });
  else expect(scroll).not.toHaveBeenCalled();
  const panel = screen.getByRole("region", { name: "Simulate exchange" });
  expect(panel.closest(".rack-panel")).toBeTruthy();
  expect(within(panel).getByText(/Estimated \+8 points vs. CATS/)).toBeTruthy();
  expect(screen.getByLabelText("Rack tile 5: U, marked for exchange")).toBeTruthy();
  expect(screen.getByLabelText("Rack tile 6: V, marked for exchange")).toBeTruthy();
  expect(screen.getByLabelText("Rack tile 7: W, held out of solver")).toBeTruthy();
  expect(simulation?.exchange.slots).toEqual([4, 5]);
  expect(simulation?.exchange.excludedRackSlots).toEqual([6]);
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Simulate exchange (2)" }),
  );
  expect(current().rack).toBe("CATSUVW");

  await user.click(rackTile(1));
  await user.keyboard("R");
  expect(screen.queryByRole("region", { name: "Simulate exchange" })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Swap .* pts/ })).toBeNull();

  const completed = pending;
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await waitFor(() => expect(pending).not.toBe(completed));
  const stale = pending!;
  await user.click(rackTile(1));
  await user.keyboard("C");
  expect(stale.terminate).toHaveBeenCalled();
  await act(() => stale.onmessage?.({
    data: { result: { slots: [4, 5], edge: 8 } },
  }));
  expect(screen.queryByRole("button", { name: /^Swap .* pts/ })).toBeNull();
});

test("a new search after playing starts with highest points", async () => {
  const user = await start();
  await typeRack(user, "CATS");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await user.click(await screen.findByRole("button", { name: "Sort by word" }));
  expect(screen.getByRole("combobox", { name: "Sort moves" })).toHaveProperty(
    "value",
    "word",
  );
  await user.click(
    (await screen.findAllByRole("button", { name: /^AT, / }))[0],
  );
  await typeRack(user, "CATS");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  const points = await screen.findByRole("button", { name: "Sort by points" });
  expect(points.getAttribute("aria-pressed")).toBe("true");
  expect(points.getAttribute("title")).toBe("points (descending)");
});
