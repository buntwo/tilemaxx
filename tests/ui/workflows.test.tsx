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
import { version } from "../../package.json";
import App from "../../src/App";
import { GameStore, store } from "../../src/store";
import { summarizeGame } from "../../shared/game-index";
import { PRESETS } from "../../shared/presets";
import { importBoard } from "../../shared/screenshot";
import {
  archiveGame,
  emptyBoard,
  localDate,
  newGameFromSettings,
  type AppState,
  type Game,
} from "../../shared/model";
import { Lexicon } from "../../shared/lexicon";
import { solve, solvePosition } from "../../shared/solver";
import { analyzeMoves, type AnalysisRequest } from "../../shared/move-analysis";
import { replyEndgameLine, type ReplyDistribution, type ReplyRequest } from "../../shared/reply-analysis";
import { MoveResultIndex } from "../../shared/move-results";
import { prepareEndgameEstimate } from "../../shared/endgame-estimate";
import type { SolverMessage, SolverRequest } from "../../src/solver-messages";
import type { PracticeRequest } from "../../src/practice.worker";
import type { EndgamePrecomputeRequest } from "../../src/useEndgameLines";
import { simulateExchange } from "../../shared/exchange";
import { TILE_SYMBOLS } from "../../shared/tile-pool";

let remote: AppState & { version?: string };
let workspaceWidth: number;
const workspaceObservers = new Set<(width: number) => void>();

function resizeWorkspace(width: number) {
  workspaceWidth = width;
  for (const notify of workspaceObservers) notify(width);
}

class WorkspaceResizeObserver {
  private readonly notify: (width: number) => void;

  constructor(callback: (entries: { contentRect: { width: number } }[]) => void) {
    this.notify = (width) => callback([{ contentRect: { width } }]);
  }

  observe() {
    workspaceObservers.add(this.notify);
    this.notify(workspaceWidth);
  }

  disconnect() {
    workspaceObservers.delete(this.notify);
  }
}

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
    if (request.kind === "endgame") {
      queueMicrotask(() =>
        this.onmessage?.({ data: { kind: "endgame", id: request.id } }),
      );
      return;
    }
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
    const result = new MoveResultIndex(moves, request.template);
    this.results.set(request.id, result);
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          kind: "moves",
          id: request.id,
          results: result.summary(request.id),
          warnings: [],
          stages: { moves: 1, indexing: 0.5 },
          exchange: this.exchangeRequest(request),
        },
      });
      this.onmessage?.({
        data: { kind: "defense", id: request.id, elapsed: 2 },
      });
      this.onmessage?.({
        data: {
          kind: "rack-odds",
          id: request.id,
          elapsed: 3,
          odds: { byLeave: this.rackOdds, exact: true, bagSize: 89 },
        },
      });
    });
  }
}

test("compare mode selects moves without playing and switches model without rerunning", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(any-hover: hover)",
    addEventListener() {},
    removeEventListener() {},
  }));
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
  const ghosts = () => document.querySelectorAll(".board-entry .ghost");
  await user.hover(alternative);
  expect(ghosts()).toHaveLength(4);
  expect(alternative.getAttribute("aria-pressed")).toBe("false");
  await user.unhover(alternative);
  expect(ghosts()).toHaveLength(0);
  await user.click(alternative);
  expect(alternative.getAttribute("aria-pressed")).toBe("true");
  expect(ghosts()).toHaveLength(4);
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

test("phone analysis taps preview and select a move without offering Play", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 650px)",
    addEventListener() {},
    removeEventListener() {},
  }));
  const user = await start();
  await typeRack(user, "CATS");
  await user.keyboard("{Enter}");
  await user.click(await screen.findByRole("button", { name: "Analyze" }));
  const move = screen.getAllByRole("button", {
    name: /^CATS, /,
    pressed: false,
  })[0];
  const tap = () =>
    user.pointer([{ keys: "[TouchA]", target: move }, { keys: "[/TouchA]" }]);

  await tap();
  expect(move.getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelectorAll(".board-entry .ghost")).toHaveLength(4);
  expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  await tap();
  expect(move.getAttribute("aria-pressed")).toBe("false");
  expect(current().board.some(Boolean)).toBe(false);
  expect(current().rack).toBe("CATS");

  await user.click(screen.getByRole("button", { name: "Close analysis" }));
  expect(document.querySelectorAll(".board-entry .ghost")).toHaveLength(0);
  await tap();
  expect(
    screen.getByRole("button", { name: "Play" }).hasAttribute("disabled"),
  ).toBe(false);
});

test("Analyze keeps one set of move controls while the list scrolls", async () => {
  const user = await start();
  await typeRack(user, "CATS?");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await user.click(await screen.findByRole("button", { name: "Analyze" }));
  const analysis = screen.getByLabelText("Move analysis");
  const moves = screen.getByLabelText("Suggested moves");
  await user.hover(within(moves).getAllByRole("button", { name: /^CATS, / })[0]);

  for (const position of [580, 1160, 1740]) {
    moves.scrollTop = position;
    await act(() => {
      fireEvent.scroll(moves);
    });
    expect(screen.getAllByRole("group", { name: "Move list view" })).toHaveLength(
      1,
    );
    expect(screen.getByLabelText("Move analysis")).toBe(analysis);
  }
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

test("an empty-bag analysis can be rerun with a higher endgame budget", async () => {
  const requests: AnalysisRequest[] = [];
  class BudgetWorker extends SolverWorker {
    postMessage(
      request: Parameters<SolverWorker["postMessage"]>[0] | AnalysisRequest,
    ) {
      if ("kind" in request) return super.postMessage(request);
      requests.push(request);
      const result = analyzeMoves(new Lexicon(["CATS"]), request, new Set());
      queueMicrotask(() => this.onmessage?.({ data: { result } }));
    }
  }
  vi.stubGlobal("Worker", BudgetWorker);
  const user = await start();
  const game = current();
  act(() =>
    store.update({
      ...game,
      rack: "CATS",
      scoring: {
        you: { points: 100, moves: 4, best: 25, bingos: 0 },
        opponent: { points: 200, moves: 4, best: 50, bingos: 0 },
      },
      template: {
        ...game.template,
        rackSize: 4,
        tileCounts: Object.fromEntries(
          TILE_SYMBOLS.map((symbol) => [symbol, Number("ACSTZ".includes(symbol))]),
        ),
      },
    }),
  );
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await user.click(await screen.findByRole("button", { name: "Analyze" }));
  const budget = screen.getByRole<HTMLInputElement>("spinbutton", {
    name: /Endgame budget/,
  });
  expect(budget.value).toBe("1");
  expect(screen.getByText("1,500 positions or 1.5 s per move")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Run analysis" }));
  await screen.findByRole("button", { name: "Refine estimates" });
  expect(requests[0].endgameBudgetMultiplier).toBe(1);
  const card = screen.getByRole("article", { name: /^Analysis for CATS / });
  expect(card.querySelectorAll("summary")).toHaveLength(1);
  await user.click(card.querySelector("summary")!);
  expect(
    within(card)
      .getByText("Optimal endgame swing +82")
      .classList.contains("value-good"),
  ).toBe(true);
  const line = within(
    within(card).getByRole("table", { name: "Optimal endgame line" }),
  );
  expect(line.getByRole("rowheader", { name: "You" })).toBeTruthy();
  const word = within(line.getByRole("cell", { name: /CATS/ }));
  expect(word.getByRole("img", { name: "Bingo" })).toBeTruthy();
  expect(word.getByText("CATS").classList.contains("bingo-move-word")).toBe(true);
  expect(line.getByRole("cell", { name: "62" })).toBeTruthy();
  const comparison = within(
    screen.getByRole("table", { name: "Move comparison" }),
  );
  expect(
    comparison
      .getByRole("cell", { name: "172–190 · Lose by 18" })
      .classList.contains("value-bad"),
  ).toBe(true);
  expect(
    within(card)
      .getByText("Final score 172–190 · Lose by 18")
      .classList.contains("value-bad"),
  ).toBe(true);

  fireEvent.change(budget, { target: { value: "101" } });
  expect(budget.getAttribute("aria-invalid")).toBe("true");
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Run analysis" }).disabled,
  ).toBe(true);
  fireEvent.change(budget, { target: { value: "10" } });
  expect(screen.getByText("15,000 positions or 15 s per move")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Run analysis" }));
  await screen.findByRole("button", { name: "Refine estimates" });
  expect(requests[1].endgameBudgetMultiplier).toBe(10);

  const analysis = within(screen.getByLabelText("Move analysis"));
  fireEvent.change(analysis.getByRole("spinbutton", { name: "Tiles in bag" }), {
    target: { value: "1" },
  });
  expect(screen.queryByRole("spinbutton", { name: /Endgame budget/ })).toBeNull();
});

test("the first five endgame moves report progress and update Analyze with exact lines for matching settings", async () => {
  const lexicon = new Lexicon(["AT", "CAT", "CATS", "ACT", "RAT", "ART", "TAR"]);
  const analyses: AnalysisRequest[] = [];
  let background: { worker: SolverWorker; request: EndgamePrecomputeRequest } | undefined;
  let firstFive: string[] = [];
  class EndgameWorker extends SolverWorker {
    postMessage(request: SolverRequest | AnalysisRequest | EndgamePrecomputeRequest | ReplyRequest) {
      if (!("kind" in request)) {
        analyses.push(request);
        const result = analyzeMoves(lexicon, request, new Set());
        const second = result.forecasts[1];
        if (second && !request.cachedEndgames?.[second.move.id]) {
          second.endgame = null;
          second.endgameLimit = "Foreground endgame position limit reached.";
        }
        queueMicrotask(() => this.onmessage?.({ data: { result } }));
      } else if (request.kind === "reply-summary") {
        queueMicrotask(() => this.onmessage?.({
          data: { id: request.id, kind: request.kind, done: true },
        }));
      } else if (request.kind === "reply-line" || request.kind === "reply-detail") {
        return;
      } else if (request.kind === "precompute-endgames") {
        background = { worker: this, request };
      } else if (request.kind === "endgame") {
        const index = this.results.get(request.searchId)!;
        const estimate = prepareEndgameEstimate(lexicon, { ...request, bagSize: 0 });
        const ranking = index.setEndgame(
          request.id,
          new Map(index.moves.map((move) => [move.id, estimate(move, Infinity)])),
        );
        expect(ranking.checked).toBeGreaterThan(5);
        firstFive = ranking.head.slice(0, 5).map(({ id }) => id);
        queueMicrotask(() => this.onmessage?.({
          data: { kind: "endgame", id: request.id, ranking },
        }));
      } else super.postMessage(request);
    }
  }
  vi.stubGlobal("Worker", EndgameWorker);
  const user = await start();
  const base = current();
  act(() => store.update({
    ...base,
    rack: "CATS",
    template: {
      ...base.template,
      rackSize: 4,
      tileCounts: Object.fromEntries(
        TILE_SYMBOLS.map((tile) => [tile, Number("ACSTZ".includes(tile))]),
      ),
    },
  }));
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await waitFor(() => expect(background?.request.moves.map(({ id }) => id)).toEqual(firstFive));
  const { worker, request } = background!;
  const [first, second] = request.moves;
  expect(screen.getByText("Solving exact lines · 0/5 checked")).toBeTruthy();
  const spinner = document.querySelector(".calculation-indicator")!;
  expect(spinner.getAttribute("data-phase")).toBe("active");
  expect(screen.queryByRole("button", { name: /^Calculation timing/ })).toBeNull();
  const line = replyEndgameLine(lexicon, request, first, Infinity);
  act(() => worker.onmessage?.({ data: { moveId: first.id, line, elapsed: 17 } }));
  expect(screen.getByText("Solving exact lines · 1/5 checked")).toBeTruthy();
  await user.click(await screen.findByRole("button", { name: "Analyze" }));
  const rows = within(screen.getByLabelText("Suggested moves")).getAllByRole("button", { name: /points,/ });
  await user.click(rows[1]);
  await user.click(screen.getByRole("button", { name: "Run analysis" }));
  await screen.findByRole("button", { name: "Refine estimates" });
  expect(analyses[0].candidates.map(({ id }) => id)).toEqual([first.id, second.id]);
  expect(analyses[0].cachedEndgames).toEqual({ [first.id]: line });
  const cards = screen.getAllByRole("article", { name: /^Analysis for / });
  await user.click(cards[1].querySelector("summary")!);
  expect(within(cards[1]).getByText("Foreground endgame position limit reached.")).toBeTruthy();
  const secondLine = replyEndgameLine(lexicon, request, second, Infinity);
  act(() => worker.onmessage?.({ data: { moveId: second.id, line: secondLine, elapsed: 30 } }));
  expect(within(cards[1]).getByRole("table", { name: "Optimal endgame line" })).toBeTruthy();
  expect(within(cards[1]).queryByText("Foreground endgame position limit reached.")).toBeNull();

  const timeLimit = "Endgame search reached its 5,000 ms time limit.";
  act(() => {
    for (const move of request.moves.slice(2))
      worker.onmessage?.({ data: { moveId: move.id, limit: timeLimit, elapsed: 5000 } });
    worker.onmessage?.({ data: { done: true } });
  });
  const finished = screen.getByText("2/5 exact lines ready · 3 hit a limit");
  expect(finished.getAttribute("title")).toContain(timeLimit);
  await waitFor(() => expect(spinner.textContent).toBe(""));
  await user.click(await screen.findByRole("button", { name: /^Calculation timing/ }));
  const timing = within(screen.getByRole("dialog", { name: "Calculation timing" }));
  expect(timing.getByText("Endgame estimates")).toBeTruthy();
  expect(timing.getByText("Exact endgame lines")).toBeTruthy();
  const attempts = within(timing.getByRole("region", { name: "Individual endgame solves" }));
  expect(attempts.getAllByText("Limit reached", { exact: false })).toHaveLength(3);
  expect(attempts.getByText("17 ms").previousElementSibling?.textContent).toContain(first.word);
  expect(attempts.getByText("30 ms").previousElementSibling?.textContent).toContain(second.word);
  expect(attempts.getAllByText("5.00 s")).toHaveLength(3);
  await user.click(timing.getByRole("button", { name: "Close dialog" }));

  await user.selectOptions(screen.getByRole("combobox", { name: "Prior scoreless turns" }), "1");
  await user.click(screen.getByRole("button", { name: "Run analysis" }));
  await screen.findByRole("button", { name: "Refine estimates" });
  expect(analyses[1].cachedEndgames).toBeUndefined();
  await typeRack(user, "Z");
  expect(screen.queryByText(/exact lines ready/)).toBeNull();
  expect(worker.terminate).toHaveBeenCalledOnce();
});

test.each(["wordfeud", "crossplay"] as const)(
  "%s ranks empty-bag moves and passes its endgame settings to Analyze",
  async (rules) => {
    const lexicon = new Lexicon([
      "AT",
      "CAT",
      "CATS",
      "ACT",
      "DOG",
      "RAT",
      "ART",
      "TAR",
    ]);
    const ranks: Extract<SolverRequest, { kind: "endgame" }>[] = [];
    const analyses: AnalysisRequest[] = [];
    class VariantWorker extends SolverWorker {
      postMessage(request: SolverRequest | AnalysisRequest) {
        if (!("kind" in request)) {
          analyses.push(request);
          const result = analyzeMoves(lexicon, request, new Set());
          queueMicrotask(() => this.onmessage?.({ data: { result } }));
        } else if (request.kind === "endgame") {
          ranks.push(request);
          const index = this.results.get(request.searchId)!;
          const estimate = prepareEndgameEstimate(lexicon, {
            ...request,
            bagSize: 0,
          });
          const ranking = index.setEndgame(
            request.id,
            new Map(
              index.moves.map((move) => [move.id, estimate(move, Infinity)]),
            ),
          );
          queueMicrotask(() =>
            this.onmessage?.({
              data: { kind: "endgame", id: request.id, ranking },
            }),
          );
        } else super.postMessage(request);
      }
    }
    vi.stubGlobal("Worker", VariantWorker);
    const user = await start();
    const base = current();
    act(() =>
      store.update({
        ...base,
        rack: "CATS",
        template: {
          ...base.template,
          rules,
          rackSize: 4,
          tileCounts: Object.fromEntries(
            TILE_SYMBOLS.map((tile) => [tile, Number("ACSTZ".includes(tile))]),
          ),
        },
      }),
    );
    await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
    await screen.findByRole("button", {
      name: /sort by estimated endgame swing/i,
    });
    expect(ranks.at(-1)?.template.rules).toBe(rules);
    await user.click(screen.getByText("Options", { selector: "summary" }));
    await user.click(
      screen.getByText("Reply settings", { selector: "summary" }),
    );
    if (rules === "wordfeud") {
      const passes = screen.getByRole<HTMLInputElement>("spinbutton", {
        name: "Prior consecutive passes",
      });
      expect(passes.max).toBe("2");
      fireEvent.change(passes, { target: { value: "2" } });
    } else {
      await user.click(
        screen.getByRole("checkbox", { name: "Opponent has a final turn" }),
      );
    }
    await user.click(
      screen.getByRole("button", { name: "Update reply analysis" }),
    );
    await screen.findByRole("button", {
      name: /sort by estimated endgame swing/i,
    });
    await user.click(screen.getByRole("button", { name: "Analyze" }));
    await user.click(screen.getByRole("button", { name: "Run analysis" }));
    await screen.findByRole("button", { name: "Refine estimates" });
    if (rules === "wordfeud") {
      expect(ranks.at(-1)?.scorelessTurns).toBe(2);
      expect(analyses[0].scorelessTurns).toBe(2);
    } else {
      expect(ranks.at(-1)?.opponentHasFinalTurn).toBe(false);
      expect(analyses[0].opponentHasFinalTurn).toBe(false);
    }
  },
);

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

test("new game board follows the platform until the board is picked manually", async () => {
  const user = await start();
  const openSetup = async () => {
    await user.click(screen.getByRole("button", { name: "New game" }));
    return within(screen.getByRole("dialog", { name: "New game" }));
  };
  const setup = await openSetup();
  const board = setup.getByRole("combobox", { name: "Board layout" });
  const platform = setup.getByRole("combobox", { name: "Platform" });
  await user.selectOptions(platform, "Wordfeud");
  expect(board).toHaveProperty("value", "wordfeud");
  await user.selectOptions(platform, "NYT Crossplay");
  expect(board).toHaveProperty("value", "crossplay");
  await user.selectOptions(board, "super");
  await user.selectOptions(platform, "In person");
  expect(board).toHaveProperty("value", "super");
  await user.type(setup.getByRole("textbox", { name: "Opponent" }), "Preset check");
  await user.click(setup.getByRole("button", { name: "Create game" }));
  await screen.findByRole("heading", { name: "Preset check" });
  expect(remote.games.find(({ name }) => name === "Preset check")?.template.id).toBe("super");

  const next = await openSetup();
  await user.selectOptions(next.getByRole("combobox", { name: "Platform" }), "Words With Friends");
  expect(next.getByRole("combobox", { name: "Board layout" })).toHaveProperty("value", "wwf");
});

test("calculation timing waits for reply histograms and stays fixed for follow-up requests", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query !== "(max-width: 650px)",
    addEventListener() {},
    removeEventListener() {},
  }));
  type ReplySummary = Extract<ReplyRequest, { kind: "reply-summary" }>;
  type BoardOdds = Extract<SolverRequest, { kind: "board-odds" }>;
  let replies: { worker: SolverWorker; request: ReplySummary } | undefined;
  let boardOdds: { worker: SolverWorker; request: BoardOdds } | undefined;
  let detail: { worker: SolverWorker; request: ReplyRequest } | undefined;
  class DeferredReplyWorker extends SolverWorker {
    postMessage(request: SolverRequest | ReplyRequest) {
      if (request.kind === "reply-summary") replies = { worker: this, request };
      else if (request.kind === "board-odds") boardOdds = { worker: this, request };
      else if (request.kind === "reply-detail" || request.kind === "reply-line")
        detail = { worker: this, request };
      else super.postMessage(request);
    }
  }
  vi.stubGlobal("Worker", DeferredReplyWorker);
  const user = await start();
  await typeRack(user, "CATS");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await waitFor(() => expect(replies).toBeDefined());
  expect(screen.queryByRole("button", { name: /^Calculation timing/ })).toBeNull();
  const { worker, request } = replies!;
  const [candidate] = request.candidates;
  const distribution: ReplyDistribution = {
    kind: "distribution",
    count: 24,
    mean: 20,
    difference: 0,
    exact: false,
    buckets: [0, 24, 0, 0, 0],
    discordant: [0, 0, 0, 0, 0],
    reference: { mean: 20, buckets: [0, 24, 0, 0, 0] },
  };
  act(() => {
    worker.onmessage?.({
      data: { id: request.id, kind: request.kind, moveId: candidate.id, result: distribution },
    });
    worker.onmessage?.({ data: { id: request.id, kind: request.kind, done: true } });
  });
  await waitFor(() => expect(boardOdds).toBeDefined());
  expect(screen.getByText(/^Bingo 0\//)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Calculation timing/ })).toBeNull();
  act(() => {
    const { worker, request } = boardOdds!;
    worker.onmessage?.({
      data: {
        id: request.id,
        kind: request.kind,
        odds: {
          byMove: {},
          checked: request.candidates.length,
          total: request.candidates.length,
          bagSize: request.bagSize,
        },
      },
    });
  });
  const timer = await screen.findByRole("button", { name: /^Calculation timing/ });
  const total = timer.textContent;
  await user.click(timer);
  const timing = within(screen.getByRole("dialog", { name: "Calculation timing" }));
  expect(timing.getByText("Total elapsed time").nextElementSibling?.textContent).toBe(total);
  expect(timing.getByText("Board check and legal moves").nextElementSibling?.textContent).toBe("1 ms");
  expect(timing.getByText("Premium reply risk").nextElementSibling?.textContent).toBe("2 ms");
  expect(timing.getByText("Bingo draw odds").nextElementSibling?.textContent).toBe("3 ms");
  expect(timing.getByText("Bingo after your play")).toBeTruthy();
  expect(timing.getByText("Reply histograms")).toBeTruthy();
  await user.click(timing.getByRole("button", { name: "Close dialog" }));
  await user.hover(screen.getAllByRole("button", { name: /^CATS, / })[0]);
  await user.click(await screen.findByRole("button", { name: /Refine/ }));
  await waitFor(() => expect(detail).toBeDefined());
  act(() => detail!.worker.onmessage?.({
    data: { id: detail!.request.id, kind: detail!.request.kind, result: distribution },
  }));
  expect(screen.getByRole("button", { name: /^Calculation timing/ }).textContent).toBe(total);
});

test("board check uses the current filtered moves, and cancelled results stay out of the list", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query !== "(max-width: 650px)",
    addEventListener() {},
    removeEventListener() {},
  }));
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
  await user.click(screen.getByText("Options", { selector: "summary" }));
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

test.each(["narrow", "wide"])("%s results stream bingo odds after replies finish and discard odds for an older bag size", async (layout) => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: layout === "narrow" && query === "(max-width: 650px)",
    addEventListener() {},
    removeEventListener() {},
  }));
  const replies: {
    worker: SolverWorker;
    request: Extract<ReplyRequest, { kind: "reply-summary" }>;
  }[] = [];
  const checks: {
    worker: SolverWorker;
    request: Extract<SolverRequest, { kind: "board-odds" }>;
  }[] = [];
  vi.stubGlobal(
    "Worker",
    class extends SolverWorker {
      postMessage(request: SolverRequest | ReplyRequest) {
        if (request.kind === "reply-summary") {
          replies.push({ worker: this, request });
        } else if (request.kind === "board-odds") {
          checks.push({ worker: this, request });
        } else if (
          request.kind !== "reply-detail" &&
          request.kind !== "reply-line"
        ) {
          super.postMessage(request);
        }
      }
    },
  );
  const user = await start(layout === "narrow" ? 360 : 950);
  await typeRack(user, "CATS");
  await user.keyboard("{Enter}");
  await screen.findByRole("button", { name: "Sort by points" });
  const indicator = document.querySelector<HTMLElement>(".calculation-indicator");
  expect(indicator?.dataset.phase).toBe("active");
  expect(screen.queryByRole("combobox", { name: "Sort moves" })).toBeNull();
  const manualCheck = screen.queryByRole("button", {
    name: "Check bingo after your play",
  });
  if (layout === "wide") expect(manualCheck?.closest("details")?.open).toBe(false);
  else expect(manualCheck).toBeNull();
  expect(replies).toHaveLength(1);
  expect(checks).toHaveLength(0);
  function finishReplies(index: number) {
    const { worker, request } = replies[index];
    act(() =>
      worker.onmessage?.({
        data: { kind: "reply-summary", id: request.id, done: true },
      }),
    );
  }
  finishReplies(0);
  expect(checks).toHaveLength(1);
  expect(indicator?.dataset.phase).toBe("active");
  const { worker, request } = checks[0];
  expect(request.bagSize).toBe(replies[0].request.bagSize);
  expect(request.candidates).toHaveLength(20);
  expect(request.candidates[0].id).toBe(replies[0].request.reference.id);
  const update = {
    kind: "board-odds-progress",
    id: request.id,
    checked: 1,
    moveId: request.candidates[0].id,
    odds: { chance: 0.5, exact: false },
  };
  act(() => worker.onmessage?.({ data: update }));
  expect(
    screen.getByRole("button", { name: /bingo after your play ≈50%/ }),
  ).toBeTruthy();

  await user.click(screen.getByText("Options", { selector: "summary" }));
  await user.click(screen.getByText("Reply settings", { selector: "summary" }));
  const bag = screen.getByRole("spinbutton", { name: "Tiles in bag" });
  await user.type(bag, String(request.bagSize + 1));
  await user.click(screen.getByRole("button", { name: "Update reply analysis" }));
  expect(worker.terminate).toHaveBeenCalledOnce();
  act(() => worker.onmessage?.({ data: update }));
  expect(
    screen.queryByRole("button", { name: /bingo after your play ≈50%/ }),
  ).toBeNull();
  expect(replies).toHaveLength(2);
  expect(checks).toHaveLength(1);
  finishReplies(1);
  expect(checks).toHaveLength(2);
  expect(checks[1].request.bagSize).toBe(request.bagSize + 1);
});

beforeEach(() => {
  workspaceWidth = 950;
  vi.stubGlobal("ResizeObserver", WorkspaceResizeObserver);
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
      } else if (
        url.endsWith("/archive-and-start") &&
        options?.method === "POST"
      ) {
        const original = remote.games.find(
          ({ id }) => id === url.split("/").at(-2),
        )!;
        const archived = {
          ...archiveGame(original),
          revision: original.revision + 1,
        };
        const created = {
          ...newGameFromSettings(original, body.startedOn),
          id: `g${remote.games.length}`,
          revision: 0,
          updatedAt: "",
        };
        remote.games = remote.games.map((game) =>
          game.id === original.id ? archived : game,
        );
        remote.games.push(created);
        value = { archived, created };
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
        url.startsWith("/api/dictionaries/") &&
        options?.method === "DELETE"
      ) {
        const id = url.split("/").at(-1);
        if (remote.games.some((game) => game.dictionaryId === id))
          return new Response(
            JSON.stringify({
              error: "Choose a different list in that game first.",
            }),
            { status: 409 },
          );
        remote.dictionaries = remote.dictionaries.filter(
          (dictionary) => dictionary.id !== id,
        );
        value = { deleted: true };
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
async function start(width = workspaceWidth) {
  workspaceWidth = width;
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: /First game/ });
  return user;
}
const entry = () => screen.getByRole("textbox", { name: "Type on board" });
const cell = (name: string) => screen.getByRole("button", { name });
const trackedScore = () => screen.getByRole("group", { name: "Tracked score" });
const scoreTotals = (badge = trackedScore()) =>
  badge.querySelector(".game-score-totals")?.textContent;
const scoreDelta = (badge = trackedScore()) =>
  badge.querySelector(".game-score-delta");
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

test.each(["phone", "desktop"])(
  "the %s game footer shows and copies the current game's ID",
  async (layout) => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches:
        (layout === "phone" && query === "(max-width: 650px)") ||
        (layout === "desktop" && query === "(min-width: 1000px)"),
      addEventListener() {},
      removeEventListener() {},
    }));
    const user = await start();
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const footer = () =>
      within(
        screen.getByRole("main").querySelector<HTMLElement>(":scope > footer:last-child")!,
      );
    const copyButton = () =>
      footer().getByRole("button", { name: "Copy Game ID" });
    expect(footer().getByText("g", { selector: "code" })).toBeTruthy();
    await user.click(copyButton());
    expect(copy).toHaveBeenCalledExactlyOnceWith("g");
    expect(await screen.findByText("Game ID copied.")).toBeTruthy();

    remote.games.push({ ...game(), id: "second-game", name: "Second game" });
    await act(() => store.refresh());
    await user.click(screen.getByRole("button", { name: "Switch game" }));
    await user.click(screen.getByRole("menuitemradio", { name: /^Second game/ }));
    expect(
      await footer().findByText("second-game", { selector: "code" }),
    ).toBeTruthy();

    copy.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    await user.click(copyButton());
    expect(await screen.findByText("Game ID selected for copying.")).toBeTruthy();
    expect(window.getSelection()?.toString()).toBe("second-game");
    window.getSelection()?.removeAllRanges();
    copy.mockRestore();
  },
);

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

test("Enter on the board finds moves using the just-entered play and existing rack", async () => {
  const user = await start();
  await user.click(cell("H8: DW, start"));
  await user.keyboard("{Enter}");
  expect(document.activeElement).toBe(entry());
  expect(cell("Find moves")).toHaveProperty("disabled", true);

  await typeRack(user, "S");
  await user.click(cell("H8: DW, start"));
  expect(entry().getAttribute("enterkeyhint")).toBe("search");
  await user.keyboard("{Shift>}{Enter}{/Shift}");
  expect(cell("Toggle entry direction").textContent).toContain("Down");
  expect(cell("Find moves")).toHaveProperty("disabled", false);

  await user.keyboard("{ArrowRight}CAT{Enter}");
  expect(await screen.findByRole("button", { name: /^CATS, / })).toBeTruthy();
  expect(current().board.slice(112, 116)).toEqual(["C", "A", "T", ""]);
  expect(current().rack).toBe("S");
});

test("a phone keyboard’s Shift flag on Enter still finds moves on the first press", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 650px)",
    addEventListener() {},
    removeEventListener() {},
  }));
  const user = await start();
  await typeRack(user, "S");
  await user.click(cell("H8: DW, start"));
  expect(entry().getAttribute("autocapitalize")).toBe("off");
  await user.keyboard("cat");
  fireEvent.keyDown(entry(), { key: "Enter", shiftKey: true });

  expect(cell("Toggle entry direction").textContent).toContain("Across");
  expect(await screen.findByRole("button", { name: /^CATS, / })).toBeTruthy();
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
  expect(row[0].querySelector(".result-draw-odds")?.textContent).toBe("Draw 25%");
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
  ).toBe("Draw 25%");
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

test("deleting the last rack tile reveals the selected empty slot during its slide", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query !== "(prefers-reduced-motion: reduce)",
    addEventListener() {},
    removeEventListener() {},
  }));
  const original = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: () => ({ finished, cancel() {} }),
  });
  remote.games[0].rack = "CAT?DOG";
  remote.games[0].revision++;
  try {
    const user = await start();
    const last = await screen.findByRole("button", { name: "Rack tile 7: G" });
    await user.click(last);
    await user.keyboard("{Backspace}");
    expect(last.classList.contains("empty")).toBe(true);
    expect(last.classList.contains("selected")).toBe(true);
    expect(last.querySelector(".rack-slot > .rack-face.empty")).toBeTruthy();
    expect(
      last.querySelector(".rack-slot .rack-slot-window .rack-slide")
        ?.textContent,
    ).toBe("G2");
    expect(last.hasAttribute("data-rack-sliding")).toBe(true);
    await act(async () => finish());
    expect(last.querySelector(".rack-slide")).toBeNull();
    expect(last.hasAttribute("data-rack-sliding")).toBe(false);
    expect(last.classList.contains("selected")).toBe(true);
    expect(last.getAttribute("aria-label")).toBe("Rack tile 7: empty");
  } finally {
    if (original) Object.defineProperty(Element.prototype, "animate", original);
    else Reflect.deleteProperty(Element.prototype, "animate");
  }
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

test("existing games and their thumbnails use platform palettes independently of layout", async () => {
  const template = PRESETS.find(({ id }) => id === "wordfeud")!;
  const first = { ...game(), revision: 1, template, platform: "WWF" };
  remote.games = [
    first,
    { ...first, id: "club", name: "Club night", platform: "Local club" },
    {
      ...first,
      id: "archive",
      name: "Archived match",
      platform: "In person",
      archived: true,
    },
  ];
  const user = await start();
  const palette = (element: Element | null) =>
    element
      ?.closest("[data-premium-palette]")
      ?.getAttribute("data-premium-palette");
  const board = () => document.querySelector(".board-entry .board-grid");
  await waitFor(() => expect(palette(board())).toBe("words-with-friends"));
  expect(board()?.getAttribute("aria-label")).toBe("Wordfeud board");

  await user.click(screen.getByRole("button", { name: "Switch game" }));
  const picker = within(screen.getByRole("menu", { name: "Active games" }));
  expect(
    palette(
      picker
        .getByRole("menuitemradio", { name: /^First game/ })
        .querySelector("svg.board-thumbnail"),
    ),
  ).toBe("words-with-friends");
  const club = picker.getByRole("menuitemradio", { name: /^Club night/ });
  expect(palette(club.querySelector("svg.board-thumbnail"))).toBe("default");
  await user.click(club);
  await waitFor(() => expect(palette(board())).toBe("default"));

  await user.click(screen.getByRole("button", { name: "Game options" }));
  await user.click(screen.getByRole("button", { name: /^Edit game details/ }));
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Platform" }),
    "Scrabble GO",
  );
  await user.click(screen.getByRole("button", { name: "Save details" }));
  expect(palette(board())).toBe("scrabble-go");
  expect(board()?.getAttribute("aria-label")).toBe("Wordfeud board");
  await act(() => store.flush());
  expect(remote.games.find(({ id }) => id === "club")?.template).toEqual(
    template,
  );

  await user.click(screen.getByRole("button", { name: "Archived games" }));
  const archive = screen.getByRole("button", { name: /^Archived match/ });
  expect(palette(archive.querySelector("svg.board-thumbnail"))).toBe(
    "in-person",
  );
  await user.click(archive);
  await waitFor(() => expect(palette(board())).toBe("in-person"));
});

test("the board toolbar labels imported premiums and follows undo and redo", async () => {
  const template = PRESETS.find(({ id }) => id === "wordfeud")!;
  const premiums = [...template.premiums];
  premiums[0] = "DW";
  const imported = importBoard({ ...game(), template }, game().board, premiums);
  remote.games[0] = { ...imported, originalPremiums: undefined, revision: 1 };
  const user = await start();
  const name = { selector: ".board-name" };
  await screen.findByText("Wordfeud (custom)", name);
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByText("Wordfeud", name)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Redo" }));
  expect(screen.getByText("Wordfeud (custom)", name)).toBeTruthy();
});

test("new games start with score tracking on even after an earlier opt-out", async () => {
  const user = await start();
  async function createGame(name: string, trackScores: boolean) {
    await user.click(screen.getByRole("button", { name: "New game" }));
    const setup = within(screen.getByRole("dialog"));
    const tracking = setup.getByRole("checkbox", { name: "Track scores" });
    expect(tracking).toHaveProperty("checked", true);
    if (!trackScores) await user.click(tracking);
    await user.type(setup.getByRole("textbox", { name: "Opponent" }), name);
    await user.click(setup.getByRole("button", { name: "Create game" }));
    await screen.findByRole("heading", { name });
    const scores = within(screen.getByRole("region", { name: "Game scores" }));
    expect(scores.getByRole("checkbox", { name: "Track scores" })).toHaveProperty(
      "checked",
      trackScores,
    );
    expect(remote.games.find((game) => game.name === name)?.trackScores).toBe(
      trackScores,
    );
  }

  await createGame("Untracked opponent", false);
  await createGame("Tracked opponent", true);
  expect(scoreTotals()).toBe("0–0");
  expect(scoreDelta()?.textContent).toBe("0");
});

test("game options archive the current game and open a blank game with today's date", async () => {
  const original = {
    ...game(),
    revision: 1,
    platform: "Scrabble GO",
    startedOn: "2026-10-08",
    notes: "Keep these with the original game",
    trackScores: false,
  };
  original.board[112] = "A";
  remote.games[0] = original;
  const user = await start();
  await waitFor(() => expect(current().revision).toBe(1));
  await typeRack(user, "CAT");
  await user.click(cell("Game options"));
  const options = () => within(screen.getByRole("dialog"));
  expect(options().getByRole("button", { name: /^Archive game/ })).toBeTruthy();
  await user.click(
    options().getByRole("button", { name: /^Archive & start new game/ }),
  );
  await screen.findByText("Game archived. New game started.");
  expect(localStorage.getItem("tilewise:game")).toBe("g1");
  const [archived, fresh] = remote.games;
  expect(archived.archivedBoard?.[112]).toBe("A");
  expect(archived.archivedState?.rack).toBe("CAT");
  expect(archived.notes).toBe(original.notes);
  expect(fresh).toMatchObject({
    name: original.name,
    platform: original.platform,
    startedOn: localDate(),
    template: original.template,
    dictionaryId: original.dictionaryId,
    trackScores: false,
    rack: "",
    past: [],
    future: [],
  });
  expect(fresh.board.every((tile) => !tile)).toBe(true);
  expect(document.querySelector(".board-entry .square.occupied")).toBeNull();
  expect(fresh.notes).toBeUndefined();
  await user.click(cell("Archived games"));
  const archive = within(
    screen.getByRole("region", { name: "Archived games" }),
  );
  await user.click(archive.getByRole("button", { name: /^First game/ }));
  await user.click(cell("Game options"));
  expect(
    options().getByRole("button", { name: /^Move to My games/ }),
  ).toBeTruthy();
  expect(
    options().queryByRole("button", { name: /^Archive & start new game/ }),
  ).toBeNull();
});

test("multiple games retain separate racks and word lists", async () => {
  remote.dictionaries.push({
    ...remote.dictionaries[0],
    id: "other",
    name: "Other words",
  });
  const user = await start();
  await typeRack(user, "CAT");
  await user.click(screen.getByRole("button", { name: "New game" }));
  await user.type(
    screen.getByRole("textbox", { name: "Opponent" }),
    "Second game",
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Platform" }),
    "Scrabble GO",
  );
  await user.click(screen.getByRole("button", { name: "Create game" }));
  await screen.findByRole("heading", { name: /Second game/ });
  expect(
    store.snapshot.data!.games.find((g) => g.name === "Second game")!.platform,
  ).toBe("Scrabble GO");
  expect(
    store.snapshot.data!.games.find((g) => g.name === "Second game")!.startedOn,
  ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await typeRack(user, "DOG");
  const dictionary = () =>
    screen.getByRole<HTMLSelectElement>("combobox", { name: "Game dictionary" });
  await user.selectOptions(dictionary(), "other");
  await act(() => store.flush());
  await user.click(cell("Switch game"));
  await user.click(screen.getByRole("menuitemradio", { name: /^First game/ }));
  expect(current().rack).toBe("CAT");
  expect(dictionary().value).toBe("test");
  expect(remote.games.find((g) => g.name === "Second game")?.dictionaryId).toBe(
    "other",
  );
  await user.click(screen.getByRole("button", { name: "dark theme" }));
  expect(localStorage.getItem("tilewise:theme")).toBe("dark");
  expect(
    Object.values(store.snapshot.games).find((g) => g.name === "Second game")!
      .rack,
  ).toBe("DOG");
  await user.click(cell("Switch game"));
  await user.click(screen.getByRole("menuitemradio", { name: /^Second game/ }));
  expect(dictionary().value).toBe("other");
});

test("archive rows show saved tracked scores and outcome colors from summaries", async () => {
  const player = (points: number) => ({ points, moves: 1, best: points, bingos: 0 });
  const scoring = { you: player(300), opponent: player(280) };
  const finished = archiveGame({
    ...game(),
    id: "finished",
    name: "Finished opponent",
    scoring: { ...scoring, end: { out: "you", rackPoints: 4 } },
  });
  remote.games.push(
    { ...finished, scoring: { ...scoring, you: player(350) } },
    { ...game(), id: "unfinished", name: "Unfinished opponent", archived: true, scoring },
    { ...game(), id: "untracked", name: "Untracked opponent", archived: true, trackScores: false },
  );
  const user = await start();
  await act(() => store.refresh());
  await user.click(cell("Archived games"));
  const archive = within(screen.getByRole("region", { name: "Archived games" }));
  const row = (name: string) => archive.getByRole("button", { name: new RegExp(`^${name}`) });
  const badge = (name: string) => within(row(name)).getByRole("group", { name: "Tracked score" });
  expect(badge("Finished opponent").textContent).toBe("304–276");
  expect(badge("Finished opponent").getAttribute("data-outcome")).toBe("win");
  expect(row("Finished opponent").getAttribute("aria-description")).toContain("You won");
  expect(badge("Unfinished opponent").textContent).toBe("300–280");
  expect(badge("Unfinished opponent").getAttribute("data-outcome")).toBe("archived");
  expect(within(row("Untracked opponent")).queryByRole("group", { name: "Tracked score" })).toBeNull();
  expect(store.getSnapshot().games.finished).toBeUndefined();
  await user.click(row("Finished opponent"));
  await screen.findByRole("heading", { name: "Finished opponent" });
  await waitFor(() => expect(scoreTotals()).toBe("304–276"));
  expect(scoreDelta()?.textContent).toBe("+28");
  expect(scoreDelta()?.className).toBe("game-score-delta");
});

test("archived games filter by opponent while honoring the selected sort", async () => {
  remote.games.push(
    {
      ...game(),
      id: "recent",
      name: "Sam Cooke",
      archived: true,
      startedOn: "2026-05-12",
    },
    {
      ...game(),
      id: "older",
      name: "Alex Sampson",
      archived: true,
      startedOn: "2026-04-20",
    },
    {
      ...game(),
      id: "other",
      name: "Morgan",
      platform: "Sam",
      archived: true,
      startedOn: "2026-06-01",
    },
  );
  const user = await start();
  await act(() => store.refresh());
  await user.click(cell("Archived games"));
  const archive = within(screen.getByRole("region", { name: "Archived games" }));
  const search = archive.getByRole("searchbox", { name: "Filter by opponent" });
  const sort = archive.getByRole("combobox", { name: "Sort by" });
  const count = archive.getByRole("status", { name: "Archived game count" });
  const names = () =>
    archive
      .queryAllByRole("listitem")
      .map((row) => row.querySelector("strong")?.textContent);

  expect(count.textContent).toBe("3");
  await user.type(search, " sAm ");
  expect(names()).toEqual(["Sam Cooke", "Alex Sampson"]);
  expect(count.textContent).toBe("2 / 3");
  await user.selectOptions(sort, "opponent");
  expect(names()).toEqual(["Alex Sampson", "Sam Cooke"]);
  expect(search).toHaveProperty("value", " sAm ");
  await user.type(search, "Z");
  expect(names()).toHaveLength(0);
  expect(count.textContent).toBe("0 / 3");
  expect(archive.getByText("No matching games.")).toBeTruthy();
  await user.clear(search);
  expect(names()).toEqual(["Alex Sampson", "Morgan", "Sam Cooke"]);
  expect(count.textContent).toBe("3");
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
  await user.selectOptions(
    edit.getByRole("combobox", { name: "Platform" }),
    "other",
  );
  await user.type(
    edit.getByRole("textbox", { name: "Custom platform" }),
    "Club night",
  );
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
    archived().getByRole("button", { name: "Edit game with Sam" }),
  );
  const reopened = within(await screen.findByRole("dialog"));
  const platformPicker = await reopened.findByRole("combobox", {
    name: "Platform",
  });
  const customPlatform = () =>
    reopened.getByRole("textbox", { name: "Custom platform" });
  expect(platformPicker).toHaveProperty("value", "other");
  expect(customPlatform()).toHaveProperty("value", "Club night");
  await user.selectOptions(platformPicker, "Wordfeud");
  expect(reopened.queryByRole("textbox", { name: "Custom platform" })).toBeNull();
  await user.selectOptions(platformPicker, "other");
  expect(customPlatform()).toHaveProperty("value", "Club night");
  await user.click(reopened.getByRole("button", { name: "Close dialog" }));
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
  "the word list is in the game metadata on the %s layout",
  async (layout) => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(max-width: 650px)" && layout === "phone",
      addEventListener() {},
      removeEventListener() {},
    }));
    await start(layout === "phone" ? 360 : 950);
    const scores = screen.getByRole("region", { name: "Game scores" });
    const moves = screen.getByRole("heading", { name: "Possible moves" });
    const dictionary = screen.getByRole("combobox", {
      name: "Game dictionary",
    });
    expect(moves.compareDocumentPosition(scores)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(dictionary.closest(".game-title-meta")).toBeTruthy();
    expect(dictionary.compareDocumentPosition(scores)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(moves.compareDocumentPosition(dictionary)).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );
  },
);

test("word lists confirm removal, display a conflict and update the game selector", async () => {
  remote.dictionaries.push({
    id: "house",
    name: "House words",
    count: 4,
    builtin: false,
    description: "Imported word list",
  });
  const user = await start();
  const picker = screen.getByRole("combobox", { name: "Game dictionary" });
  await screen.findByRole("option", { name: "House words" });
  await user.selectOptions(picker, "house");
  await waitFor(() => expect(remote.games[0].dictionaryId).toBe("house"));
  const wordLists = screen.getByRole("button", { name: "About word lists" });
  await user.click(wordLists);
  expect(screen.queryByRole("button", { name: "Remove Test words" })).toBeNull();
  const remove = () =>
    user.click(screen.getByRole("button", { name: "Remove House words" }));
  const confirm = () =>
    user.click(screen.getByRole("button", { name: "Remove word list" }));
  await remove();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Keep word list" }),
  );
  await user.click(screen.getByRole("button", { name: "Keep word list" }));
  expect(remote.dictionaries).toHaveLength(2);

  await remove();
  await confirm();
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Choose a different list",
  );
  await user.click(screen.getByRole("button", { name: "Keep word list" }));
  await user.click(screen.getByRole("button", { name: "Close dialog" }));
  await user.selectOptions(picker, "test");
  await waitFor(() => expect(remote.games[0].dictionaryId).toBe("test"));
  await user.click(wordLists);
  await remove();
  await confirm();
  expect(await screen.findByText("House words removed.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Remove House words" })).toBeNull();
  expect(screen.queryByRole("option", { name: "House words" })).toBeNull();
  expect((picker as HTMLSelectElement).value).toBe("test");
});

test.each([1320, 760, 390])("the sidebar collapses and reopens at %ipx", async (width) => {
  const overlay = width <= 800;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches:
      (query === "(max-width: 800px)" && overlay) ||
      (query === "(max-width: 650px)" && width <= 650),
    addEventListener() {},
    removeEventListener() {},
  }));
  const user = await start(width === 1320 ? 1050 : width - 30);
  const sidebar = () => screen.queryByRole("complementary", { name: "Sidebar" });
  const open = () => screen.getByRole("button", { name: "Open sidebar" });
  const collapse = () => within(sidebar()!).getByRole("button", { name: "Collapse sidebar" });
  if (overlay) {
    expect(sidebar()).toBeNull();
    await user.click(open());
    expect(open().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(collapse());
  }
  expect(collapse().querySelector(".lucide-menu")).toBeTruthy();
  await user.click(collapse());
  expect(sidebar()).toBeNull();
  expect(document.activeElement).toBe(open());
  expect(open().getAttribute("aria-expanded")).toBe("false");
  await user.keyboard("{Enter}");
  expect(sidebar()?.id).toBe("tilemaxx-sidebar");
  expect(document.activeElement).toBe(collapse());
  if (overlay) {
    await user.keyboard("{Escape}");
    expect(sidebar()).toBeNull();
    expect(document.activeElement).toBe(open());
  }
});

test("the same game header and score history follow available workspace width", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const user = await start(690);
  const header = screen.getByRole("heading", { name: "First game" }).closest("header");
  const scores = screen.getByRole("region", { name: "Game scores" });
  const history = within(scores).getByText("Tracked move history");
  await user.click(history);
  const shell = header?.closest(".app-shell");
  expect(shell?.classList.contains("stacked-game")).toBe(true);
  expect(header?.querySelector(".board-toolbar")).toBeNull();
  await user.click(cell("Collapse sidebar"));
  act(() => resizeWorkspace(720));
  const open = within(header!).getByRole("button", { name: "Open sidebar" });
  expect(open.querySelector(".lucide-menu")).toBeTruthy();
  expect(shell?.classList.contains("compact-game")).toBe(true);
  expect(header?.querySelector(".board-toolbar")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Game scores" })).toBe(scores);
  expect(history.closest("details")?.open).toBe(true);
  await user.click(open);
  act(() => resizeWorkspace(719));
  expect(shell?.classList.contains("stacked-game")).toBe(true);
  expect(document.querySelector(".breadcrumb, .topbar")).toBeNull();
});

test.each([false, true])("the sidebar opens the illustrated guide (phone %s)", async (phone) => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: phone ? ["(max-width: 650px)", "(max-width: 800px)"].includes(query) : query === "(min-width: 1000px)",
    addEventListener() {},
    removeEventListener() {},
  }));
  const user = await start(phone ? 360 : 950);
  if (phone)
    await user.click(screen.getByRole("button", { name: "Open sidebar" }));
  const menu = within(screen.getByRole("complementary", { name: "Sidebar" }));
  await user.click(menu.getByRole("button", { name: "UI guide" }));

  const guide = within(screen.getByRole("dialog", { name: "UI guide" }));
  expect(guide.getByRole("img").getAttribute("alt")).toMatch(
    phone ? /selected JILT/ : /sidebar, board, rack/,
  );
  await user.click(guide.getByRole("button", { name: "Possible moves" }));
  expect(guide.getByRole("img", { name: /Reply after JANTY/ })).toBeTruthy();
  expect(guide.getByText("Reply details")).toBeTruthy();
  await user.click(guide.getByRole("button", { name: "Enlarge image" }));
  expect(guide.getByRole("region", { name: /enlarged/ })).toBeTruthy();
  await user.click(guide.getByRole("button", { name: "Fit image" }));

  const search = guide.getByRole("searchbox", { name: "Find a UI name" });
  await user.type(search, "preview bar");
  expect(guide.getByText("preview bar")).toBeTruthy();
  expect(guide.queryByRole("img")).toBeNull();
  await user.clear(search);
  await user.type(search, "unmatched name");
  expect(guide.getByRole("status").textContent).toBe("No matching UI names.");
  await user.click(guide.getByRole("button", { name: "All names" }));
  expect(guide.getByText("Screenshot import", { exact: true })).toBeTruthy();
  await user.click(guide.getByRole("button", { name: "Close dialog" }));
  expect(screen.queryByRole("dialog", { name: "UI guide" })).toBeNull();
});

test("the phone layout keeps settings, the build version, board help and move filtering accessible", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: ["(max-width: 650px)", "(max-width: 800px)"].includes(query),
    addEventListener() {},
    removeEventListener() {},
  }));
  const user = await start(360);
  const main = within(screen.getByRole("main"));
  const menu = main.getByRole("button", { name: "Open sidebar" });
  expect(menu.closest(".game-heading")).toBeTruthy();
  expect(document.querySelector(".breadcrumb")).toBeNull();
  expect(main.queryByRole("button", { name: "dark theme" })).toBeNull();
  await user.click(menu);
  const sidebar = within(screen.getByRole("complementary"));
  const theme = sidebar.getByRole("group", { name: "Color theme" });
  const settingsButton = sidebar.getByRole("button", { name: "Settings" });
  expect(settingsButton.textContent).toBe("");
  expect(settingsButton.parentElement).toBe(theme.nextElementSibling);
  expect(settingsButton.nextElementSibling).toBe(sidebar.getByText(`v${version}`));
  await user.click(within(theme).getByRole("button", { name: "dark theme" }));
  expect(document.documentElement.dataset.theme).toBe("dark");
  await user.click(sidebar.getByRole("button", { name: "My games" }));

  expect(document.querySelector(".board-toolbar")).toBeNull();
  const score = main.getByRole("group", { name: "Tracked score" });
  expect(score.closest(".game-heading")).toBeTruthy();
  expect(score.getAttribute("data-outcome")).toBe("playing");
  const options = main.getByRole("button", { name: "Game options" });
  const dialog = () => within(screen.getByRole("dialog"));
  const close = () => user.click(dialog().getByRole("button", { name: "Close dialog" }));
  for (const [label, heading] of [
    ["Board help", "Board help"],
    ["Move history", "Your moves, remembered."],
    ["Import screenshot", "Import a screenshot"],
  ]) {
    expect(main.queryByRole("button", { name: label })).toBeNull();
    await user.click(options);
    await user.click(dialog().getByRole("button", { name: label }));
    expect(dialog().getByRole("heading", { name: heading })).toBeTruthy();
    if (label === "Board help") {
      expect(dialog().getByText("Triple word")).toBeTruthy();
      expect(dialog().getByText("Scrabble · 15 × 15")).toBeTruthy();
    }
    await close();
  }
  const undo = main.getByRole("button", { name: "Undo" });
  const redo = main.getByRole("button", { name: "Redo" });
  const entryTools = undo.closest(".direct-entry-actions");
  expect(main.getByText("Tap a square and type").closest(".direct-entry-tools")).toBeTruthy();
  expect(entryTools?.contains(redo)).toBe(true);
  expect(entryTools?.contains(main.getByRole("button", { name: "Toggle entry direction" }))).toBe(true);
  expect(entryTools?.contains(main.getByRole("button", { name: "Blank tile: off" }))).toBe(true);
  await user.click(cell("H8: DW, start"));
  await user.keyboard("C");
  expect(main.getByText("I8 · Type to enter")).toBeTruthy();
  await user.click(undo);
  expect(current().board[112]).toBe("");
  await user.click(redo);
  expect(current().board[112]).toBe("C");
  await user.click(undo);

  const rack = within(screen.getByRole("region", { name: "Your rack" }));
  const findMoves = main.getByRole("button", { name: "Find moves" });
  expect(rack.queryByRole("heading", { name: "Your rack" })).toBeNull();
  expect(rack.queryByRole("button", { name: "Find moves" })).toBeNull();
  expect(rack.getByText("Rack tools")).toBeTruthy();
  expect(findMoves.hasAttribute("disabled")).toBe(true);
  await typeRack(user, "CAT");
  await user.click(findMoves);
  await screen.findAllByRole("button", { name: /^CAT, / });
  expect(main.queryByRole("textbox", { name: "Filter moves" })).toBeNull();
  await user.click(main.getByRole("button", { name: "Search possible moves" }));
  const filter = main.getByRole("textbox", { name: "Filter moves" });
  expect(document.activeElement).toBe(filter);
  await user.type(filter, "CAT");
  expect(main.queryByRole("button", { name: /^ACT, / })).toBeNull();
  await user.keyboard("{Escape}");
  expect(main.queryByRole("textbox", { name: "Filter moves" })).toBeNull();
  expect(main.getByRole("button", { name: "Undo" }).closest(".board-review-actions")).toBeTruthy();
  await user.click(main.getByRole("button", { name: "Filter moves by squares" }));
  const markControls = main.getByRole("button", { name: "Done" }).closest(".move-square-controls");
  expect(markControls?.contains(main.getByRole("button", { name: "Undo" }))).toBe(true);
  const redoWhileMarking = main.getByRole("button", { name: "Redo" });
  expect(markControls?.contains(redoWhileMarking)).toBe(true);
  await user.click(redoWhileMarking);
  expect(current().board[112]).toBe("C");
});

test("entering the opponent's final tile updates the score and ends the game on the phone", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 650px)",
    addEventListener() {},
    removeEventListener() {},
  }));
  const fixture = remote.games[0];
  fixture.revision = 1;
  fixture.board.splice(112, 3, "C", "A", "T");
  fixture.rack = "Q";
  fixture.scoring = {
    you: { points: 20, moves: 1, best: 20, bingos: 0 },
    opponent: { points: 10, moves: 1, best: 10, bingos: 0 },
  };
  fixture.template.tileCounts = Object.fromEntries(
    TILE_SYMBOLS.map((symbol) => [symbol, Number("ACQST".includes(symbol))]),
  );
  const user = await start();
  await waitFor(() => expect(scoreTotals()).toBe("20–10"));
  expect(trackedScore().getAttribute("data-outcome")).toBe("playing");
  expect(trackedScore().classList.contains("value-good")).toBe(false);
  expect(scoreDelta()?.textContent).toBe("+10");
  expect(scoreDelta()?.classList.contains("value-good")).toBe(true);
  expect(screen.getByText("Lead by 10").classList.contains("value-good")).toBe(true);
  await user.click(cell("K8: empty"));
  await user.keyboard("S");
  expect(scoreTotals()).toBe("10–26");
  expect(trackedScore().getAttribute("data-outcome")).toBe("loss");
  expect(trackedScore().classList.contains("value-bad")).toBe(true);
  expect(scoreDelta()?.textContent).toBe("−16");
  expect(scoreDelta()?.className).toBe("game-score-delta");
  expect(screen.getByRole("heading", { name: "Game over" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Find moves" })).toBeNull();
  expect(current().trackedMoves?.at(-1)).toMatchObject({ word: "CATS", player: "opponent", score: 6 });
  await act(() => store.flush());
  expect(remote.games[0].scoring?.end).toEqual({ out: "opponent", rackPoints: 10 });
  await user.click(cell("Undo"));
  expect(current().board[115]).toBe("");
  expect(scoreTotals()).toBe("20–10");
  expect(trackedScore().getAttribute("data-outcome")).toBe("playing");
  expect(scoreDelta()?.textContent).toBe("+10");
  await user.click(cell("Redo"));
  expect(scoreTotals()).toBe("10–26");
  expect(trackedScore().getAttribute("data-outcome")).toBe("loss");
  expect(scoreDelta()?.textContent).toBe("−16");
});

test("end game defaults to deductions and archiving with both settings reversible", async () => {
  const fixture = remote.games[0];
  fixture.revision = 1;
  fixture.board.splice(112, 3, "C", "A", "T");
  fixture.rack = "Q";
  fixture.scoring = {
    you: { points: 30, moves: 1, best: 30, bingos: 0 },
    opponent: { points: 24, moves: 1, best: 24, bingos: 0 },
  };
  fixture.template.tileCounts = Object.fromEntries(
    TILE_SYMBOLS.map((tile) => [tile, Number("ACQST".includes(tile))]),
  );
  const user = await start();
  await waitFor(() => expect(scoreTotals()).toBe("30–24"));
  async function openEndGame() {
    await user.click(cell("Game options"));
    await user.click(screen.getByRole("button", { name: /^End game/ }));
    return within(screen.getByRole("dialog"));
  }
  const dialog = await openEndGame();
  const deductions = dialog.getByRole("checkbox", {
    name: "Deduct unplayed tiles",
  });
  const archive = dialog.getByRole("checkbox", { name: "Archive game" });
  expect(deductions).toHaveProperty("checked", true);
  expect(archive).toHaveProperty("checked", true);
  expect(dialog.getByText("Final score 20–23")).toBeTruthy();
  await user.click(deductions);
  expect(
    dialog.getByRole("spinbutton", { name: "Your final score" }),
  ).toHaveProperty("value", "30");
  expect(
    dialog.getByRole("spinbutton", { name: "Opponent’s final score" }),
  ).toHaveProperty("value", "24");
  await user.click(deductions);
  expect(dialog.getByText("Final score 20–23")).toBeTruthy();
  await user.click(archive);
  await user.selectOptions(
    dialog.getByRole("combobox", { name: "Result" }),
    "win",
  );
  await user.click(dialog.getByRole("button", { name: "End game" }));
  expect(screen.getByRole("heading", { name: "Game over" })).toBeTruthy();
  expect(trackedScore().getAttribute("data-outcome")).toBe("win");
  expect(scoreTotals()).toBe("20–23");
  await act(() => store.flush());
  expect(remote.games[0].scoring?.end).toEqual({
    manual: true,
    scores: { you: 20, opponent: 23 },
    outcome: "win",
  });
  expect(remote.games[0].archived).toBe(false);
  await user.click(cell("Undo"));
  expect(scoreTotals()).toBe("30–24");
  expect(screen.getByRole("button", { name: "Find moves" })).toBeTruthy();

  const reopened = await openEndGame();
  expect(
    reopened.getByRole("checkbox", { name: "Archive game" }),
  ).toHaveProperty("checked", true);
  await user.click(
    reopened.getByRole("checkbox", { name: "Deduct unplayed tiles" }),
  );
  await user.click(reopened.getByRole("button", { name: "End game" }));
  expect(screen.getByText("Game ended and archived.")).toBeTruthy();
  await act(() => store.flush());
  expect(remote.games[0]).toMatchObject({
    archived: true,
    archivedState: {
      scoring: { end: { manual: true, scores: { you: 30, opponent: 24 } } },
    },
  });
});

test.each([
  ["scrabble", "Available when the bag is empty."],
  ["crossplay", "Crossplay doesn’t deduct unplayed tiles."],
] as const)(
  "end game shows unavailable %s deductions as disabled",
  async (rules, note) => {
    const fixture = remote.games[0];
    fixture.revision = 1;
    fixture.template.rules = rules;
    fixture.board.splice(112, 3, "C", "A", "T");
    fixture.rack = "Q";
    const user = await start();
    await user.click(cell("Game options"));
    await user.click(screen.getByRole("button", { name: /^End game/ }));

    const dialog = within(screen.getByRole("dialog"));
    const deductions = dialog.getByRole("checkbox", {
      name: "Deduct unplayed tiles",
      description: note,
    });
    expect(deductions).toHaveProperty("disabled", true);
    await user.click(deductions);
    expect(deductions).toHaveProperty("checked", false);
    expect(dialog.getByRole("checkbox", { name: "Archive game" })).toHaveProperty(
      "checked",
      true,
    );
  },
);

test("phone rack entry reveals the tiles above the keyboard and restores the page when it closes", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 650px)",
    addEventListener() {},
    removeEventListener() {},
  }));
  const viewport = Object.assign(new EventTarget(), {
    height: 760,
    width: 390,
    offsetTop: 0,
    scale: 1,
  });
  vi.stubGlobal("visualViewport", viewport);
  let scrollY = 120;
  vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrollY);
  const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation((args) => {
    scrollY += (args as ScrollToOptions).top!;
  });
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation((args) => {
    scrollY = (args as ScrollToOptions).top!;
  });

  const user = await start();
  const rack = screen.getByRole("group", { name: "Your rack tiles" });
  vi.spyOn(rack, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(28, 640 - scrollY, 334, 52),
  );
  function resize(height: number, offsetTop = 0) {
    viewport.height = height;
    viewport.offsetTop = offsetTop;
    viewport.dispatchEvent(new Event("resize"));
  }

  await typeRack(user, "CA");
  const input = screen.getByRole("textbox", { name: "Rack letters" });
  expect(input.getAttribute("enterkeyhint")).toBe("search");
  resize(350, 40);
  await waitFor(() => expect(scrollY).toBe(310));
  expect(document.activeElement).toBe(input);

  viewport.offsetTop = 20;
  viewport.dispatchEvent(new Event("scroll"));
  await waitFor(() => expect(scrollY).toBe(330));
  resize(760);
  await waitFor(() =>
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({
      top: 120,
      behavior: "instant",
    }),
  );

  resize(350, 40);
  await waitFor(() => expect(scrollY).toBe(310));
  fireEvent.touchMove(window);
  scrollY = 280;
  resize(760);
  await act(
    () => new Promise<void>((done) => requestAnimationFrame(() => done())),
  );
  expect(scrollTo).toHaveBeenCalledTimes(1);
  expect(scrollY).toBe(280);

  resize(350, 40);
  await waitFor(() => expect(scrollBy).toHaveBeenCalledTimes(4));
  await user.keyboard("T{Enter}");
  await screen.findAllByRole("button", { name: /^CAT, / });
  expect(document.activeElement).not.toBe(input);
  resize(760);
  await act(
    () => new Promise<void>((done) => requestAnimationFrame(() => done())),
  );
  expect(scrollTo).toHaveBeenCalledTimes(1);
  expect(rack.closest(".phone-move-review")).toBeTruthy();
});

test("phone results preview on the game board and tapping the side rack resumes editing", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 650px)",
    addEventListener() {},
    removeEventListener() {},
  }));
  const user = await start();
  const board = document.querySelector(".board-entry")!;
  const workspace = board.closest(".workspace-grid")!;
  const reviewing = () => workspace.classList.contains("phone-move-review");
  const ghosts = () => board.querySelectorAll(".ghost");
  expect(reviewing()).toBe(false);
  await typeRack(user, "CATS");
  await user.keyboard("{Enter}");
  const row = (await screen.findAllByRole("button", { name: /^CATS, / }))[0];
  expect(reviewing()).toBe(true);
  expect(ghosts()).toHaveLength(0);

  await user.click(row);
  expect(ghosts()).toHaveLength(4);
  expect(document.querySelectorAll(".board-grid")).toHaveLength(1);
  expect(
    screen.getByRole("button", { name: "Play" }).hasAttribute("disabled"),
  ).toBe(false);
  expect(current().board.some(Boolean)).toBe(false);

  await user.click(rackTile(2));
  expect(reviewing()).toBe(false);
  expect(ghosts()).toHaveLength(0);
  expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("textbox", { name: "Rack letters" }),
  );
  expect(current().rack).toBe("CATS");

  await user.keyboard("{Enter}");
  expect(reviewing()).toBe(true);
  await user.click(rackTile(2));
  expect(reviewing()).toBe(false);
  await user.click(row);
  expect(reviewing()).toBe(true);
  expect(ghosts()).toHaveLength(4);
  expect(current().board.some(Boolean)).toBe(false);
  await user.click(screen.getByRole("button", { name: "Play" }));
  expect(current().board.filter(Boolean)).toHaveLength(4);
  expect(reviewing()).toBe(false);
  expect(ghosts()).toHaveLength(0);

  await typeRack(user, "QXZ");
  await user.keyboard("{Enter}");
  await screen.findByRole("heading", { name: "No legal moves found" });
  expect(reviewing()).toBe(false);
});

test.each(["phone", "desktop"])("%s square selection filters moves without editing the board", async (layout) => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === (layout === "phone" ? "(max-width: 650px)" : "(min-width: 1000px)"),
    addEventListener() {},
    removeEventListener() {},
  }));
  const user = await start();
  await typeRack(user, "CATS");
  await user.keyboard("{Enter}");
  const catRows = () => screen.findAllByRole("button", { name: /^CAT, / });
  const original = await catRows();
  expect(original.some((row) => /down/.test(row.getAttribute("aria-label")!))).toBe(true);
  const filter = () => screen.getByRole("button", { name: "Filter moves by squares" });
  await user.click(filter());
  expect(document.activeElement).toBe(cell("H8: DW, start"));
  await user.keyboard("{Enter}");
  await user.click(cell("I8: empty"));
  expect(cell("I8: empty").getAttribute("aria-pressed")).toBe("true");
  expect((await catRows()).every((row) => /across/.test(row.getAttribute("aria-label")!))).toBe(true);
  expect(current().board.every((letter) => !letter)).toBe(true);
  expect((entry() as HTMLInputElement).disabled).toBe(true);

  const diagonal = screen.getByRole("button", { name: /^I9:/ });
  await user.click(diagonal);
  expect(await screen.findByRole("heading", { name: "No matching words" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "Analyze" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(diagonal);
  const [match] = await catRows();
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(filter().getAttribute("aria-pressed")).toBe("false");
  await act(() => match.focus());
  expect(document.querySelector('.board-entry [data-cell="113"].ghost.move-filter-square')).toBeTruthy();

  await user.click(filter());
  await user.click(screen.getByRole("button", { name: "Clear" }));
  expect(await catRows()).toHaveLength(original.length);
  await user.click(cell("I8: empty"));
  await user.keyboard("{Escape}");
  expect(filter().getAttribute("aria-pressed")).toBe("false");
  await user.click(cell("H8: DW, start"));
  await user.keyboard("A");
  expect(current().board[112]).toBe("A");
  expect(document.querySelector(".board-entry .move-filter-square")).toBeNull();
});

test("score tracking records typed opponent moves and solver plays across undo, redo and saving", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(min-width: 1000px)" || query === "(any-hover: hover)",
    addEventListener() {},
    removeEventListener() {},
  }));
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
  expect(scoreTotals()).toBe("0–0");
  expect(scoreDelta()?.textContent).toBe("0");
  const heading = cell("Game options").closest(".game-heading");
  expect(heading?.contains(titleScore())).toBe(true);
  expect(titleScore()?.closest(".game-title-row, .board-toolbar")).toBeNull();
  const boardStrip = cell("Undo").closest(".board-panel .direct-entry-tools");
  expect(boardStrip?.contains(cell("Redo"))).toBe(true);
  expect(boardStrip?.contains(cell("Toggle entry direction"))).toBe(true);
  expect(boardStrip?.textContent).toContain("Tap a square and type");
  expect(heading?.querySelector(".board-undo, .board-redo")).toBeNull();

  await user.click(cell("H8: DW, start"));
  await user.keyboard("CAQ{Backspace}T");
  expect(current().scoring?.opponent.moves).toBe(0);
  expect(scores().getByText("CAT · 10 pts")).toBeTruthy();
  await typeRack(user, "S");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await user.click(await screen.findByRole("button", { name: /^CATS, / }));
  expect(current().past.map(({ label }) => label)).toEqual(["CAT", "CATS"]);
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
  expect(scoreTotals()).toBe("6–10");
  expect(scoreDelta()?.textContent).toBe("−4");
  expect(scoreDelta()?.classList.contains("value-bad")).toBe(true);
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
  expect(scoreTotals()).toBe("0–10");
  expect(current().board.slice(112, 116)).toEqual(["C", "A", "T", ""]);
  expect(moves().getAllByRole("row").slice(1)).toHaveLength(1);
  await user.click(cell("Undo"));
  expect(current().board.every((tile) => !tile)).toBe(true);
  expect(scoreTotals()).toBe("0–0");
  expect(scores().queryByText("CAT · 10 pts")).toBeNull();
  await user.click(cell("Redo"));
  expect(current().board.slice(112, 116)).toEqual(["C", "A", "T", ""]);
  expect(scoreTotals()).toBe("0–10");
  await user.click(cell("Redo"));
  expect(current().board.slice(112, 116)).toEqual(["C", "A", "T", "S"]);
  expect(scoreTotals()).toBe("6–10");
  await user.click(tracking());
  expect(tracking().checked).toBe(false);
  expect(titleScore()).toBeNull();
  expect(moves().getAllByRole("row").slice(1)).toHaveLength(2);
  await store.flush();
  expect(remote.games[0].trackScores).toBe(false);
  expect(remote.games[0].scoring?.you.points).toBe(6);
});

test("two opponent plays entered before a reply both make it into the score history", async () => {
  const user = await start();
  const scores = within(screen.getByRole("region", { name: "Game scores" }));
  await user.click(cell("H8: DW, start"));
  await user.keyboard("CAT");
  await user.click(cell("I9: DL"));
  await user.keyboard("T");
  expect(scores.getByRole("button", { name: "Record opponent moves" })).toBeTruthy();
  await typeRack(user, "S");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await user.click(await screen.findByRole("button", { name: /^CATS, / }));
  expect(scoreTotals()).toBe("6–13");
  expect(current().trackedMoves?.map(({ player, word }) => [player, word])).toEqual([
    ["opponent", "CAT"],
    ["opponent", "AT"],
    ["you", "CATS"],
  ]);
  await user.click(cell("Undo"));
  expect(scoreTotals()).toBe("0–13");
  await user.click(cell("Undo"));
  expect(scoreTotals()).toBe("0–10");
  expect(cell("I9: DL")).toBeTruthy();
  await user.click(cell("Redo"));
  expect(scoreTotals()).toBe("0–13");
});

test("the board blank control corrects recorded scores and saves with undo and redo", async () => {
  const user = await start();
  const scores = within(screen.getByRole("region", { name: "Game scores" }));
  await user.click(cell("H8: DW, start"));
  await user.keyboard("CAT");
  await typeRack(user, "S");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await user.click(await screen.findByRole("button", { name: /^CATS, / }));
  expect(scoreTotals()).toBe("6–10");
  await user.click(scores.getByText("Tracked move history"));
  const points = () => within(scores.getByRole("table", { name: "Tracked moves" }))
    .getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[2].textContent);
  await user.click(cell("H8: C, start"));
  await user.click(cell("Blank tile: off"));
  expect(cell("H8: C blank, start")).toBeTruthy();
  expect(scoreTotals()).toBe("3–4");
  expect(points()).toEqual(["3", "4"]);
  expect(scores.queryByRole("button", { name: "Keep as correction" })).toBeNull();
  await user.click(cell("Undo"));
  expect(scoreTotals()).toBe("6–10");
  expect(points()).toEqual(["6", "10"]);
  await user.click(cell("Redo"));
  expect(scoreTotals()).toBe("3–4");
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
  await user.keyboard("{Enter}");
  expect(running!.terminate).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Cancel search" })).toBeTruthy();
  await user.click(rackTile(1));
  await user.keyboard("{Control>}a{/Control}{Backspace}");
  expect(running!.terminate).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Cancel search" })).toBeNull();
  await typeRack(user, "CAT");
  expect(current().rack).toBe("CAT");
  await user.click(screen.getByRole("button", { name: "Find moves" }));
  await user.click(screen.getByRole("button", { name: "Cancel search" }));
  expect(running!.terminate).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Find moves" })).toBeTruthy();
});

test("unchanged positions reuse move results and missing pages can be reloaded", async () => {
  let solves = 0;
  let dropPages = false;
  vi.stubGlobal(
    "Worker",
    class extends SolverWorker {
      postMessage(request: SolverRequest) {
        if (request.kind === "solve") solves++;
        if (dropPages && request.kind === "page") {
          queueMicrotask(() =>
            this.onmessage?.({ data: { kind: "page", id: request.id } }),
          );
        } else super.postMessage(request);
      }
    },
  );
  const user = await start();
  await typeRack(user, "CAT");
  await user.click(screen.getByRole("button", { name: "Find moves" }));
  const move = (await screen.findAllByRole("button", { name: /^CAT, / }))[0];
  await user.click(rackTile(1));
  await user.keyboard("{Enter}");
  expect(solves).toBe(1);
  expect(screen.getAllByRole("button", { name: /^CAT, / })[0]).toBe(move);

  dropPages = true;
  await user.click(screen.getByRole("button", { name: "Search possible moves" }));
  await user.type(screen.getByRole("textbox", { name: "Filter moves" }), "CAT");
  expect(await screen.findByText(/Move results are unavailable/)).toBeTruthy();
  dropPages = false;
  await user.click(screen.getByRole("button", { name: "Find moves" }));
  await screen.findAllByRole("button", { name: /^CAT, / });
  expect(solves).toBe(2);

  await user.click(cell("H8: DW, start"));
  await user.keyboard("S");
  expect(current().rack).toBe("CAT");
  await user.click(screen.getByRole("button", { name: "Find moves" }));
  expect(solves).toBe(3);
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

test("workspace settings keep board previews visible with plain rack tiles and persist across reloads", async () => {
  const user = userEvent.setup();
  const app = render(<App />);
  await screen.findByRole("heading", { name: /First game/ });
  const openSettings = () =>
    user.click(
      within(screen.getByRole("complementary", { name: "Sidebar" }))
        .getByRole("button", { name: "Settings" }),
    );
  const dialog = () => within(screen.getByRole("dialog", { name: "Settings" }));
  const option = (name: string) =>
    dialog().getByRole<HTMLInputElement>("checkbox", { name });
  const rackHighlight = "Highlight rack tiles on move preview";
  const pulse = "Pulse move previews";
  const playAnimation = "Animate tiles when playing a move";
  const autoUpdate = "Automatically reload when an update is available";

  await openSettings();
  expect(dialog().getByText("Applies to all games in this browser only.")).toBeTruthy();
  expect(
    ["Move previews", "Gameplay", "Updates"].map(
      (name) =>
        within(dialog().getByRole("group", { name })).getAllByRole("checkbox").length,
    ),
  ).toEqual([2, 1, 1]);
  for (const name of [rackHighlight, pulse, playAnimation, autoUpdate]) {
    expect(option(name).checked).toBe(true);
    await user.click(option(name));
  }
  await user.click(dialog().getByRole("button", { name: "Close dialog" }));
  await typeRack(user, "CAT");
  await user.click(screen.getByRole("button", { name: "Find moves" }));
  const move = (await screen.findAllByRole("button", { name: /^CAT, / }))[0];
  await user.hover(move);
  expect(document.querySelectorAll(".board-panel .ghost")).toHaveLength(3);
  expect(document.querySelector(".rack-panel .move-preview")).toBeNull();
  expect(move.closest("[data-static-previews]")).toBeTruthy();
  await user.click(move);
  await waitFor(() => expect(current().board.filter(Boolean)).toHaveLength(3));

  app.unmount();
  render(<App />);
  await screen.findByRole("heading", { name: /First game/ });
  await openSettings();
  for (const name of [rackHighlight, pulse, playAnimation, autoUpdate]) {
    expect(option(name).checked).toBe(false);
  }
});

test("the version shows an available update when automatic updates are off", async () => {
  const user = await start();
  const settings = () => within(screen.getByRole("dialog", { name: "Settings" }));
  const autoUpdate = () =>
    settings().getByRole("checkbox", { name: "Automatically reload when an update is available" });
  const updateIcon = () => screen.queryByRole("img", { name: /^Update available/ });
  await user.click(cell("Settings"));
  await user.click(autoUpdate());
  await user.click(settings().getByRole("button", { name: "Close dialog" }));
  remote.version = version;
  await act(() => store.refresh());
  expect(updateIcon()).toBeNull();

  const [major, minor, patch] = version.split(".").map(Number);
  remote.version = `${major}.${minor}.${patch + 1}`;
  await act(() => store.refresh());
  expect(updateIcon()?.parentElement).toBe(screen.getByText(`v${version}`));
  expect(updateIcon()?.textContent?.trim()).toBe(`Update available · v${remote.version}`);
  expect(updateIcon()?.tabIndex).toBe(0);

  await user.click(cell("Settings"));
  await user.click(autoUpdate());
  expect(document.querySelector(".app-update-icon")).toBeNull();
});

test("typing in the game picker filters active games by opponent name", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(min-width: 1000px)",
    addEventListener() {},
    removeEventListener() {},
  }));
  remote.games.push(
    { ...game(), id: "second", name: "Jo Smith", platform: "Wordfeud" },
    { ...game(), id: "third", name: "Jo Smith", platform: "Scrabble GO" },
    { ...game(), id: "archived", name: "Jo Smith", archived: true },
  );
  const user = await start();
  await act(() => store.refresh());
  const trigger = cell("Switch game");
  const options = () => screen.queryAllByRole("menuitemradio");
  const search = () =>
    screen.getByRole<HTMLInputElement>("searchbox", {
      name: "Filter by opponent",
    });
  await user.click(trigger);
  expect(document.activeElement).toBe(search());
  await user.keyboard("sMiTh");
  expect(options()).toHaveLength(2);
  expect(options()[0].textContent).toMatch(/^2Jo SmithWordfeud/);
  expect(options()[1].textContent).toMatch(/^3Jo SmithScrabble GO/);
  expect(screen.queryByRole("menuitem", { name: /Reorder/ })).toBeNull();

  await user.keyboard("x{ArrowDown}{Enter}");
  expect(screen.getByText("No matching games.").getAttribute("role")).toBe(
    "status",
  );
  expect(options()).toHaveLength(0);
  await user.keyboard("{Backspace}{ArrowDown}{ArrowDown}{Enter}");
  expect(await screen.findByRole("heading", { name: "Jo Smith" })).toBeTruthy();
  expect(localStorage.getItem("tilewise:game")).toBe("third");

  trigger.focus();
  await user.keyboard("{ArrowDown}");
  expect(search().value).toBe("");
  expect(options()).toHaveLength(3);
  await user.keyboard("F");
  expect(document.activeElement).toBe(search());
  expect(options()).toHaveLength(1);
  expect(options()[0].getAttribute("aria-checked")).toBe("false");
  await user.keyboard("{Escape}");
  expect(
    screen.queryByRole("searchbox", { name: "Filter by opponent" }),
  ).toBeNull();
  expect(document.activeElement).toBe(trigger);
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

test.each([false, true])("the endgame heading and opponent rack follow the bag count (phone %s)", async (phone) => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: phone
      ? query === "(max-width: 650px)"
      : query === "(min-width: 1000px)",
    addEventListener() {},
    removeEventListener() {},
  }));
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
  const yourRack = panel.getByRole("group", { name: "Your rack tiles" });
  const opponentRack = () =>
    panel.queryByRole("img", { name: "Opponent rack: J, J, blank" });
  const expectLabeledRacks = () => {
    const you = panel.getByText("You");
    const opponent = panel.getByText("Opponent");
    expect(you.nextElementSibling).toBe(yourRack);
    expect(opponent.nextElementSibling).toBe(opponentRack());
    expect(you.parentElement?.nextElementSibling).toBe(opponent.parentElement);
  };
  await panel.findByRole("img", { name: "Opponent rack: J, J, blank" });
  expectLabeledRacks();
  expect(screen.getByRole("heading", { name: "Possible moves - Endgame" })).toBeTruthy();

  await user.click(panel.getByText("Rack tools"));
  await user.click(panel.getByRole("button", { name: "Exclude tiles" }));
  await user.click(panel.getByRole("button", { name: /^Rack tile 3: T/ }));
  await user.click(panel.getByRole("button", { name: "Done" }));
  expect(opponentRack()).toBeTruthy();
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await screen.findAllByRole("button", { name: /^CAT, / });
  expect(!!yourRack.closest(".phone-move-review")).toBe(phone);
  expectLabeledRacks();
  await user.click(screen.getByText("Options", { selector: "summary" }));
  await user.click(screen.getByText("Reply settings", { selector: "summary" }));
  const bag = screen.getByRole("spinbutton", { name: "Tiles in bag" });
  await user.type(bag, "1");
  await user.click(
    screen.getByRole("button", { name: "Update reply analysis" }),
  );
  expect(opponentRack()).toBeNull();
  expect(panel.queryByText("You")).toBeNull();
  expect(panel.queryByText("Opponent")).toBeNull();
  expect(screen.getByRole("heading", { name: "Possible moves" })).toBeTruthy();
  await user.clear(bag);
  await user.click(
    screen.getByRole("button", { name: "Update reply analysis" }),
  );
  expectLabeledRacks();
  expect(screen.getByRole("heading", { name: "Possible moves - Endgame" })).toBeTruthy();
  expect(screen.queryByText("Bag assumed empty")).toBeNull();

  await typeRack(user, "Z");
  expect(opponentRack()).toBeNull();
  expect(screen.getByRole("heading", { name: "Possible moves" })).toBeTruthy();
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

test("Optimal Exchange restores the rankings and caches each completed simulation", async () => {
  const searches: Extract<PracticeRequest, { kind: "optimal-exchange" }>[] = [];
  const simulations: Extract<PracticeRequest, { kind: "exchange" }>[] = [];
  let pendingSimulation: SolverWorker | undefined;
  vi.stubGlobal(
    "Worker",
    class extends SolverWorker {
      postMessage(request: SolverRequest | PracticeRequest) {
        if (request.kind === "optimal-exchange") {
          searches.push(request);
          queueMicrotask(() =>
            this.onmessage?.({
              data: {
                result: {
                  keepBingo: false,
                  checked: 7,
                  finalists: 7,
                  screeningDraws: 128,
                  refinementDraws: 1200,
                  bestSwaps: [
                    { slots: [0, 2], chance: 0.42, close: false },
                    { slots: [1, 2], chance: 0.35, close: false },
                    { slots: [0], chance: 0.18, close: false },
                    { slots: [0, 1, 2], chance: 0, close: false },
                  ],
                },
              },
            }),
          );
        } else if (request.kind === "exchange") {
          simulations.push(request);
          pendingSimulation = this;
        } else if (!("exchange" in request) && !("turns" in request)) {
          super.postMessage(request);
        }
      }
    },
  );
  function finishSimulation(score: number, bingo: number) {
    act(() => {
      pendingSimulation!.onmessage?.({
        data: {
          result: {
            score,
            bingo,
            playable: 1,
            exact: true,
            completed: 20,
            total: 20,
            examples: [],
          },
        },
      });
    });
  }
  const user = await start();
  await typeRack(user, "CAT");
  await user.click(screen.getByText("Rack tools"));
  await user.click(screen.getByRole("button", { name: "Optimal Exchange" }));
  const optimal = within(
    screen.getByRole("region", { name: "Optimal Exchange" }),
  );
  expect(await optimal.findByText("≈35%")).toBeTruthy();
  const [head, baseline, first, second, third, all] =
    optimal.getAllByRole("row");
  expect(
    within(head).getByRole("columnheader", { name: "Leave" }),
  ).toBeTruthy();
  expect(within(baseline).getByText("Keep your rack")).toBeTruthy();
  expect(within(baseline).getAllByRole("cell")[0].textContent).toBe("CAT");
  expect(within(first).getByText("≈42%")).toBeTruthy();
  expect(
    within(first)
      .getByRole("button", { name: "Simulate exchanging C, T" })
      .textContent?.trim(),
  ).toBe("Simulate");
  expect(within(first).getAllByRole("cell")[0].textContent).toBe("A");
  expect(within(second).getByText("≈35%")).toBeTruthy();
  expect(within(second).getAllByRole("cell")[0].textContent).toBe("C");
  expect(within(third).getByText("≈18%")).toBeTruthy();
  expect(within(third).getAllByRole("cell")[0].textContent).toBe("AT");
  expect(within(all).getAllByRole("cell")[0].textContent).toBe("—");
  expect(searches.map(({ exchange }) => exchange.rack)).toEqual(["CAT"]);
  await user.click(
    within(second).getByRole("button", { name: "Simulate exchanging A, T" }),
  );
  expect(screen.queryByRole("region", { name: "Optimal Exchange" })).toBeNull();
  const simulator = within(
    screen.getByRole("region", { name: "Simulate exchange" }),
  );
  expect(simulations[0].exchange.slots).toEqual([1, 2]);
  expect(simulations[0].exchange.bag).toBe(searches[0].exchange.bag);
  expect(
    simulator.getByText("Bingo chance · ≈35% from Optimal Exchange"),
  ).toBeTruthy();
  finishSimulation(24, 0.27);
  expect(simulator.getByText("24.0 pts")).toBeTruthy();
  expect(simulator.getByText("27%")).toBeTruthy();
  expect(simulator.queryByText(/from Optimal Exchange/)).toBeNull();
  expect(
    screen.getByLabelText("Rack tile 2: A, marked for exchange"),
  ).toBeTruthy();
  expect(current().rack).toBe("CAT");
  await user.click(
    simulator.getByRole("button", { name: "Back to Optimal Exchange" }),
  );
  expect(
    screen.queryByRole("region", { name: "Simulate exchange" }),
  ).toBeNull();
  const restored = within(
    screen.getByRole("region", { name: "Optimal Exchange" }),
  );
  expect(restored.getAllByRole("row").map((row) => row.textContent)).toEqual(
    optimal.getAllByRole("row").map((row) => row.textContent),
  );
  expect(document.activeElement).toBe(
    restored.getByRole("heading", { name: "Optimal Exchange" }),
  );
  await user.click(
    restored.getByRole("button", { name: "Simulate exchanging C, T" }),
  );
  expect(simulations[1].exchange.slots).toEqual([0, 2]);
  const other = within(
    screen.getByRole("region", { name: "Simulate exchange" }),
  );
  expect(
    other.getByText("Bingo chance · ≈42% from Optimal Exchange"),
  ).toBeTruthy();
  finishSimulation(31, 0.44);
  expect(other.getByText("31.0 pts")).toBeTruthy();
  await user.click(
    other.getByRole("button", { name: "Back to Optimal Exchange" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Simulate exchanging A, T" }),
  );
  const cached = within(
    screen.getByRole("region", { name: "Simulate exchange" }),
  );
  expect(cached.getByText("24.0 pts")).toBeTruthy();
  expect(cached.queryByRole("status")).toBeNull();
  expect(simulations).toHaveLength(2);
  expect(searches).toHaveLength(1);
  await user.click(cached.getByRole("button", { name: "Run again" }));
  expect(simulations).toHaveLength(3);
  finishSimulation(28, 0.31);
  await user.click(
    cached.getByRole("button", { name: "Back to Optimal Exchange" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Simulate exchanging A, T" }),
  );
  expect(screen.getByText("28.0 pts")).toBeTruthy();
  expect(simulations).toHaveLength(3);
  await user.click(rackTile(1));
  await user.keyboard("B");
  expect(current().rack).toBe("BAT");
  expect(screen.queryByRole("region", { name: "Optimal Exchange" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Back to Optimal Exchange" }),
  ).toBeNull();
  await user.click(screen.getByText("Rack tools"));
  await user.click(screen.getByRole("button", { name: "Optimal Exchange" }));
  expect(searches.map(({ exchange }) => exchange.rack)).toEqual(["CAT", "BAT"]);
  await user.click(
    await screen.findByRole("button", { name: "Simulate exchanging A, T" }),
  );
  expect(simulations).toHaveLength(4);
  expect(screen.queryByText("28.0 pts")).toBeNull();
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
  expect(
    within(section).queryByRole("button", { name: "Back to Optimal Exchange" }),
  ).toBeNull();
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
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query !== "(max-width: 650px)",
    addEventListener() {},
    removeEventListener() {},
  }));
  const user = await start();
  await typeRack(user, "CATS");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await user.click(await screen.findByRole("button", { name: "Sort by word" }));
  expect(
    (await screen.findByRole("button", { name: "Sort by word" })).getAttribute(
      "aria-pressed",
    ),
  ).toBe("true");
  await user.click(
    (await screen.findAllByRole("button", { name: /^AT, / }))[0],
  );
  await typeRack(user, "CATS");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  const points = await screen.findByRole("button", { name: "Sort by points" });
  expect(points.getAttribute("aria-pressed")).toBe("true");
  expect(points.getAttribute("title")).toBe("points (descending)");
});
