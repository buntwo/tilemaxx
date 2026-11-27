import { moveLocation } from "../../shared/notation";
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
import { chooseMoveOption, openMoveOptions } from "./move-options";
import { version } from "../../version.json";
import App from "../../src/App";
import OptimalExchange from "../../src/components/OptimalExchange";
import { GameStore, store } from "../../src/store";
import { BoardEditHistory } from "../../shared/board-entry";
import { emptyScoring, playTrackedMove, recordBoardlessTurn, recordOpponentPlay } from "../../shared/game-scoring";
import { summarizeGame } from "../../shared/game-index";
import { PRESETS } from "../../shared/presets";
import { importBoard } from "../../shared/screenshot";
import {
  applyMove,
  archiveGame,
  coordinate,
  emptyBoard,
  localDate,
  newGameFromSettings,
  type AppState,
  type Game,
} from "../../shared/model";
import { Lexicon } from "../../shared/lexicon";
import { inspectBoard, solve, solvePositionWithBaseline } from "../../shared/solver";
import { analyzeMoves, type AnalysisRequest } from "../../shared/move-analysis";
import { REPLY_LIMIT, REPLY_SAMPLES, replyEndgameLine, type ReplyDistribution, type ReplyRequest, type ReplyWorkerMessage } from "../../shared/reply-analysis";
import { MoveResultIndex } from "../../shared/move-results";
import { createPlayerProfiles } from "../../shared/player-profiles";
import { isSoloSimulatedStyle } from "../../shared/simulated-styles";
import { createSoloStyleSearch } from "../../shared/solo-styles";
import { prepareEndgameEstimate } from "../../shared/endgame-estimate";
import { moveRowHeight } from "../../src/useMoveResults";
import type { ReplayStyleRequest, SolverMessage, SolverRequest } from "../../src/solver-messages";
import { styleCandidate } from "../../shared/style-explanation";
import type { PracticeRequest } from "../../src/practice.worker";
import type { WordListCheckRequest } from "../../src/word-list-checker.worker";
import type { EndgamePrecomputeRequest } from "../../src/useEndgameLines";
import { simulateExchange } from "../../shared/exchange";
import { getTileCounts, TILE_SYMBOLS } from "../../shared/tile-pool";
import {
  parallelOpponentEndgame,
  type OpponentEndgameRequest,
} from "../../src/parallel-opponent-endgame";
import {
  archivedBeforeEndgame,
  opponentEndgameWords,
  playBeforeRefill,
} from "../opponent-endgame-fixture";

let remote: AppState & { version?: string };
let shellWidth: number;
const shellObservers = new Set<(width: number) => void>();

function resizeShell(width: number) {
  shellWidth = width;
  for (const notify of shellObservers) notify(width);
}

class ShellResizeObserver {
  private readonly notify: (width: number) => void;

  constructor(callback: (entries: { contentRect: { width: number } }[]) => void) {
    this.notify = (width) => callback([{ contentRect: { width } }]);
  }

  observe() {
    shellObservers.add(this.notify);
    this.notify(shellWidth);
  }

  disconnect() {
    shellObservers.delete(this.notify);
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
  protected boardWarnings(
    _lexicon: Lexicon,
    _request: Extract<SolverRequest, { kind: "solve" }>,
  ): string[] {
    return [];
  }
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
    const lexicon = new Lexicon(["AT", "CAT", "CATS", "ACT", "DOG", "RAT", "ART", "TAR"]);
    const { moves, topScore } = solvePositionWithBaseline(lexicon, request, request.template);
    const result = new MoveResultIndex(moves, request.template);
    this.results.set(request.id, result);
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          kind: "moves",
          solo: request.solo,
          id: request.id,
          results: result.summary(request.id, topScore),
          warnings: this.boardWarnings(lexicon, request),
          stages: { moves: 1, indexing: 0.5 },
          exchange: this.exchangeRequest(request),
        },
      });
      if (!request.solo) this.onmessage?.({
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

test("show all moves follows move 100 and expands without changing the search or scroll position", async () => {
  const letters = [..."CATSREN"];
  const lexicon = new Lexicon(letters.flatMap((a) =>
    letters.flatMap((b) => a === b ? [] :
      letters.filter((c) => c !== a && c !== b).map((c) => a + b + c)),
  ));
  const requests: number[] = [];
  let tailWord = "";
  class ManyMovesWorker extends SolverWorker {
    postMessage(request: SolverRequest) {
      if (request.kind !== "solve") return super.postMessage(request);
      requests.push(request.id);
      const { moves, topScore } = solvePositionWithBaseline(lexicon, request, request.template);
      const result = new MoveResultIndex(moves.slice(0, 125), request.template);
      tailWord = result.moves.at(-1)!.word;
      this.results.set(request.id, result);
      queueMicrotask(() => this.onmessage?.({ data: {
        kind: "moves",
        id: request.id,
        results: result.summary(request.id, topScore),
        warnings: [],
        stages: { moves: 1, indexing: 0.5 },
      } satisfies SolverMessage }));
    }
  }
  vi.stubGlobal("Worker", ManyMovesWorker);
  const user = await start(1200);
  await typeRack(user, "CATSRE");
  const find = () => screen.getAllByRole("button", { name: "Find moves" })[0];
  await user.click(find());
  const more = () => screen.findByRole("button", { name: "Show all moves (25 more)" });
  const expand = await more();
  const list = () => screen.getByLabelText("Suggested moves");
  expect(expand.parentElement?.parentElement).toBe(list());
  expect(expand.parentElement?.previousElementSibling).toBe(list().firstElementChild);
  const listHeight = () => (list().firstElementChild as HTMLElement).style.height;
  const lastRow = () => Math.max(...Array.from(list().querySelectorAll<HTMLElement>(".result-slot"),
    row => Number.parseFloat(row.style.top) / moveRowHeight + 1));
  const scrollTo = (row: number) => {
    list().scrollTop = row * moveRowHeight;
    fireEvent.scroll(list());
  };
  expect(listHeight()).toBe(`${100 * moveRowHeight}px`);

  await user.click(screen.getByRole("button", { name: "Search possible moves" }));
  const filter = screen.getByRole("textbox", { name: "Filter moves" });
  await user.type(filter, tailWord);
  await waitFor(() => expect(lastRow()).toBeLessThanOrEqual(6));
  expect(screen.queryByRole("button", { name: /Show all moves/ })).toBeNull();
  await user.clear(filter);
  await more();

  scrollTo(92);
  await waitFor(() => expect(lastRow()).toBe(100));

  await user.click(await more());
  expect(listHeight()).toBe(`${125 * moveRowHeight}px`);
  expect(list().scrollTop).toBe(92 * moveRowHeight);
  expect(document.activeElement).toBe(list());
  scrollTo(117);
  await waitFor(() => expect(lastRow()).toBe(125));
  expect(screen.queryByRole("button", { name: /Show all moves/ })).toBeNull();
  expect(requests).toHaveLength(1);

  await user.click(rackTile(6));
  await user.keyboard("N");
  await user.click(find());
  await more();
  expect(listHeight()).toBe(`${100 * moveRowHeight}px`);
  expect(requests).toHaveLength(2);
});

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
      const words = ["AT", "CAT", "CATS", "ACT", "DOG", "RAT", "ART", "TAR"];
      const lexicon = new Lexicon(words);
      const choose = createPlayerProfiles(lexicon, request.template, new Map(words.map((word) => [word, 4])));
      const result = analyzeMoves(lexicon, { ...request, trials: 8 }, choose);
      queueMicrotask(() => this.onmessage?.({ data: { result } }));
    }
  }
  vi.stubGlobal("Worker", TestAnalysisWorker);
  const user = await start();
  await typeRack(user, "CATS");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await chooseMoveOption(user, "Analyze");
  const alternative = screen
    .getAllByRole("button", { name: /^CATS, / })
    .find((row) => row.getAttribute("aria-pressed") === "false")!;
  const ghosts = () => document.querySelectorAll(".board-entry .ghost");
  await user.hover(alternative);
  expect(ghosts()).toHaveLength(4);
  expect(ghosts()[0].closest(".board-grid")?.getAttribute("data-preview-player")).toBe("you");
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
  const opponentModel = screen.getByRole("combobox", { name: "Opponent model" });
  expect(within(opponentModel).getByRole("option", { name: "Learner" })).toHaveProperty("value", "learner");
  expect(within(opponentModel).getByRole("option", { name: "Strong" })).toHaveProperty("value", "strong");
  await user.selectOptions(opponentModel, "casual");
  await user.selectOptions(opponentModel, "learner");
  expect(runs).toBe(1);
  expect(current().rack).toBe("CATS");
  await user.click(rackTile(1));
  await user.keyboard("D");
  expect(screen.queryByRole("article", { name: /^Analysis for/ })).toBeNull();
});

test("All moves and Shortlist share the selected playing style as their return view", async () => {
  const requested: string[] = [];
  class ProfileWorker extends SolverWorker {
    postMessage(request: SolverRequest) {
      if (request.kind === "page" && request.query.profile) {
        requested.push(request.query.profile);
        const result = this.results.get(request.searchId);
        if (result) result.setProfile(request.query, result.moves.slice(1, 2).map((move) => ({
          move, utility: {
            total: 8.8, points: 8.5, premium: 0, visibility: 1, appeal: 2, leave: 0.2, goingOut: 0, premiumLane: -1.15, lookahead: 1.25,
          },
        })));
      }
      super.postMessage(request);
    }
  }
  vi.stubGlobal("Worker", ProfileWorker);
  const user = await start();
  await typeRack(user, "CATS");
  await user.keyboard("{Enter}");
  await screen.findByLabelText("Suggested moves");
  const all = () => document.querySelectorAll(".result-row");
  expect(all().length).toBeGreaterThan(1);
  const picker = screen.getByRole("combobox", { name: "Playing style" });
  expect(within(picker).getByRole("option", { name: "No style", selected: true })).toBeTruthy();
  await user.selectOptions(picker, "learner");
  await waitFor(() => expect(all()).toHaveLength(1));
  expect(requested).toContain("learner");
  expect(screen.getByLabelText("Sort by playing style or points")).toBeTruthy();
  expect(within(all()[0] as HTMLElement).getByText("#1")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /^Style breakdown for/ }));
  const tooltip = within(screen.getByRole("tooltip"));
  expect(tooltip.getByText("Style breakdown")).toBeTruthy();
  expect(tooltip.getByText("Learner · Rank 1")).toBeTruthy();
  expect(tooltip.getByText("Weighted points")).toBeTruthy();
  expect(tooltip.getByText("Visibility weight")).toBeTruthy();
  expect(tooltip.getByText("Appeal multiplier")).toBeTruthy();
  expect(tooltip.getByText("Rack leave")).toBeTruthy();
  expect(tooltip.getByText("Premium lane risk")).toBeTruthy();
  expect(tooltip.getByText("Lookahead adjustment")).toBeTruthy();
  expect(tooltip.getByText("1.25").classList.contains("value-good")).toBe(true);
  expect(tooltip.getByText("-1.15").classList.contains("value-bad")).toBe(true);
  expect(tooltip.queryByText("Score breakdown")).toBeNull();
  expect(current().board.some(Boolean)).toBe(false);

  const allMoves = screen.getByRole("button", { name: "All moves" });
  expect(allMoves.textContent).toBe("All moves");
  const shortlist = (await openMoveOptions(user)).getByRole("button", { name: /^Shortlist/ });
  const suggested = () => screen.getByLabelText("Suggested moves");
  suggested().scrollTop = 12;
  fireEvent.scroll(suggested());
  await user.click(screen.getByRole("button", { name: "All moves" }));
  await waitFor(() => expect(all().length).toBeGreaterThan(1));
  expect(screen.queryByText("U 7")).toBeNull();
  expect(screen.getAllByRole("button", { name: /^Score breakdown for/ }).length).toBeGreaterThan(0);
  expect(allMoves.getAttribute("aria-pressed")).toBe("true");
  expect(suggested().scrollTop).toBe(0);
  expect(localStorage.getItem(`tilemaxx:playing-style:${current().id}`)).toBe("learner");

  await chooseMoveOption(user, /^Shortlist/);
  expect(shortlist.getAttribute("aria-pressed")).toBe("true");
  expect(suggested().classList.contains("is-shortlist")).toBe(true);
  expect(shortlist.title).toBe("Return to Learner");
  await chooseMoveOption(user, /^Shortlist/);
  expect(allMoves.getAttribute("aria-pressed")).toBe("false");
  await waitFor(() => expect(all()).toHaveLength(1));
  expect(picker).toHaveProperty("value", "learner");
  expect(suggested().scrollTop).toBe(12);

  await chooseMoveOption(user, /^Shortlist/);
  expect(suggested().classList.contains("is-shortlist")).toBe(true);
  await user.click(screen.getByRole("button", { name: "All moves" }));
  expect(allMoves.getAttribute("aria-pressed")).toBe("true");
  expect(allMoves.title).toBe("Return to Learner");
  await user.click(screen.getByRole("button", { name: "All moves" }));
  expect(allMoves.getAttribute("aria-pressed")).toBe("false");
  expect(await screen.findByText("#1")).toBeTruthy();
  expect(picker).toHaveProperty("value", "learner");
});

test.each([1200, 390])("replay restores a saved style explanation and previews the exact alternative at %ipx", async (width) => {
  class ExplainingWorker extends SolverWorker {
    postMessage(request: SolverRequest) {
      if (request.kind === "page" && request.query.profile === "learner") {
        const result = this.results.get(request.searchId);
        if (result) {
          const played = result.moves.find(({ word, direction }) => word === "CAT" && direction === "across")!;
          const other = result.moves.find(({ word, direction }) => word === "CATS" && direction === "down")!;
          result.setProfile(request.query, [played, other].map((move, index) => ({
            move,
            utility: {
              total: index ? 11 : 12, points: move.score * 0.85, premium: 0.4,
              visibility: 1, appeal: 2, leave: index ? 0 : 1.2, goingOut: 0,
              premiumLane: index ? -2.4 : -1.15, lookahead: index ? 0 : 1.25,
              modeledReply: index ? 30 : 22, modeledFollowUp: 28, lookaheadDeals: 8,
            },
          })));
        }
      }
      super.postMessage(request);
    }
  }
  vi.stubGlobal("Worker", ExplainingWorker);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: width > 400 && query === "(any-hover: hover)",
    addEventListener() {},
    removeEventListener() {},
  }));
  shellWidth = width;
  const user = userEvent.setup();
  const mounted = render(<App />);
  await screen.findByRole("heading", { name: /First game/ });
  await typeRack(user, "CATS");
  await user.keyboard("{Enter}");
  await user.selectOptions(await screen.findByRole("combobox", { name: "Playing style" }), "learner");
  const row = await screen.findByRole("button", { name: /^CAT, .*playing style rank 1/ });
  await user.click(row);
  if (!current().trackedMoves?.length) await user.click(cell("Play"));
  const decision = current().trackedMoves?.[0].styleExplanation;
  expect(decision).toMatchObject({
    style: "learner", kind: "play", recommended: true, alternative: { move: { word: "CATS" } },
  });
  await act(() => store.flush());
  expect(remote.games[0].trackedMoves?.[0].styleExplanation).toMatchObject({ style: "learner" });
  const id = current().id;
  mounted.unmount();
  history.replaceState(null, "", `/games/${id}?move=1`);
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Why?" }));
  const why = within(screen.getByRole("region", { name: "Why this move?" }));
  expect(why.getByText(/cut the modeled reply by 8/)).toBeTruthy();
  await user.click(why.getByText("Style breakdown"));
  expect(why.getByText("1.25").classList.contains("value-good")).toBe(true);
  expect(why.getByText("-1.15").classList.contains("value-bad")).toBe(true);
  const alternative = why.getByRole("button", { name: /^Preview alternative CATS at .* down/ });
  const ghosts = () => Array.from(document.querySelectorAll(".board-entry .ghost")).length;
  expect(ghosts()).toBe(3);
  const before = current().board;
  await user.click(alternative);
  expect(alternative.getAttribute("aria-pressed")).toBe("true");
  expect(ghosts()).toBe(4);
  expect(document.querySelector(".board-panel")?.hasAttribute("data-alternative-preview")).toBe(true);
  expect(current().board).toEqual(before);
  expect(location.search).toBe("?move=1");
  await user.keyboard("{Escape}");
  expect(ghosts()).toBe(3);
  expect(location.search).toBe("?move=1");
  await user.click(alternative);
  await user.click(cell("Preview recorded move CAT"));
  expect(ghosts()).toBe(3);
  expect(alternative.getAttribute("aria-pressed")).toBe("false");
});

test("Resample style changes the draw and keeps the current solve and vocabulary", async () => {
  let solves = 0;
  const requests: Extract<SolverRequest, { kind: "page" }>[] = [];
  class SamplingWorker extends SolverWorker {
    postMessage(request: SolverRequest) {
      if (request.kind === "solve") solves++;
      if (request.kind === "page" && request.query.profile === "learner") {
        requests.push(request);
        const result = this.results.get(request.searchId);
        const sample = request.query.profileSample;
        const move = result?.moves.find((move) => move.word === (sample === 1 ? "ACT" : "CAT"));
        result?.setProfile(request.query, sample && move ? [{
          move, utility: {
            total: move.score, points: move.score, premium: 0, visibility: 1,
            appeal: 1, leave: 0, goingOut: 0,
          },
        }] : []);
      }
      super.postMessage(request);
    }
  }
  vi.stubGlobal("Worker", SamplingWorker);
  const user = await start();
  await typeRack(user, "CATS");
  await user.keyboard("{Enter}");
  const picker = await screen.findByRole("combobox", { name: "Playing style" });
  const resample = async () => (await openMoveOptions(user))
    .queryByRole("button", { name: "Resample style" });
  expect(await resample()).toBeNull();
  await user.selectOptions(picker, "learner");
  await screen.findByRole("heading", { name: "No moves spotted" });
  const original = requests.at(-1)!;
  expect(original.query.profileSample).toBe(0);
  await chooseMoveOption(user, "Resample style");
  expect(await screen.findByRole("button", { name: /^ACT, .*playing style rank 1/ })).toBeTruthy();
  const firstDraw = requests.at(-1)!;
  expect(firstDraw.searchId).toBe(original.searchId);
  expect(firstDraw.query.profileSeed).toBe(original.query.profileSeed);
  expect(firstDraw.query.profileSample).toBe(1);
  expect(solves).toBe(1);

  await user.click(screen.getByRole("button", { name: "All moves" }));
  expect(await resample()).toBeNull();
  await user.click(screen.getByRole("button", { name: "All moves" }));
  expect(await screen.findByRole("button", { name: /^ACT, .*playing style rank 1/ })).toBeTruthy();
  expect(requests.at(-1)?.query.profileSample).toBe(1);

  await user.click(screen.getByRole("button", { name: /^Style breakdown for ACT/ }));
  expect(await screen.findByRole("tooltip")).toBeTruthy();
  await chooseMoveOption(user, "Resample style");
  expect(await screen.findByRole("button", { name: /^CAT, .*playing style rank 1/ })).toBeTruthy();
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(requests.at(-1)?.query.profileSample).toBe(2);
  expect(solves).toBe(1);
  expect(current().rack).toBe("CATS");
  expect(current().board.some(Boolean)).toBe(false);

  await user.selectOptions(picker, "bingo-hunter");
  expect(await resample()).toBeNull();
  await user.selectOptions(picker, "learner");
  expect(await screen.findByRole("button", { name: /^CAT, .*playing style rank 1/ })).toBeTruthy();
  expect(requests.at(-1)?.query.profileSample).toBe(2);

  await user.click(rackTile(4));
  await user.keyboard("R{Enter}");
  await screen.findByRole("heading", { name: "No moves spotted" });
  expect(solves).toBe(2);
  expect(requests.at(-1)?.query.profileSample).toBe(0);
  expect(current().rack).toBe("CATR");
});

test("each game remembers its playing style after switching games, closing results and reopening the app", async () => {
  remote.games[0].rack = "CATS";
  remote.games[0].revision++;
  remote.games.push({ ...game(), id: "second", name: "Second game", rack: "CATS" });
  const mounted = render(<App />);
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: /First game/ });
  await act(() => store.refresh());

  const showMoves = async () => {
    await user.click(await screen.findByRole("button", { name: "Find moves" }));
    return screen.findByRole<HTMLSelectElement>("combobox", { name: "Playing style" });
  };
  const pickGame = async (name: RegExp) => {
    await user.click(screen.getByRole("button", { name: "Switch game" }));
    await user.click(await screen.findByRole("menuitemradio", { name }));
    await screen.findByRole("heading", { name });
  };

  await user.selectOptions(await showMoves(), "strong");
  await user.click(screen.getByRole("button", { name: "Close possible moves" }));
  expect((await showMoves()).value).toBe("strong");

  await pickGame(/Second game/);
  const secondStyle = await showMoves();
  expect(secondStyle.value).toBe("");
  await user.selectOptions(secondStyle, "tactician");
  expect(screen.getByRole("button", { name: "Run Bingo Tactician" })).toBeTruthy();

  await pickGame(/First game/);
  expect((await showMoves()).value).toBe("strong");
  mounted.unmount();
  render(<App />);
  await screen.findByRole("heading", { name: /First game/ });
  expect((await showMoves()).value).toBe("strong");

  await pickGame(/Second game/);
  const restored = await showMoves();
  expect(restored.value).toBe("tactician");
  await user.selectOptions(restored, "");
  await pickGame(/First game/);
  expect((await showMoves()).value).toBe("strong");
  await pickGame(/Second game/);
  expect((await showMoves()).value).toBe("");
});

test("Bingo Mercenary starts on demand, then follows new move searches", async () => {
  remote.games[0].template.rackSize = 4;
  remote.games[0].revision++;
  let runs = 0;
  let cancellations = 0;
  let firstResultId: number | undefined;
  let ceilingMove: string;
  let playPoints = 0;
  let playWeight = 1;
  let weightedPlayPoints = 0;
  const utilityText = () => `U ${weightedPlayPoints + 21}`;
  class HunterWorker extends SolverWorker {
    postMessage(request: SolverRequest) {
      if (request.kind === "bingo-hunter") {
        runs++;
        if (runs < 3 || runs === 6) {
          expect(request.resumeFrom).toBeUndefined();
          this.onmessage?.({ data: {
            id: request.id, kind: "bingo-hunter-progress",
            progress: { phase: "sample", stage: 1, done: 1, total: 8 },
          } });
          return;
        }
        if (runs === 3) firstResultId = request.id;
        if (runs === 4) {
          expect(request.resumeFrom).toBe(firstResultId);
          this.onmessage?.({ data: {
            id: request.id, kind: "bingo-hunter-progress",
            progress: { phase: "ceiling-discovery", stage: 4, done: 1, total: 8 },
          } });
          return;
        }
        const result = this.results.get(request.searchId)!;
        const move = runs === 7 ? result.moves.find(({ word }) => word === "CAT")! : result.moves[0];
        ceilingMove = move.word;
        playPoints = move.score;
        playWeight = move.tiles.length === 4 ? 1 : 0.75;
        weightedPlayPoints = playPoints * playWeight;
        result.setProfile({ profile: "bingo-hunter", profileBagSize: request.bagSize, profileSeed: request.id },
          [{
            move, utility: {
              total: weightedPlayPoints + 21, playPoints, playWeight, weightedPlayPoints, nextBingoPoints: 21, bingoChance: 0.3,
              meanBingoScore: 70, highestBingo: 104, samples: 192, exact: false, close: false,
            },
          }]);
        this.onmessage?.({ data: {
          id: request.id, kind: "bingo-hunter", summary: {
            checked: 1, limited: false, canContinue: runs === 3, ceilingPass: runs === 3,
            ceilings: runs === 5 ? [{
              move, bingo: { ...move, word: "BANJAXES", score: 338 },
              draw: "ESX", drawChance: 0.0088, chance: 0.00185, needsReply: false,
              laneBingoChance: 0, blockChance: 1, exact: true, cases: 792,
            }] : undefined,
          },
        } });
        return;
      }
      if (request.kind === "cancel-bingo-hunter") {
        cancellations++;
        return;
      }
      super.postMessage(request);
    }
  }
  vi.stubGlobal("Worker", HunterWorker);
  const user = await start();
  await waitFor(() => expect(current().template.rackSize).toBe(4));
  await typeRack(user, "RATS");
  await user.keyboard("{Enter}");
  await user.selectOptions(await screen.findByRole("combobox", { name: "Playing style" }), "bingo-hunter");
  expect(runs).toBe(0);
  const button = () => screen.getByRole("button", { name: "Run Bingo Mercenary" });
  await user.click(button());
  expect(await screen.findByText("1. Simulating replies · 1/8 moves")).toBeTruthy();
  expect(screen.queryByRole("img", { name: /bingos?/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: /^Cancel$/ }));
  expect(cancellations).toBe(1);
  await user.click(button());
  await user.click(screen.getByRole("button", { name: "All moves" }));
  expect(screen.queryByText("1. Simulating replies · 1/8 moves")).toBeNull();
  expect(cancellations).toBe(1);
  await user.click(screen.getByRole("button", { name: "All moves" }));
  expect(await screen.findByText("1. Simulating replies · 1/8 moves")).toBeTruthy();
  expect(runs).toBe(2);
  await user.click(screen.getByRole("button", { name: /^Cancel$/ }));
  expect(cancellations).toBe(2);
  await user.click(button());
  expect(await screen.findByText(/^U \d+(?:\.\d+)?$/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /^Utility breakdown for/ }));
  const tooltip = within(screen.getByRole("tooltip"));
  expect(tooltip.getByText("Bingo Mercenary · Rank 1")).toBeTruthy();
  expect(tooltip.getByText("Play points now").parentElement?.lastChild?.textContent).toBe(
    playWeight === 1 ? String(playPoints) : `${playPoints} × 0.75 = ${weightedPlayPoints}`,
  );
  expect(tooltip.getByText("Expected bingo points next turn").parentElement?.lastChild?.textContent).toBe("21");
  expect(tooltip.getByText("Utility").parentElement?.lastChild?.textContent).toBe(String(weightedPlayPoints + 21));
  expect(tooltip.getByText("Highest bingo found")).toBeTruthy();
  expect(tooltip.getByText("104")).toBeTruthy();
  expect(tooltip.getByText("30%")).toBeTruthy();
  expect(screen.getByText(/High-ceiling setups ready to check/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Run another 10 seconds" }));
  expect(await screen.findByText("4. Finding high-scoring bingo setups · 1/8 moves")).toBeTruthy();
  expect(screen.getByText(utilityText())).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /^Cancel$/ }));
  expect(screen.getByText(utilityText())).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Run another 10 seconds" }));
  await user.click(await screen.findByText("High-ceiling setups (1)"));
  expect(screen.getByText("BANJAXES").closest(".bingo-move-word")?.textContent).toBe("BANJAXES 338");
  expect(screen.getByText(/0.19% after reply/)).toBeTruthy();
  expect(screen.getByText(/block the placement 100%/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: new RegExp(`^Preview ${ceilingMove!} at`) }));
  expect(document.querySelectorAll(".board-entry .ghost").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: `Play ${ceilingMove!}` })).toBeTruthy();
  expect(screen.getByText(utilityText())).toBeTruthy();

  await user.click(rackTile(1));
  await user.keyboard("{Enter}");
  expect(runs).toBe(5);
  await typeRack(user, "C");
  expect(current().rack).toBe("CATS");
  expect(runs).toBe(5);
  await user.keyboard("{Enter}");
  expect(await screen.findByText("1. Simulating replies · 1/8 moves")).toBeTruthy();
  expect(runs).toBe(6);
  const bingoBadge = screen.getByRole("img", { name: "8 bingos" });
  const moveBadge = screen.getByTitle("All legal moves");
  const allMoves = moveBadge.textContent;
  expect(Number(allMoves)).toBeGreaterThan(8);
  await user.click(screen.getByRole("button", { name: /^Cancel$/ }));
  expect(runs).toBe(6);
  expect(button()).toBeTruthy();
  await user.click(button());
  expect(await screen.findByText(/^U \d+(?:\.\d+)?$/)).toBeTruthy();
  expect(screen.getByRole("img", { name: "8 bingos" })).toBe(bingoBadge);
  expect(moveBadge.textContent).toBe(allMoves);
  await user.click(screen.getByRole("button", { name: /^Utility breakdown for/ }));
  const ordinaryBreakdown = within(screen.getByRole("tooltip"));
  expect(ordinaryBreakdown.getByText(`${playPoints} × 0.75 = ${weightedPlayPoints}`)).toBeTruthy();
});

test("Bingo styles run manually while Master starts on selection and reuses its result", async () => {
  const requests: Extract<SolverRequest, { kind: "bingo-hunter" }>[] = [];
  const masterRequests = () => requests.filter(({ style }) => style === "master");
  let finishMaster: () => void;
  class HunterWorker extends SolverWorker {
    postMessage(request: SolverRequest | ReplyRequest) {
      if (request.kind === "reply-summary") {
        queueMicrotask(() => this.onmessage?.({ data: { kind: request.kind, id: request.id, done: true } }));
        return;
      }
      if (request.kind === "board-odds") {
        queueMicrotask(() => this.onmessage?.({ data: {
          kind: request.kind, id: request.id,
          odds: { byMove: {}, checked: 0, total: request.candidates.length, bagSize: request.bagSize },
        } }));
        return;
      }
      if (request.kind === "reply-detail" || request.kind === "reply-histogram" || request.kind === "reply-line") return;
      if (request.kind !== "bingo-hunter") return super.postMessage(request);
      requests.push(request);
      const style = request.style!;
      const index = this.results.get(request.searchId)!;
      const move = index.moves[0];
      const playWeight = move.tiles.length === 7 ? 1 : .75;
      const weightedPlayPoints = move.score * playWeight;
      if (style === "master") {
        index.setProfile({ profile: style, profileBagSize: request.bagSize, profileSeed: request.id }, [{
          move, utility: { kind: "master", score: move.score, reply: -21, followUp: 19, leave: 4,
            rackAdjustment: 0, bingoChance: 0.3, total: move.score + 2, samples: 40, exactDeals: false, endgame: undefined },
        }]);
        finishMaster = () => this.onmessage?.({ data: {
          id: request.id, kind: "bingo-hunter", summary: { checked: 1, limited: false },
        } });
        return;
      }
      index.setProfile({ profile: style, profileBagSize: request.bagSize, profileSeed: request.id }, [{ move, utility: {
        playPoints: move.score, playWeight, weightedPlayPoints, nextBingoPoints: 21,
        bingoChance: .3, meanBingoScore: 70, highestBingo: 104, samples: 80, exact: false, close: false,
        total: weightedPlayPoints + (style === "tactician" ? 19 : 21),
        ...(style === "tactician" && { tactics: { replyPoints: 22, ordinaryPoints: 24, laneBonus: 2 } }),
      } }]);
      this.onmessage?.({ data: { id: request.id, kind: "bingo-hunter", summary: {
        checked: 1, limited: false, canContinue: style === "tactician" && !request.resumeFrom,
      } } });
    }
  }
  vi.stubGlobal("Worker", HunterWorker);
  const user = await start();
  await typeRack(user, "RATS");
  await user.keyboard("{Enter}");
  const timer = () => screen.findByRole("button", { name: /^Calculation timing,/ });
  const allMovesTime = (await timer()).textContent;
  const select = await screen.findByRole("combobox", { name: "Playing style" });
  expect(Array.from(select.querySelectorAll("option"), (option) => option.textContent)).toEqual([
    "No style", "Casual", "Learner", "Strong", "Bingo Mercenary", "Bingo Tactician", "Master",
  ]);
  await user.selectOptions(select, "tactician");
  expect(requests).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "Run Bingo Tactician" }));
  const openUtility = async () => {
    await user.click(await screen.findByRole("button", { name: /^Utility breakdown for/ }));
    return within(screen.getByRole("tooltip"));
  };
  const tactics = await openUtility();
  expect(tactics.getByText("Bingo Tactician · Rank 1")).toBeTruthy();
  expect(tactics.getByText("-22")).toBeTruthy();
  expect(tactics.getByText("24 × 0.75 = 18")).toBeTruthy();
  expect(tactics.getByText("Bingo lanes after reply").parentElement?.lastChild?.textContent).toBe("2");

  const checkTiming = async (label: string) => {
    await user.click(await timer());
    const timing = within(screen.getByRole("dialog", { name: "Calculation timing" }));
    expect(timing.getByText(label)).toBeTruthy();
    expect(timing.getAllByText(/ simulation$/)).toHaveLength(1);
    expect(timing.queryByText("Board check and legal moves")).toBeNull();
    expect(timing.queryByText("Reply histograms", { exact: true })).toBeNull();
    await user.click(timing.getByRole("button", { name: "Close dialog" }));
  };
  await checkTiming("Bingo Tactician simulation");

  await user.selectOptions(select, "bingo-hunter");
  await user.click(screen.getByRole("button", { name: "Run Bingo Mercenary" }));
  const mercenary = await openUtility();
  expect(mercenary.getByText("Bingo Mercenary · Rank 1")).toBeTruthy();
  expect(mercenary.queryByText("Expected opponent reply")).toBeNull();
  await user.selectOptions(select, "tactician");
  await user.click(await screen.findByRole("button", { name: "Run another 10 seconds" }));
  expect(requests.map(({ style }) => style)).toEqual(["tactician", "bingo-hunter", "tactician"]);
  expect(requests[2].resumeFrom).toBe(requests[0].id);
  expect((await openUtility()).getByText("Bingo Tactician · Rank 1")).toBeTruthy();
  await user.selectOptions(select, "master");
  await waitFor(() => expect(masterRequests()).toHaveLength(1));
  expect(screen.queryByRole("button", { name: "Run Master" })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Calculation timing,/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: /^Cancel$/ }));
  expect(screen.getByText("Master calculation canceled.")).toBeTruthy();
  expect(masterRequests()).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(masterRequests()).toHaveLength(2);
  act(finishMaster!);
  const master = await openUtility();
  expect(master.getByText("Master · Rank 1")).toBeTruthy();
  expect(master.getByText("Expected follow-up")).toBeTruthy();
  expect(master.getByText("Rack leave difference")).toBeTruthy();
  expect(master.getByText("40 shared tile deals · 30% bingo next turn")).toBeTruthy();
  await checkTiming("Master simulation");
  const masterTime = (await timer()).textContent;
  await user.click(screen.getByRole("button", { name: "All moves" }));
  expect((await timer()).textContent).toBe(allMovesTime);
  await user.click(screen.getByRole("button", { name: "All moves" }));
  expect((await timer()).textContent).toBe(masterTime);
  await user.selectOptions(select, "casual");
  await user.selectOptions(select, "master");
  expect((await timer()).textContent).toBe(masterTime);
  expect(masterRequests()).toHaveLength(2);

  await user.click(rackTile(1));
  await user.keyboard("C{Enter}");
  await waitFor(() => expect(masterRequests()).toHaveLength(3));
  expect(masterRequests()[2].searchId).not.toBe(masterRequests()[1].searchId);
  act(finishMaster!);
  await checkTiming("Master simulation");
});

test("phone analysis taps preview and select a move without offering Play", async () => {
  const user = await start(390);
  await typeRack(user, "CATS");
  await user.keyboard("{Enter}");
  await chooseMoveOption(user, "Analyze");
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

  await chooseMoveOption(user, "Close analysis");
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
  await chooseMoveOption(user, "Analyze");
  const analysis = screen.getByLabelText("Move analysis");
  const moves = screen.getByLabelText("Suggested moves");
  await user.hover(within(moves).getAllByRole("button", { name: /^CATS, / })[0]);

  for (const position of [580, 1160, 1740]) {
    moves.scrollTop = position;
    await act(() => {
      fireEvent.scroll(moves);
    });
    expect(screen.getAllByRole("button", { name: "All moves" })).toHaveLength(1);
    expect(screen.getAllByRole("combobox", { name: "Playing style" })).toHaveLength(1);
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
  await chooseMoveOption(user, "Analyze");
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
      const result = analyzeMoves(new Lexicon(["CATS"]), request, undefined);
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
  await chooseMoveOption(user, "Analyze");
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

test("the first six endgame moves report progress and update Analyze with exact lines for matching settings", async () => {
  const lexicon = new Lexicon([
    "AT",
    "CAT",
    "CATS",
    "ACT",
    "RAT",
    "ART",
    "TAR",
  ]);
  const analyses: AnalysisRequest[] = [];
  let background:
    | { worker: SolverWorker; request: EndgamePrecomputeRequest }
    | undefined;
  let firstSix: string[] = [];
  let rankings = 0;
  class EndgameWorker extends SolverWorker {
    postMessage(
      request:
        | SolverRequest
        | AnalysisRequest
        | EndgamePrecomputeRequest
        | ReplyRequest,
    ) {
      if (!("kind" in request)) {
        analyses.push(request);
        const result = analyzeMoves(lexicon, request, undefined);
        const second = result.forecasts[1];
        if (second && !request.cachedEndgames?.[second.move.id]) {
          second.endgame = null;
          second.endgameLimit = "Foreground endgame position limit reached.";
        }
        queueMicrotask(() => this.onmessage?.({ data: { result } }));
      } else if (request.kind === "reply-summary") {
        queueMicrotask(() =>
          this.onmessage?.({
            data: { id: request.id, kind: request.kind, done: true },
          }),
        );
      } else if (
        request.kind === "reply-line" ||
        request.kind === "reply-detail" ||
        request.kind === "reply-histogram"
      ) {
        return;
      } else if (
        request.kind === "precompute-endgames" ||
        request.kind === "continue-endgames"
      ) {
        background = { worker: this, request };
      } else if (request.kind === "endgame") {
        rankings++;
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
        expect(ranking.checked).toBeGreaterThan(6);
        firstSix = ranking.head.slice(0, 6).map(({ id }) => id);
        queueMicrotask(() =>
          this.onmessage?.({
            data: { kind: "endgame", id: request.id, ranking },
          }),
        );
      } else super.postMessage(request);
    }
  }
  vi.stubGlobal("Worker", EndgameWorker);
  const user = await start();
  const base = current();
  act(() =>
    store.update({
      ...base,
      rack: "CATS",
      template: {
        ...base.template,
        rackSize: 4,
        tileCounts: Object.fromEntries(
          TILE_SYMBOLS.map((tile) => [tile, Number("ACSTZ".includes(tile))]),
        ),
      },
    }),
  );
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await waitFor(() =>
    expect(background?.request.moves.map(({ id }) => id)).toEqual(firstSix),
  );
  const { worker, request } = background!;
  const [first, second] = request.moves;
  expect(await screen.findByText("Solving exact lines · 0/6 checked")).toBeTruthy();
  const spinner = document.querySelector(".calculation-indicator")!;
  expect(spinner.getAttribute("data-phase")).toBe("active");
  expect(
    screen.queryByRole("button", { name: /^Calculation timing/ }),
  ).toBeNull();
  const line = replyEndgameLine(lexicon, request, first, Infinity);
  act(() =>
    worker.onmessage?.({
      data: { id: request.id, moveId: first.id, line, elapsed: 17 },
    }),
  );
  expect(screen.getByText("Solving exact lines · 1/6 checked")).toBeTruthy();
  await chooseMoveOption(user, "Analyze");
  const rows = within(screen.getByLabelText("Suggested moves")).getAllByRole(
    "button",
    { name: /points,/ },
  );
  await user.click(rows[1]);
  await user.click(screen.getByRole("button", { name: "Run analysis" }));
  await screen.findByRole("button", { name: "Refine estimates" });
  expect(analyses[0].candidates.map(({ id }) => id)).toEqual([
    first.id,
    second.id,
  ]);
  expect(analyses[0].cachedEndgames).toEqual({ [first.id]: line });
  const cards = screen.getAllByRole("article", { name: /^Analysis for / });
  await user.click(cards[1].querySelector("summary")!);
  expect(
    within(cards[1]).getByText("Foreground endgame position limit reached."),
  ).toBeTruthy();
  const secondLine = replyEndgameLine(lexicon, request, second, Infinity);
  act(() =>
    worker.onmessage?.({
      data: {
        id: request.id,
        moveId: second.id,
        line: secondLine,
        elapsed: 30,
      },
    }),
  );
  expect(
    within(cards[1]).getByRole("table", { name: "Optimal endgame line" }),
  ).toBeTruthy();
  expect(
    within(cards[1]).queryByText("Foreground endgame position limit reached."),
  ).toBeNull();

  const timeLimit = "Endgame search reached its 5,000 ms time limit.";
  act(() => {
    for (const move of request.moves.slice(2))
      worker.onmessage?.({
        data: {
          id: request.id,
          moveId: move.id,
          limit: timeLimit,
          elapsed: 5000,
        },
      });
    worker.onmessage?.({ data: { id: request.id, done: true } });
  });
  const finished = screen.getByText("2/6 exact lines ready · 4 hit a limit");
  expect(finished.getAttribute("title")).toContain(timeLimit);
  await waitFor(() => expect(spinner.textContent).toBe(""));
  await user.click(
    await screen.findByRole("button", { name: /^Calculation timing/ }),
  );
  const timing = within(
    screen.getByRole("dialog", { name: "Calculation timing" }),
  );
  expect(timing.getByText("Endgame estimates")).toBeTruthy();
  expect(timing.getByText("Exact endgame lines")).toBeTruthy();
  const attempts = within(
    timing.getByRole("region", { name: "Individual endgame solves" }),
  );
  expect(attempts.getAllByText("Limit reached", { exact: false })).toHaveLength(
    4,
  );
  expect(
    attempts.getByText("17 ms").previousElementSibling?.textContent,
  ).toContain(first.word);
  expect(
    attempts.getByText("30 ms").previousElementSibling?.textContent,
  ).toContain(second.word);
  expect(attempts.getAllByText("5.00 s")).toHaveLength(4);
  await user.click(timing.getByRole("button", { name: "Close dialog" }));

  const resume = screen.getByRole("button", { name: "Run another 10 seconds" });
  expect(worker.terminate).not.toHaveBeenCalled();
  await user.click(resume);
  const continued = background!.request;
  expect(continued.kind).toBe("continue-endgames");
  expect(continued.moves.map((move) => move.id)).toEqual(
    request.moves.slice(2).map((move) => move.id),
  );
  expect(
    screen.queryByRole("button", { name: "Run another 10 seconds" }),
  ).toBeNull();
  expect(screen.getByText("Solving exact lines · 2/6 checked")).toBeTruthy();
  // A late completion from the previous slice must not overwrite this run.
  act(() => worker.onmessage?.({ data: { id: request.id, done: true } }));
  expect(screen.getByText("Solving exact lines · 2/6 checked")).toBeTruthy();
  act(() => {
    for (const move of continued.moves)
      worker.onmessage?.({
        data: {
          id: continued.id,
          moveId: move.id,
          limit: timeLimit,
          elapsed: 10000,
        },
      });
    worker.onmessage?.({ data: { id: continued.id, done: true } });
  });
  expect(
    screen.getByRole("button", { name: "Run another 10 seconds" }),
  ).toBeTruthy();
  expect(
    screen.getByText("2/6 exact lines ready · 4 hit a limit"),
  ).toBeTruthy();
  await user.click(
    screen.getByRole("button", { name: "Run another 10 seconds" }),
  );
  const repeated = background!.request;
  expect(repeated.id).not.toBe(continued.id);
  act(() => {
    for (const move of repeated.moves)
      worker.onmessage?.({
        data: {
          id: repeated.id,
          moveId: move.id,
          line: replyEndgameLine(lexicon, repeated, move, Infinity),
          elapsed: 10,
        },
      });
    worker.onmessage?.({ data: { id: repeated.id, done: true } });
  });
  expect(screen.getByText("6/6 exact lines ready")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Run another 10 seconds" }),
  ).toBeNull();
  expect(worker.terminate).toHaveBeenCalledOnce();

  await user.selectOptions(
    screen.getByRole("combobox", { name: "Prior scoreless turns" }),
    "1",
  );
  await user.click(screen.getByRole("button", { name: "Run analysis" }));
  await screen.findByRole("button", { name: "Refine estimates" });
  expect(analyses[1].cachedEndgames).toBeUndefined();

  await user.click(
    screen.getByRole("button", { name: "Close possible moves" }),
  );
  expect(screen.queryByText(/exact lines ready/)).toBeNull();
  await user.click(screen.getByRole("button", { name: "Find moves" }));
  expect(await screen.findByText("6/6 exact lines ready")).toBeTruthy();
  expect(rankings).toBe(1);
  expect(background?.request).toBe(repeated);

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
          const result = analyzeMoves(lexicon, request, undefined);
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
    await chooseMoveOption(user, "Analyze");
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

test("the retired French Scrabble board opens as a saved game and stays out of New game", async () => {
  remote.dictionaries.push({
    id: "french",
    name: "Grammalecte 7.7",
    count: 8,
    builtin: false,
    description: "",
  });
  remote.games[0].template = {
    ...PRESETS[0],
    id: "scrabble-fr",
    name: "French Scrabble",
    rules: "scrabble-fr",
    tileCounts: undefined,
  };
  remote.games[0].dictionaryId = "french";
  remote.games[0].revision++;
  const user = await start();
  const options = await openGameOptions(user);
  expect(options.getByRole<HTMLSelectElement>("combobox", { name: "Game dictionary" }).value).toBe("french");
  await user.click(options.getByRole("button", { name: "Close dialog" }));
  await user.click(screen.getByRole("button", { name: "New game" }));
  const dialog = within(screen.getByRole("dialog", { name: "New game" }));
  expect(dialog.queryByRole("option", { name: /French Scrabble/ })).toBeNull();
  expect(current().template.rules).toBe("scrabble-fr");
});

test("a custom board using French Scrabble scoring still prompts for a French word list", async () => {
  remote.templates.push({
    ...PRESETS[0],
    id: "custom-fr",
    name: "Custom board",
    rules: "scrabble-fr",
    tileCounts: undefined,
    builtin: false,
  });
  const user = await start();
  await user.click(screen.getByRole("button", { name: "New game" }));
  const dialog = within(screen.getByRole("dialog", { name: "New game" }));
  const layout = dialog.getByRole("combobox", { name: "Board layout" });
  const dictionary = dialog.getByRole<HTMLSelectElement>("combobox", { name: "Word list" });
  const create = dialog.getByRole<HTMLButtonElement>("button", { name: "Create game" });
  await user.selectOptions(layout, "custom-fr");
  expect(dictionary.value).toBe("");
  expect(create.disabled).toBe(true);
  expect(dialog.getByText(/import Grammalecte under Word lists/i)).toBeTruthy();
  await user.selectOptions(dictionary, "test");
  expect(create.disabled).toBe(false);
});

test("Classic Lexulous offers its own language choices and saves the selected tile set", async () => {
  remote.dictionaries.push(
    { id: "csw", name: "CSW24", count: 8, builtin: false, description: "" },
    { id: "grammalecte", name: "Grammalecte 7.7", count: 8, builtin: false, description: "" },
    { id: "morph-it", name: "italian_it_it_morphit", count: 8, builtin: false, description: "" },
  );
  const user = await start();
  await user.click(screen.getByRole("button", { name: "New game" }));
  const dialog = within(screen.getByRole("dialog", { name: "New game" }));
  const layout = dialog.getByRole<HTMLSelectElement>("combobox", { name: "Board layout" });
  const dictionary = dialog.getByRole<HTMLSelectElement>("combobox", { name: "Word list" });
  const language = { name: "Language" };
  expect(dialog.queryByRole("combobox", language)).toBeNull();
  await user.selectOptions(layout, "super-lexulous");
  expect(dialog.queryByRole("combobox", language)).toBeNull();
  await user.selectOptions(layout, "lexulous");
  const picker = dialog.getByRole<HTMLSelectElement>("combobox", language);
  expect(picker.value).toBe("en-US");
  expect(dictionary.value).toBe("test");
  await user.selectOptions(picker, "en-GB");
  expect(dictionary.value).toBe("csw");
  await user.selectOptions(picker, "fr");
  expect(dictionary.value).toBe("grammalecte");
  await user.selectOptions(picker, "it");
  expect(dictionary.value).toBe("morph-it");

  await user.click(dialog.getByRole("button", { name: "Create game" }));
  await waitFor(() => expect(remote.games).toHaveLength(2));
  const saved = remote.games[1];
  expect(saved.dictionaryId).toBe("morph-it");
  expect(saved.template.id).toBe("lexulous");
  expect(saved.template.rules).toBe("lexulous-it");
  expect(saved.template.tileCounts?.O).toBe(15);
});

test("Wordfeud chooses a French list for its own tile set and allows an override", async () => {
  const imported = (id: string, name: string) => ({
    id, name, count: 8, builtin: false, description: "",
  });
  remote.dictionaries.push(imported("lexulous-fr", "Lexulous French"));
  const user = await start();
  await user.click(screen.getByRole("button", { name: "New game" }));
  const dialog = within(screen.getByRole("dialog", { name: "New game" }));
  const layout = dialog.getByRole("combobox", { name: "Board layout" });
  const dictionary = dialog.getByRole<HTMLSelectElement>("combobox", { name: "Word list" });
  await user.selectOptions(layout, "wordfeud");
  const picker = dialog.getByRole<HTMLSelectElement>("combobox", { name: "Language" });
  expect(picker.value).toBe("en");
  expect(dictionary.value).toBe("test");
  await user.selectOptions(picker, "fr");
  expect(dictionary.value).toBe("");

  remote.dictionaries.push(imported("grammalecte", "Grammalecte 7.7"));
  await act(() => store.refresh());
  expect(dictionary.value).toBe("grammalecte");
  remote.dictionaries.push(imported("wordfeud-fr", "Wordfeud Français"));
  await act(() => store.refresh());
  expect(dictionary.value).toBe("wordfeud-fr");
  await user.selectOptions(layout, "lexulous");
  expect(dialog.getByRole<HTMLSelectElement>("combobox", { name: "Language" }).value).toBe("en-US");
  await user.selectOptions(layout, "wordfeud");
  expect(dialog.getByRole<HTMLSelectElement>("combobox", { name: "Language" }).value).toBe("fr");
  await user.selectOptions(dictionary, "grammalecte");
  await user.click(dialog.getByRole("button", { name: "Create game" }));
  await waitFor(() => expect(remote.games).toHaveLength(2));
  expect(remote.games[1].dictionaryId).toBe("grammalecte");
  expect(remote.games[1].template.rules).toBe("wordfeud-fr");
  expect(remote.games[1].template.tileCounts?.E).toBe(14);
});

test("new game suggests distinct opponents by the end date or start date within two weeks", async () => {
  function daysAgo(days: number) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return localDate(date);
  }
  remote.profiles.push({ id: "other", name: "Other profile" });
  remote.games.push(
    { ...game(), id: "active", name: "Casey", startedOn: daysAgo(14) },
    {
      ...game(),
      id: "finished",
      name: "Morgan",
      startedOn: daysAgo(60),
      archived: true,
      scoring: {
        ...emptyScoring(),
        end: { manual: true, endedOn: daysAgo(8) },
      },
    },
    { ...game(), id: "duplicate", name: "morgan", startedOn: daysAgo(9) },
    { ...game(), id: "stale", name: "Taylor", startedOn: daysAgo(15) },
    { ...game(), id: "future", name: "Sky", startedOn: daysAgo(-1) },
    {
      ...game(),
      id: "other-profile",
      profileId: "other",
      name: "Sam",
      startedOn: daysAgo(0),
    },
  );
  const user = await start();
  await act(() => store.refresh());
  await user.click(screen.getByRole("button", { name: "New game" }));
  const setup = within(screen.getByRole("dialog", { name: "New game" }));
  const opponent = setup.getByRole<HTMLInputElement>("combobox", {
    name: "Opponent",
  });
  await user.click(opponent);
  const list = () => within(setup.getByRole("listbox", { name: "Recent opponents" }));
  expect(list().getAllByRole("option").map(({ textContent }) => textContent))
    .toEqual(["Morgan", "Casey"]);

  await user.type(opponent, "ORG");
  expect(list().getAllByRole("option")).toHaveLength(1);
  expect(list().getByRole("option", { name: "Morgan" })).toBeTruthy();
  await user.keyboard("{ArrowDown}{Enter}");
  expect(opponent.value).toBe("Morgan");
  expect(setup.queryByRole("listbox")).toBeNull();

  await user.clear(opponent);
  await user.type(opponent, "Cas");
  const option = list().getByRole("option", { name: "Casey" });
  // WebKit can blur the field before activating the tapped suggestion.
  fireEvent.pointerDown(option, { pointerType: "touch" });
  act(() => opponent.blur());
  expect(list().getByRole("option", { name: "Casey" })).toBe(option);
  fireEvent.click(option);
  expect(opponent.value).toBe("Casey");
  expect(setup.queryByRole("listbox")).toBeNull();

  await user.click(opponent);
  expect(list().getByRole("option", { name: "Casey" })).toBeTruthy();
  await user.tab();
  expect(document.activeElement).toBe(setup.getByRole("combobox", { name: "Platform" }));
  expect(setup.queryByRole("listbox")).toBeNull();

  await user.clear(opponent);
  await user.type(opponent, "A new opponent");
  expect(setup.queryByRole("listbox")).toBeNull();
  await user.click(setup.getByRole("button", { name: "Create game" }));
  await screen.findByRole("heading", { name: "A new opponent" });
});

test("new game keeps optional details collapsed and saves their edits", async () => {
  const user = await start();
  await user.click(screen.getByRole("button", { name: "New game" }));
  const dialog = screen.getByRole("dialog", { name: "New game" });
  const setup = within(dialog);
  const opponent = setup.getByRole("combobox", { name: "Opponent" });
  expect(document.activeElement).toBe(opponent);
  const details = dialog.querySelector("details")!;
  expect(details.open).toBe(false);

  await user.type(opponent, "Club opponent");
  await user.selectOptions(setup.getByRole("combobox", { name: "Platform" }), "Wordfeud");
  await user.selectOptions(setup.getByRole("combobox", { name: "Platform" }), "");
  expect(setup.getByRole("combobox", { name: "Board layout" })).toHaveProperty("value", "wordfeud");
  await user.click(setup.getByText("Game details", { selector: "summary" }));
  fireEvent.change(setup.getByLabelText("Date"), {
    target: { value: "2026-11-01" },
  });
  await user.type(setup.getByLabelText("Notes"), "Saturday club game");
  await user.click(setup.getByText("Game details", { selector: "summary" }));
  expect(details.open).toBe(false);
  await user.click(setup.getByRole("button", { name: "Create game" }));
  await screen.findByRole("heading", { name: "Club opponent" });
  const created = remote.games.find(({ name }) => name === "Club opponent");
  expect(created?.platform).toBeUndefined();
  expect(created).toMatchObject({
    startedOn: "2026-11-01",
    notes: "Saturday club game",
    template: { id: "wordfeud" },
  });
});

test("new game board follows the platform until the board is picked manually", async () => {
  const user = await start();
  const openSetup = async () => {
    await user.click(screen.getByRole("button", { name: "New game" }));
    return within(screen.getByRole("dialog", { name: "New game" }));
  };
  const setup = await openSetup();
  const board = setup.getByRole("combobox", {
    name: "Board layout",
    description:
      "Sets the game rules, board and rack sizes, tile bag counts, and scoring bonuses.",
  });
  const platform = setup.getByRole("combobox", { name: "Platform" });
  await user.selectOptions(platform, "Wordfeud");
  expect(board).toHaveProperty("value", "wordfeud");
  await user.selectOptions(platform, "NYT Crossplay");
  expect(board).toHaveProperty("value", "crossplay");
  await user.selectOptions(board, "super");
  await user.selectOptions(platform, "In person");
  expect(board).toHaveProperty("value", "super");
  await user.type(setup.getByLabelText("Opponent"), "Preset check");
  await user.click(setup.getByRole("button", { name: "Create game" }));
  await screen.findByRole("heading", { name: "Preset check" });
  expect(remote.games.find(({ name }) => name === "Preset check")?.template.id).toBe("super");

  const next = await openSetup();
  await user.selectOptions(next.getByRole("combobox", { name: "Platform" }), "Words With Friends");
  expect(next.getByRole("combobox", { name: "Board layout" })).toHaveProperty("value", "wwf");
});

test("Super Lexulous can be created under the Lexulous platform", async () => {
  const user = await start();
  await user.click(screen.getByRole("button", { name: "New game" }));
  const setup = within(screen.getByRole("dialog", { name: "New game" }));
  const platform = setup.getByRole("combobox", { name: "Platform" });
  const layout = setup.getByRole("combobox", { name: "Board layout" });
  await user.selectOptions(platform, "Lexulous");
  expect(layout).toHaveProperty("value", "lexulous");
  await user.selectOptions(layout, "super-lexulous");
  expect(platform).toHaveProperty("value", "Lexulous");
  await user.type(setup.getByLabelText("Opponent"), "Super opponent");
  await user.click(setup.getByRole("button", { name: "Create game" }));
  await screen.findByRole("heading", { name: "Super opponent" });
  const created = remote.games.find(({ name }) => name === "Super opponent")!;
  expect(created.platform).toBe("Lexulous");
  expect(created.template.id).toBe("super-lexulous");
  expect(created.template.rules).toBe("lexulous");
  expect(created.board).toHaveLength(441);
  expect(created.template.rackSize).toBe(8);
  expect(Object.values(created.template.tileCounts!).reduce((a, b) => a + b, 0)).toBe(178);
  expect(screen.getAllByRole("button", { name: /^Rack tile \d:/ })).toHaveLength(8);
});

test("profile replies check only missing ranked moves and keep timing on that view", async () => {
  type ReplySummary = Extract<ReplyRequest, { kind: "reply-summary" }>;
  const batches: { worker: SolverWorker; request: ReplySummary }[] = [];
  let expected: string[] = [];
  const distribution: ReplyDistribution = {
    kind: "distribution",
    count: 24, outscored: 0, mean: 20, difference: 0, exact: false,
    buckets: [0, 24, 0, 0, 0], discordant: [0, 0, 0, 0, 0],
    reference: { mean: 20, buckets: [0, 24, 0, 0, 0] },
  };
  class RankedReplyWorker extends SolverWorker {
    postMessage(request: SolverRequest | ReplyRequest) {
      if (request.kind === "reply-summary") {
        batches.push({ worker: this, request });
        return;
      }
      if (request.kind === "board-odds") {
        queueMicrotask(() => this.onmessage?.({ data: {
          id: request.id, kind: request.kind,
          odds: { byMove: {}, checked: 0, total: request.candidates.length, bagSize: request.bagSize },
        } }));
        return;
      }
      if (request.kind === "reply-detail" || request.kind === "reply-line" || request.kind === "reply-histogram")
        return;
      if (request.kind === "page" && request.query.profile) {
        const index = this.results.get(request.searchId);
        if (index && !index.hasProfile(request.query)) {
          const ranked = [...index.moves.slice(-11), ...index.moves.slice(0, -11)];
          const rawIds = new Set(index.moves.slice(0, REPLY_LIMIT).map(({ id }) => id));
          expected = ranked.slice(0, REPLY_LIMIT).filter(({ id }) => !rawIds.has(id)).map(({ id }) => id);
          const end = performance.timeOrigin + performance.now();
          index.setProfile(request.query, ranked.map((move) => ({ move, utility: {
            total: move.score, points: move.score, premium: 0, visibility: 1, appeal: 1, leave: 0, goingOut: 0,
          } })), { start: end - 42, end });
        }
      }
      super.postMessage(request);
    }
  }
  const finish = ({ worker, request }: typeof batches[number]) => act(() => {
    for (const { id: moveId } of request.candidates) {
      worker.onmessage?.({ data: { id: request.id, kind: request.kind, moveId, result: distribution } });
    }
    worker.onmessage?.({ data: { id: request.id, kind: request.kind, done: true } });
  });

  vi.stubGlobal("Worker", RankedReplyWorker);
  const user = await start();
  await typeRack(user, "CATSRE");
  await user.keyboard("{Enter}");
  await waitFor(() => expect(batches).toHaveLength(1));
  finish(batches[0]);
  const timer = () => screen.findByRole("button", { name: /^Calculation timing,/ });
  const baseTime = (await timer()).textContent;
  const allMoves = screen.getByRole("button", { name: "All moves" });
  const style = screen.getByRole("combobox", { name: "Playing style" });
  await user.click(screen.getByRole("button", { name: "Search possible moves" }));
  const input = screen.getByRole("textbox", { name: "Filter moves" });
  fireEvent.change(input, { target: { value: "^CAT$" } });
  await user.selectOptions(style, "learner");
  await waitFor(() => expect(batches).toHaveLength(2));
  const [opening, profile] = batches;
  expect(expected.length).toBeGreaterThan(0);
  expect(profile.request.candidates.map(({ id }) => id)).toEqual(expected);
  expect(profile.request.candidates.some(({ word }) => word !== "CAT")).toBe(true);
  expect(profile.worker).toBe(opening.worker);
  expect(profile.request.workerLimit).toBe(opening.request.workerLimit);
  expect(profile.request.reference.id).toBe(opening.request.reference.id);

  await user.click(allMoves);
  expect((await timer()).textContent).toBe(baseTime);
  finish(profile);
  await user.click(allMoves);
  const openTiming = async () => {
    await user.click(await timer());
    return within(screen.getByRole("dialog", { name: "Calculation timing" }));
  };
  const profileTiming = await openTiming();
  expect(profileTiming.getByText("Playing style ranking").nextElementSibling?.textContent).toBe("42 ms");
  expect(profileTiming.getByText("Playing style reply histograms")).toBeTruthy();
  expect(profileTiming.queryByText("Board check and legal moves")).toBeNull();
  expect(profileTiming.queryByText("Reply histograms", { exact: true })).toBeNull();
  await user.click(profileTiming.getByRole("button", { name: "Close dialog" }));
  await chooseMoveOption(user, /^Shortlist/);
  const shortlistTiming = await openTiming();
  const shortlistTime = shortlistTiming.getByText("Shortlist ranking").nextElementSibling?.textContent;
  expect(shortlistTiming.getByText("Total elapsed time").nextElementSibling?.textContent).toBe(shortlistTime);
  expect(shortlistTiming.getAllByRole("term").map((term) => term.textContent)).toEqual([
    "Total elapsed time", "Shortlist ranking",
  ]);
  await user.click(shortlistTiming.getByRole("button", { name: "Close dialog" }));
  await chooseMoveOption(user, /^Shortlist/);
  expect((await openTiming()).getByText("Playing style reply histograms")).toBeTruthy();
  expect(batches).toHaveLength(2);
});

test("calculation timing waits for reply histograms and stays fixed for follow-up requests", async () => {
  type ReplySummary = Extract<ReplyRequest, { kind: "reply-summary" }>;
  type BoardOdds = Extract<SolverRequest, { kind: "board-odds" }>;
  let replies: { worker: SolverWorker; request: ReplySummary } | undefined;
  let boardOdds: { worker: SolverWorker; request: BoardOdds } | undefined;
  let detail: { worker: SolverWorker; request: ReplyRequest } | undefined;
  let solves = 0;
  class DeferredReplyWorker extends SolverWorker {
    postMessage(request: SolverRequest | ReplyRequest) {
      if (request.kind === "reply-summary") replies = { worker: this, request };
      else if (request.kind === "board-odds") boardOdds = { worker: this, request };
      else if (request.kind === "reply-detail" || request.kind === "reply-line")
        detail = { worker: this, request };
      else if (request.kind !== "reply-histogram") {
        if (request.kind === "solve") solves++;
        super.postMessage(request);
      }
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
    outscored: 0,
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
    data: {
      id: detail!.request.id,
      kind: detail!.request.kind,
      limit: { reason: "analysis-time", move: request.reference, rack: "AENRST?" },
    },
  }));
  const { word, row, col, direction } = request.reference;
  expect(screen.getByText(
    `Hit the 25-second analysis time limit after ${word} at ${moveLocation({ row, col, direction })} ${direction} with opponent rack AENRST? (? = blank).`,
  )).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Calculation timing/ }).textContent).toBe(total);

  const checkedBoard = boardOdds?.request;
  await user.click(screen.getByRole("button", { name: "Close possible moves" }));
  expect(screen.queryByRole("button", { name: /^Calculation timing/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Find moves" }));
  expect((await screen.findByRole("button", { name: /^Calculation timing/ })).textContent).toBe(total);
  expect(screen.getAllByRole("button", { name: /^CATS, / }).length).toBeGreaterThan(0);
  expect(replies?.request).toBe(request);
  expect(boardOdds?.request).toBe(checkedBoard);
  expect(solves).toBe(1);

  await user.click(screen.getByRole("button", { name: "Close possible moves" }));
  await typeRack(user, "DOG");
  await user.click(screen.getByRole("button", { name: "Find moves" }));
  await screen.findAllByRole("button", { name: /^DOG, / });
  expect(solves).toBe(2);
});

test.each(["reference", "alternatives"] as const)(
  "reply limits identify the %s moves and sampled racks",
  async (failed) => {
    type ReplySummary = Extract<ReplyRequest, { kind: "reply-summary" }>;
    let replies: { worker: SolverWorker; request: ReplySummary } | undefined;
    class LimitedReplyWorker extends SolverWorker {
      postMessage(request: SolverRequest | ReplyRequest) {
        if (request.kind === "reply-summary") replies = { worker: this, request };
        else if (request.kind !== "reply-detail" && request.kind !== "reply-line" && request.kind !== "reply-histogram")
          super.postMessage(request);
      }
    }
    vi.stubGlobal("Worker", LimitedReplyWorker);
    const user = await start();
    await typeRack(user, "CATS");
    await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
    await waitFor(() => expect(replies).toBeDefined());
    const { worker, request } = replies!;
    const [first, second] = request.candidates.filter(({ id }) => id !== request.reference.id);
    const publish = (extra: Partial<ReplyWorkerMessage>) =>
      worker.onmessage?.({ data: { id: request.id, kind: request.kind, ...extra } });
    act(() => {
      if (failed === "reference") {
        publish({ done: true, limit: { reason: "nodes", move: request.reference, rack: "AENRST?" } });
      } else {
        publish({ moveId: first.id, limit: { reason: "moves", move: first, rack: "AENRST?" } });
        publish({ moveId: second.id, limit: { reason: "rack-time", move: second, rack: "EIINSTU" } });
        publish({ done: true });
      }
    });
    const moveLabel = ({ word, row, col, direction }: ReplySummary["reference"]) =>
      `${word} at ${moveLocation({ row, col, direction })} ${direction}`;
    if (failed === "reference") {
      expect(screen.getByText(
        `Hit the 2,000,000 search node limit after ${moveLabel(request.reference)} with opponent rack AENRST? (? = blank).`,
      )).toBeTruthy();
    } else {
      const summary = screen.getByText("2 opponent reply searches hit a limit");
      await user.click(summary);
      expect(summary.closest("details")?.open).toBe(true);
      expect(screen.getByText(
        `Hit the 150,000 legal move limit after ${moveLabel(first)} with opponent rack AENRST? (? = blank).`,
      )).toBeTruthy();
      expect(screen.getByText(
        `Hit the 2-second per-rack time limit after ${moveLabel(second)} with opponent rack EIINSTU.`,
      )).toBeTruthy();
    }
  },
);

test("reply histograms keep the score leaders, add extra candidates, and check another move on demand", async () => {
  type MovesMessage = Extract<SolverMessage, { kind: "moves" }>;
  type SummaryRequest = Extract<ReplyRequest, { kind: "reply-summary" }>;
  type HistogramRequest = Extract<ReplyRequest, { kind: "reply-histogram" }>;
  type DetailRequest = Extract<ReplyRequest, { kind: "reply-detail" }>;
  let solved: { send: (data: SolverMessage) => void; message: MovesMessage } | undefined;
  let automatic: { worker: SolverWorker; request: SummaryRequest } | undefined;
  let manual: { worker: SolverWorker; request: HistogramRequest } | undefined;
  let detail: DetailRequest | undefined;
  class HistogramWorker extends SolverWorker {
    postMessage(request: SolverRequest | ReplyRequest) {
      if (request.kind === "reply-summary") {
        automatic = { worker: this, request };
      } else if (request.kind === "reply-histogram") {
        manual = { worker: this, request };
      } else if (request.kind === "reply-detail") {
        detail = request;
      } else if (request.kind === "solve") {
        const original = this.onmessage;
        const send = (data: SolverMessage) => original?.({ data });
        this.onmessage = (event) => {
          const message = event.data as SolverMessage;
          if (message.kind === "moves") {
            solved = { send, message };
            send({ ...message, replyCandidatesPending: true });
          } else if (message.kind !== "defense" && message.kind !== "rack-odds") {
            original?.(event);
          }
        };
        super.postMessage(request);
      } else if (request.kind !== "reply-line") {
        super.postMessage(request);
      }
    }
  }
  vi.stubGlobal("Worker", HistogramWorker);
  const user = await start();
  await typeRack(user, "CATS");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await waitFor(() => expect(solved).toBeDefined());
  expect(await screen.findAllByRole("button", { name: /^CATS, / })).not.toHaveLength(0);
  expect(automatic).toBeUndefined();
  const { send, message } = solved!;
  const { head } = message.results;
  const [block, leave, requested] = head.slice(REPLY_LIMIT);
  act(() => send({
    id: message.id,
    kind: "defense",
    elapsed: 2,
    replyCandidates: [{ move: block, reason: "block" }, { move: leave, reason: "leave" }],
  }));
  await waitFor(() => expect(automatic).toBeDefined());
  const { worker, request } = automatic!;
  expect(request.candidates.map(({ id }) => id)).toEqual(head.slice(0, REPLY_LIMIT + 2).map(({ id }) => id));
  expect(request.reference.id).toBe(head[0].id);
  const distribution: ReplyDistribution = {
    kind: "distribution",
    count: REPLY_SAMPLES,
    outscored: 0,
    mean: 20,
    difference: 0,
    exact: false,
    buckets: [0, REPLY_SAMPLES, 0, 0, 0],
    discordant: [0, 0, 0, 0, 0],
    reference: { mean: 20, buckets: [0, REPLY_SAMPLES, 0, 0, 0] },
  };
  act(() => worker.onmessage?.({
    data: { id: request.id, kind: request.kind, done: true },
  }));
  await user.click(screen.getByRole("button", { name: "Search possible moves" }));
  await user.type(screen.getByRole("textbox", { name: "Filter moves" }), "AT");
  expect(await screen.findByText("Premium block")).toBeTruthy();
  expect(screen.getByText("Better leave")).toBeTruthy();
  const at = moveLocation(requested);
  const label = `Check reply histogram for ${requested.word} at ${at} ${requested.direction}`;
  await user.click(screen.getByRole("button", { name: label }));
  expect(manual?.request.candidate.id).toBe(requested.id);
  expect(manual?.request.reference.id).toBe(request.reference.id);
  expect(screen.getByText("Checking reply histogram…")).toBeTruthy();
  act(() => manual!.worker.onmessage?.({
    data: { id: manual!.request.id, kind: "reply-histogram", result: distribution },
  }));
  expect(screen.queryByRole("button", { name: label })).toBeNull();
  const preview = screen.getByRole("region", { name: `Reply after ${requested.word}` });
  await user.click(within(preview).getByRole("button", { name: "Heatmap" }));
  expect(detail?.candidate.id).toBe(requested.id);
  expect(detail?.samples).toBe(REPLY_SAMPLES);
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

test.each(["narrow", "wide"])("bingo odds controls in %s results and streaming in wide results", async (layout) => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
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
          request.kind !== "reply-line" &&
          request.kind !== "reply-histogram"
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
  const search = screen.getByRole("button", { name: "Search possible moves" });
  const indicator = search.closest<HTMLElement>(".calculation-indicator");
  expect(indicator?.dataset.phase).toBe("active");
  await user.click(search);
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Filter moves" }));
  expect(indicator?.dataset.phase).toBe("active");
  await user.keyboard("{Escape}");
  expect(document.activeElement).toBe(search);
  expect(screen.queryByRole("combobox", { name: "Sort moves" })).toBeNull();
  const options = await openMoveOptions(user);
  expect(!!options.queryByRole("button", { name: "Check bingo after your play" }))
    .toBe(layout === "wide");
  if (layout === "narrow") return;

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

  await openMoveOptions(user);
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
  shellWidth = 1200;
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("ResizeObserver", ShellResizeObserver);
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
          id: body.creationId ?? `g${remote.games.length}`,
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
async function start(width = shellWidth) {
  shellWidth = width;
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: /First game/ });
  return user;
}
const entry = () => screen.getByRole("textbox", { name: "Type on board" });
const navLink = (name: string) => screen.getByRole("link", { name });
const cell = (name: string) => screen.getByRole("button", { name });
async function openGameOptions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(cell("Game options"));
  return within(screen.getByRole("dialog", { name: "Game options" }));
}

async function openGameManagement(user: ReturnType<typeof userEvent.setup>) {
  const options = await openGameOptions(user);
  await user.click(options.getByText("Manage game", { selector: "summary" }));
  return options;
}
const trackedScore = () =>
  screen.queryByRole("button", { name: "Replay finish animation" }) ??
  screen.getByRole("group", { name: "Tracked score" });
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

test.each([1200, 390])("board exchange focuses the compacted rack and Undo restores both exchanges at %ipx", async (width) => {
  const user = await start(width);
  const board = within(screen.getByRole("region", { name: "Game board" }));
  const controls = ["Pass", "Exchange", "Define"];
  const strip = board.getByRole("button", { name: "Define" }).closest(".direct-entry-tools")!;
  expect([...strip.querySelectorAll("button")]
    .map((button) => button.getAttribute("aria-label") ?? "")
    .filter((label) => controls.includes(label))).toEqual(controls);
  expect(board.queryByText("Your turn")).toBeNull();
  await typeRack(user, "IJNATRC");
  await user.click(cell("Exchange"));
  expect(strip.contains(screen.getByText("Select tiles to exchange"))).toBe(true);
  const rackExchange = within(screen.getByRole("group", { name: "Exchange your tiles" }));
  expect(rackExchange.getByRole("status").textContent).toBe("0 selected");
  const exchange = cell("Record exchange");
  expect((exchange as HTMLButtonElement).disabled).toBe(true);
  await user.click(rackTile(2));
  await user.click(rackTile(7));
  expect(rackExchange.getByRole("status").textContent).toBe("2 selected");
  expect(rackTile(2).getAttribute("aria-pressed")).toBe("true");
  expect(current().rack).toBe("IJNATRC");
  await user.click(exchange);
  expect(screen.queryByText("Select tiles to exchange")).toBeNull();
  expect(current().rack).toBe("INATR");
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Rack letters" }));
  expect(rackTile(6).classList.contains("selected")).toBe(true);
  expect(screen.getByRole("group", { name: /Record turn · Opponent/ })).toBeTruthy();
  await user.keyboard("OU");
  expect(current().rack).toBe("INATROU");

  await user.click(cell("Exchange"));
  const counts = within(screen.getByRole("group", { name: "How many tiles did your opponent exchange?" }));
  await user.click(counts.getByRole("button", { name: "3" }));
  expect(counts.getByRole("button", { name: "3" }).getAttribute("aria-pressed")).toBe("true");
  await user.click(cell("Record exchange"));
  expect(current().trackedMoves?.at(-1)?.action).toEqual({ kind: "exchange", count: 3 });
  expect(current().rack).toBe("INATROU");
  await user.click(cell("Undo"));
  expect(current().rack).toBe("INATROU");
  expect(screen.getByRole("group", { name: /Record turn · Opponent/ })).toBeTruthy();
  await user.click(cell("Undo"));
  expect(current().rack).toBe("IJNATRC");
  expect(current().trackedMoves).toHaveLength(0);
  await user.click(cell("Redo"));
  expect(current().rack).toBe("INATROU");
});

test("Pass records immediately for either player and an unknown opponent exchange can be undone", async () => {
  const user = await start();
  await user.click(cell("Your turn. Switch active player"));
  await user.click(cell("Pass"));
  expect(current().trackedMoves?.at(-1)).toMatchObject({ player: "opponent", action: { kind: "pass" }, score: 0 });
  expect(screen.queryByRole("dialog")).toBeNull();
  await user.click(cell("Pass"));
  expect(current().trackedMoves?.at(-1)).toMatchObject({ player: "you", action: { kind: "pass" }, score: 0 });
  await user.click(cell("Exchange"));
  await user.click(cell("Unknown"));
  await user.click(cell("Record exchange"));
  expect(current().trackedMoves?.at(-1)).toMatchObject({ player: "opponent", action: { kind: "exchange" } });
  await user.click(cell("Undo"));
  expect(current().trackedMoves).toHaveLength(2);
  expect(screen.getByRole("group", { name: /Record turn · Opponent/ })).toBeTruthy();
  await user.click(cell("Undo"));
  expect(current().trackedMoves).toHaveLength(1);
  expect(screen.getByRole("group", { name: /Record turn · Your/ })).toBeTruthy();
});

const selectedCell = () =>
  document
    .querySelector(".board-entry .square.selected")
    ?.getAttribute("data-cell");
function boardDirection() {
  const arrow = document.querySelector(".board-entry .entry-arrow svg");
  if (arrow?.classList.contains("lucide-arrow-right")) return "Across";
  if (arrow?.classList.contains("lucide-arrow-down")) return "Down";
}

function replayFixture(opponentBlank = false, ownRack = "CATEINS") {
  const base = { ...game(), rack: ownRack };
  const move = solve(new Lexicon(["CAT"]), base.board, base.rack, base.template)
    .find((move) => move.word === "CAT" && move.direction === "across" && move.tiles[0].index === 111)!;
  const first = { ...playTrackedMove(base, move), rack: "EINSOUA" };
  const board = [...first.board];
  board[83] = opponentBlank ? "a" : "A";
  board[98] = "R";
  return {
    ...recordOpponentPlay(new BoardEditHistory().apply(first, board, "enter")),
    revision: 1,
  };
}

test.each([1200, 390])("older replay placements can be reanalyzed and previewed at %ipx", async (width) => {
  const work: { worker: ReanalysisWorker; request: ReplayStyleRequest }[] = [];
  class ReanalysisWorker extends SolverWorker {
    postMessage(request: SolverRequest) {
      if (request.kind === "replay-style") work.push({ worker: this, request });
      else super.postMessage(request);
    }
  }
  function finish({ worker, request }: (typeof work)[number]) {
    const moves = solve(new Lexicon(["CAT", "ACT"]), request.board, request.rack, request.template);
    const played = moves.find((move) =>
      move.word === request.recorded.word && move.direction === request.recorded.direction &&
      move.tiles[0].index === request.recorded.tiles[0].index)!;
    const other = moves.find(({ word }) => word === "ACT")!;
    const utility = { rank: 1, total: 15, points: 15, premium: 0, visibility: 1, appeal: 1, leave: 1.5, goingOut: 0, premiumLane: -1.25 };
    const data: SolverMessage = {
      id: request.id, kind: "replay-style", result: {
        availablePlacement: true,
        explanation: {
          kind: "play", style: request.style, recommended: false,
          played: styleCandidate(played, { ...utility, rank: 2 }),
          alternative: styleCandidate(other, utility),
        },
      },
    };
    act(() => worker.onmessage?.({ data }));
  }
  vi.stubGlobal("Worker", ReanalysisWorker);
  remote.games[0] = replayFixture();
  history.replaceState(null, "", "/games/g?move=1");
  const user = await start(width);
  await user.click(cell("Why?"));
  const explanation = () => within(screen.getByRole("region", { name: "Why this move?" }));
  const picker = explanation().getByRole("combobox", { name: "Playing style" });
  await user.selectOptions(picker, "strong");
  await user.click(explanation().getByRole("button", { name: "Analyze" }));
  expect(work[0].request).toMatchObject({ style: "strong", recorded: { word: "CAT" } });
  expect([...work[0].request.rack].sort().join("")).toBe("ACEINST");
  finish(work[0]);
  expect(explanation().getByRole("heading", { name: "Reanalysis" })).toBeTruthy();
  expect(explanation().getByText(/Strong ranked ACT first in this run/)).toBeTruthy();
  await user.click(explanation().getByText("Style breakdown"));
  expect(explanation().getByText("-1.25").classList.contains("value-bad")).toBe(true);
  await user.click(explanation().getByRole("button", { name: /^Preview alternative ACT/ }));
  expect(screen.getByText(/Alternative · ACT/)).toBeTruthy();
  expect(document.querySelector(".board-panel")?.hasAttribute("data-alternative-preview")).toBe(true);
  expect(location.search).toBe("?move=1");
  await user.click(cell("Preview recorded move CAT"));
  expect(screen.queryByText(/Alternative · ACT/)).toBeNull();
  expect(current().trackedMoves?.[0].styleExplanation).toBeUndefined();

  await user.selectOptions(explanation().getByRole("combobox", { name: "Playing style" }), "learner");
  await user.click(explanation().getByRole("button", { name: "Analyze" }));
  await user.click(cell("Next move"));
  expect(work[1].worker.terminate).toHaveBeenCalled();
  finish(work[1]);
  expect(explanation().getByText("The rack before this move is incomplete.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Preview alternative/ })).toBeNull();
  expect(location.search).toBe("?move=2");
});

test("replay uses compact labels for recorded exchanges", async () => {
  const own = recordBoardlessTurn({ ...game(), rack: "CATERS?" }, "you", { kind: "exchange", slots: [0, 1, 2] });
  const counted = recordBoardlessTurn(own, "opponent", { kind: "exchange", count: 4 });
  const pass = recordBoardlessTurn(counted, "you", { kind: "pass" });
  remote.games[0] = { ...recordBoardlessTurn(pass, "opponent", { kind: "exchange" }), revision: 1 };
  history.replaceState(null, "", "/games/g?move=4");
  await start();
  const replay = within(await screen.findByRole("group", { name: "Game replay" }));
  const strip = within(replay.getByRole("status"));
  const slider = replay.getByRole("slider", { name: "Replay moves" });
  expect(strip.getByText("Exch")).toBeTruthy();
  fireEvent.change(slider, { target: { value: "1" } });
  expect(strip.getByText("Exch CAT")).toBeTruthy();
  expect(slider.getAttribute("aria-valuetext")).toContain("Exchange CAT");
  fireEvent.change(slider, { target: { value: "2" } });
  expect(strip.getByText("Exch 4")).toBeTruthy();
});

test("the replay strip reserves the Why slot through passes and exchanges", async () => {
  const played = replayFixture();
  const passed = recordBoardlessTurn(played, "you", { kind: "pass" });
  remote.games[0] = { ...recordBoardlessTurn(passed, "opponent", { kind: "exchange", count: 2 }), revision: 1 };
  history.replaceState(null, "", "/games/g?move=2");
  const user = await start();
  const replay = within(await screen.findByRole("group", { name: "Game replay" }));
  const strip = within(replay.getByRole("status"));
  expect(strip.getByRole("button", { name: "Why?" })).toBeTruthy();

  for (const label of ["Pass", "Exch 2"]) {
    await user.click(replay.getByRole("button", { name: "Next move" }));
    expect(strip.getByText(label)).toBeTruthy();
    expect(strip.getByText("0 pts").parentElement?.classList.contains("replay-move-result")).toBe(true);
    expect(strip.queryByRole("button", { name: "Why?" })).toBeNull();
    const why = strip.getByText<HTMLButtonElement>("Why?");
    expect(why.disabled).toBe(true);
    expect(why.getAttribute("aria-hidden")).toBe("true");
  }
});

test.each([false, true])("game options export the saved game offline during replay (archived=%s)", async (archived) => {
  const base = replayFixture();
  const earlier = { ...remote.dictionaries[0], id: "earlier", name: "Earlier words", builtin: false };
  const unused = { ...earlier, id: "unused", name: "Unused words" };
  remote.dictionaries.push(earlier, unused);
  base.trackedMoves![0].review!.dictionaryId = earlier.id;
  const saved = {
    ...(archived ? archiveGame(base) : base),
    name: "First game / Élodie",
    startedOn: "2026-02-18",
    notes: "Imported layout",
  };
  remote.games[0] = saved;
  const user = await start(archived ? 390 : 1200);
  if (archived) {
    await user.click(cell("Open sidebar"));
    await user.click(navLink("Archived games"));
    await user.click(screen.getByRole("button", { name: /^First game \/ Élodie/ }));
  }
  await waitFor(() => expect(current().trackedMoves).toHaveLength(2));
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
  await act(() => store.refresh());
  act(() => {
    store.update({ ...current(), rack: "?EINS", notes: "Edited offline" });
  });
  if (!archived) {
    const menu = await openGameOptions(user);
    await user.click(menu.getByRole("button", { name: "Replay game" }));
  }
  const slider = screen.getByRole("slider", { name: "Replay moves" });
  if (archived) expect(slider.closest(".phone-board-column")?.hasAttribute("data-live")).toBe(false);
  fireEvent.change(slider, { target: { value: "1" } });
  const options = await openGameManagement(user);
  const createObjectURL = vi.fn((_file: Blob) => "blob:game-export");
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = vi.fn();
  });
  let downloadName: string | undefined;
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloadName = this.download;
  });
  try {
    await user.click(options.getByRole("button", { name: "Export game" }));
  } finally {
    click.mockRestore();
  }

  expect(downloadName).toBe("tilemaxx-First-game-Élodie-2026-02-18.json");
  expect(createObjectURL).toHaveBeenCalledOnce();
  const file = createObjectURL.mock.calls[0][0];
  expect(file.type).toBe("application/json;charset=utf-8");
  const contents = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
  const { id, profileId, revision, updatedAt, ...gameSnapshot } = current();
  expect(JSON.parse(contents)).toEqual({
    format: "tilemaxx-game",
    version: 1,
    game: JSON.parse(JSON.stringify(gameSnapshot)),
    wordLists: [
      { id: "test", name: "Test words", builtin: true },
      { id: "earlier", name: "Earlier words", builtin: false },
    ],
  });
  expect(slider).toHaveProperty("value", "1");
  expect(current().rack).toBe("?EINS");
  expect(remote.games[0].rack).toBe(saved.rack);
  if (archived) expect(gameSnapshot.archivedState?.rack).toBe(base.rack);
});

function replayRackLabels(tray: HTMLElement) {
  return Array.from(tray.querySelectorAll(".rack-tile"), (tile) =>
    tile.getAttribute("aria-label")?.replace(/^Rack tile \d+: /, "").replace(", used by preview", ", played"),
  );
}

test("game links restore replay and review turns, and stepping works with browser history", async () => {
  const replayGame = { ...replayFixture(), id: "replay-game", profileId: "other", name: "Linked game" };
  remote.profiles.push({ id: "other", name: "Other profile" });
  remote.games.push(replayGame);
  localStorage.setItem("tilewise:profile", "p");
  history.replaceState(null, "", "/games/replay-game?move=1");
  const user = userEvent.setup();
  const app = render(<App />);
  const slider = () => screen.getByRole("slider", { name: "Replay moves" });
  await screen.findByRole("button", { name: "Preview recorded move CAT" });
  expect(screen.getByLabelText("Current profile")).toHaveProperty("value", "other");
  expect(screen.getByRole("region", { name: "Game board" }).hasAttribute("data-turn")).toBe(false);

  await user.click(cell("Next move"));
  expect(location.search).toBe("?move=2");
  expect(slider()).toHaveProperty("value", "2");
  history.back();
  await waitFor(() => expect(slider()).toHaveProperty("value", "1"));
  history.forward();
  await waitFor(() => expect(slider()).toHaveProperty("value", "2"));

  app.unmount();
  const reloaded = render(<App />);
  await screen.findByRole("button", { name: "Preview recorded move ART" });
  await user.click(cell("Back to live"));
  expect(location.search).toBe("");
  expect(screen.getByRole("region", { name: "Game board" }).getAttribute("data-turn")).toBe("you");
  await user.click(cell("Review game"));
  const review = await screen.findByRole("dialog", { name: "Review game" });
  expect(location.search).toBe("?review=game");
  await user.click(within(review).getByRole("button", { name: /2 · ART/ }));
  expect(location.search).toBe("?review=2");
  reloaded.unmount();
  render(<App />);
  const restored = await screen.findByRole("dialog", { name: /^Review move 2/ });
  await user.click(within(restored).getByRole("button", { name: "Close dialog" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(location.search).toBe("");
});

test("archived replay updates the move link without adding browser history entries", async () => {
  remote.games.push(archiveGame({ ...replayFixture(), id: "archived-replay", name: "Archived replay" }));
  const user = await start();
  await user.click(navLink("Archived games"));
  await user.selectOptions(screen.getByRole("combobox", { name: "Sort by" }), "opponent");
  const archiveLink = location.href;
  await user.click(screen.getByRole("button", { name: /^Archived replay/ }));
  const slider = await screen.findByRole("slider", { name: "Replay moves" });
  expect(slider.getAttribute("aria-valuetext")).toBe("Final board");

  await user.click(cell("Previous move"));
  expect(location.search).toBe("?move=2");
  fireEvent.change(slider, { target: { value: "0" } });
  expect(location.search).toBe("?move=0");
  fireEvent.change(slider, { target: { value: "1" } });
  expect(location.search).toBe("?move=1");

  history.back();
  const sort = await screen.findByRole("combobox", { name: "Sort by" });
  expect(sort).toHaveProperty("value", "opponent");
  expect(location.href).toBe(archiveLink);
  history.forward();
  await screen.findByRole("button", { name: "Preview recorded move CAT" });
  expect(location.pathname + location.search).toBe("/games/archived-replay?move=1");
});

test("archive and sidebar links restore selections while typed search text stays local", async () => {
  remote.games.push(archiveGame({ ...game(), id: "archive", name: "Archive opponent" }));
  remote.templates.push({ ...PRESETS[0], id: "mini", builtin: false, name: "Mini board" });
  remote.dictionaries.push({ ...remote.dictionaries[0], id: "alternate", name: "Alternate list" });
  const user = await start();
  await user.click(navLink("Archived games"));
  await user.selectOptions(screen.getByRole("combobox", { name: "Sort by" }), "opponent");
  const archiveLink = location.href;
  await user.type(screen.getByRole("searchbox", { name: "Filter by opponent" }), "Archive opponent");
  expect(location.href).toBe(archiveLink);

  await user.click(navLink("Board studio"));
  await user.click(cell("Edit Mini board"));
  expect(new URL(location.href).searchParams.get("template")).toBe("mini");
  history.back();
  await screen.findByRole("heading", { name: "Board studio" });
  history.back();
  const archiveSort = await screen.findByRole("combobox", { name: "Sort by" });
  expect(archiveSort).toHaveProperty("value", "opponent");
  expect(location.href).toBe(archiveLink);
  expect(screen.getByRole("searchbox", { name: "Filter by opponent" })).toHaveProperty("value", "");

  await user.click(navLink("Word list checker"));
  const checker = within(await screen.findByRole("dialog", { name: "Word list checker" }));
  await user.selectOptions(checker.getByRole("combobox", { name: "Word list" }), "alternate");
  const checkerLink = location.href;
  expect(new URL(checkerLink).searchParams.get("list")).toBe("alternate");
  await user.type(checker.getByRole("textbox", { name: "Word" }), "CAT");
  expect(location.href).toBe(checkerLink);
  await user.upload(checker.getByLabelText("Open word list file"), new File(["CAT\n"], "club.txt"));
  expect(checker.getByRole("combobox", { name: "Word list" })).toHaveProperty("value", "");
  history.back();
  await waitFor(() => expect(checker.getByRole("combobox", { name: "Word list" })).toHaveProperty("value", "test"));
  history.forward();
  await waitFor(() => expect(checker.getByRole("combobox", { name: "Word list" })).toHaveProperty("value", "alternate"));
  await user.click(checker.getByRole("button", { name: "Close dialog" }));
  await waitFor(() => expect(location.href).toBe(archiveLink));
  history.go(2);
  const reopened = within(await screen.findByRole("dialog", { name: "Word list checker" }));
  expect(reopened.getByRole("combobox", { name: "Word list" })).toHaveProperty("value", "alternate");
  expect(reopened.getByRole("textbox", { name: "Word" })).toHaveProperty("value", "");
});

test("live replay opens at the latest recorded move and keeps an in-progress play on exit", async () => {
  remote.games[0] = replayFixture();
  const user = await start();
  await waitFor(() => expect(current().trackedMoves).toHaveLength(2));
  await user.click(screen.getByText("Rack tools", { selector: "summary" }));
  await user.click(cell("Enter your play"));
  await user.click(cell("J8: empty"));
  await user.keyboard("S");
  expect(cell("J8: S, draft tile")).toBeTruthy();
  const original = current();
  const options = await openGameOptions(user);
  await user.click(options.getByRole("button", { name: "Replay game" }));
  const controls = within(screen.getByRole("group", { name: "Game replay" }));
  const slider = controls.getByRole("slider", { name: "Replay moves" });
  expect(slider).toHaveProperty("value", "2");
  expect(document.activeElement).toBe(slider.closest(".board-replay-controls"));
  expect(screen.getByRole("textbox", { name: "Type on board" })).toHaveProperty("disabled", false);
  expect(cell("Undo")).toHaveProperty("disabled", true);
  expect(cell("Define")).toBeTruthy();
  expect(screen.getByRole("group", { name: "Replay score" }).textContent).toContain("10–4");
  const strip = within(controls.getByRole("status"));
  expect(strip.getByText("Opp")).toBeTruthy();
  expect(strip.queryByText("2 Opp")).toBeNull();
  expect(controls.getByText("2 / 2")).toBeTruthy();
  expect(strip.getByText("AR(T)")).toBeTruthy();
  expect(strip.getByText("4 pts")).toBeTruthy();
  const replayScore = screen.getByRole("group", { name: "Replay score" });
  const scorePanel = within(screen.getByRole("region", { name: "Game scores" }));
  expect(replayScore.getAttribute("data-turn")).toBe("opponent");
  expect(scorePanel.getByRole("img", { name: "Opponent’s turn" })).toBeTruthy();
  expect(scorePanel.getByText("1 move · Avg 4.0")).toBeTruthy();
  expect(strip.getByText("I6")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Unseen tiles, 83 estimated tiles in the bag before the play" })).toBeTruthy();
  const opponentTray = screen.getByRole("group", { name: "Opponent rack" });
  expect(replayRackLabels(opponentTray)).toEqual(["A, played", "R, played", "unknown", "unknown", "unknown", "unknown", "unknown"]);
  expect(opponentTray.querySelectorAll(".rack-face.unknown")).toHaveLength(5);
  expect(screen.queryByRole("group", { name: "Tiles drawn" })).toBeNull();
  const chart = screen.getByRole("figure", { name: "Score by move" });
  const cursor = () => chart.querySelector(".score-chart-cursor")?.getAttribute("x1");
  const pairPosition = cursor();
  act(() => slider.focus());
  await user.keyboard("{ArrowLeft}");
  expect(slider).toHaveProperty("value", "1");
  expect(document.activeElement).not.toBe(slider);
  expect(cell("I6: empty")).toHaveProperty("disabled", false);
  expect(screen.getByRole("group", { name: "Replay score" }).textContent).toContain("10–0");
  expect(strip.getByText("You")).toBeTruthy();
  expect(strip.queryByText("1 You")).toBeNull();
  expect(controls.getByText("1 / 2")).toBeTruthy();
  expect(strip.getByText("CAT")).toBeTruthy();
  expect(strip.getByText("8G")).toBeTruthy();
  expect(strip.getByText("10 pts")).toBeTruthy();
  expect(replayScore.getAttribute("data-turn")).toBe("you");
  expect(scorePanel.getByRole("img", { name: "Your turn" })).toBeTruthy();
  expect(scorePanel.queryByText("1 move · Avg 4.0")).toBeNull();
  expect(scorePanel.getByText("1 move · Avg 10.0")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Unseen tiles, 86 estimated tiles in the bag before the play" })).toBeTruthy();
  const ownTray = screen.getByRole("group", { name: "Your rack tiles" });
  expect(replayRackLabels(ownTray)).toEqual(["E", "I", "N", "S", "A, played", "C, played", "T, played"]);
  expect(ownTray.querySelectorAll(".move-preview")).toHaveLength(3);
  const drawShelf = screen.getByRole("group", { name: "Tiles drawn" });
  expect(within(drawShelf).getAllByRole("img").map((tile) => tile.getAttribute("aria-label")))
    .toEqual(["A", "O", "U"]);
  expect(drawShelf.style.getPropertyValue("--draw-start")).toBe("4");
  expect(ownTray.querySelector("[data-used-group-start]")?.getAttribute("aria-label")).toContain("A, used by preview");
  const bag = screen.getByRole("button", { name: /^Unseen tiles, 86 estimated/ });
  await user.click(bag);
  expect(bag.getAttribute("aria-expanded")).toBe("true");
  const pool = screen.getByRole("list", { name: "Unseen tile counts" }).closest(".tile-pool");
  expect(pool?.querySelector(".tile-pool-count")?.textContent).toBe("93");
  expect(cursor()).toBe(pairPosition);
  expect(within(chart).getByText("Yet to play").closest("[data-unplayed]")?.textContent).toContain("Opp0");
  act(() => (slider.closest<HTMLElement>(".board-replay-controls"))!.focus());
  await user.keyboard(" ");
  expect(controls.getByRole("button", { name: "Pause replay" })).toBeTruthy();
  const pausedOptions = await openGameOptions(user);
  await user.click(pausedOptions.getByRole("button", { name: "Move history" }));
  const history = within(screen.getByRole("dialog", { name: "Your moves, remembered." }));
  expect(history.getByRole("list").textContent).toContain("CAT");
  await user.click(history.getByRole("button", { name: "Close dialog" }));
  expect(slider).toHaveProperty("value", "1");
  expect(controls.getByRole("button", { name: "Play replay" })).toBeTruthy();
  await user.keyboard("{ArrowRight}");
  expect(slider).toHaveProperty("value", "2");
  expect(within(chart).queryByText("Yet to play")).toBeNull();
  fireEvent.change(slider, { target: { value: "0" } });
  expect(screen.getByText("Start of game")).toBeTruthy();
  expect(screen.getByRole("group", { name: "Your rack tiles" }).querySelector(".move-preview")).toBeNull();
  expect(screen.queryByRole("group", { name: "Tiles drawn" })).toBeNull();
  expect(controls.getByRole("button", { name: "Previous move" })).toHaveProperty("disabled", true);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("group", { name: "Game replay" })).toBeNull();
  expect(document.activeElement).toBe(cell("Game options"));
  expect(cell("J8: S, draft tile")).toBeTruthy();
  expect(current()).toEqual(original);
  const replayShortcut = cell("Replay game");
  await user.click(replayShortcut);
  await user.click(cell("Back to live"));
  expect(document.activeElement).toBe(replayShortcut);
});

test("replay always highlights opponent placements and exposes tile counts when the rack is unknown", async () => {
  const saved = replayFixture(true, "CTSA");
  delete saved.trackedMoves![1].review!.observerRack;
  remote.games[0] = {
    ...saved,
    template: { ...saved.template, tileCounts: { ...getTileCounts(saved.template), "?": 0 } },
  };
  localStorage.setItem("tilemaxx:workspace-preferences", JSON.stringify({ showReplayOpponentTiles: false }));
  const user = await start(1200);
  await waitFor(() => expect(current().trackedMoves).toHaveLength(2));

  const options = await openGameOptions(user);
  await user.click(options.getByRole("button", { name: "Replay game" }));
  const controls = within(screen.getByRole("group", { name: "Game replay" }));
  expect(within(controls.getByRole("status")).getByText("aR(T)")).toBeTruthy();
  const partial = screen.getByRole("group", { name: "Opponent rack" });
  expect(replayRackLabels(partial)).toEqual(["blank, played", "R, played", "unknown", "unknown", "unknown", "unknown", "unknown"]);
  expect(partial.querySelectorAll(".rack-face.unknown")).toHaveLength(5);
  expect(partial.querySelector(".rack-face.unknown")?.textContent).toBe("?");
  expect(partial.querySelector(".rack-face.blank")?.textContent).toBe("0");
  expect(partial.querySelectorAll(".move-preview")).toHaveLength(2);
  const bag = screen.getByRole("button", { name: /Unseen tiles, .*check tile counts/ });
  expect(bag.hasAttribute("data-overdrawn")).toBe(true);
  expect(screen.getByRole("img", { name: "Tile count error" }).closest(".last-play-row")).toBeTruthy();
  await user.click(bag);
  expect(screen.getByText("Your rack wasn’t recorded. These counts include any tiles it held.")).toBeTruthy();
  const breakdown = screen.getByRole("list", { name: "Unseen tile counts" });
  expect(within(breakdown).getByRole("listitem", { name: "Blank: 1 extra" })).toBeTruthy();
  expect(partial.closest(".rack-entry")?.querySelector(".rack-owner-label")).toBeNull();
  await user.click(controls.getByRole("button", { name: "Previous move" }));
  const own = screen.getByRole("group", { name: "Your rack tiles" });
  expect(own.closest(".rack-entry")?.querySelector(".rack-owner-label")).toBeNull();
  expect(screen.queryByText("Your rack wasn’t recorded. These counts include any tiles it held.")).toBeNull();
  expect(replayRackLabels(own))
    .toEqual(["S", "A, played", "C, played", "T, played", "unknown", "unknown", "unknown"]);
  expect(screen.queryByRole("group", { name: /Opponent.*(rack|tiles)/ })).toBeNull();
  await user.click(controls.getByRole("button", { name: "Next move" }));
  expect(screen.getByRole("group", { name: "Opponent rack" })).toBeTruthy();
});

test("replay highlights only the used copies when both rack groups contain duplicates", async () => {
  const initial = { ...game(), rack: "AA??RST" };
  const candidate = solve(new Lexicon(["AT"]), initial.board, initial.rack, initial.template)
    .find((move) => move.direction === "across" && move.tiles[0].index === 112)!;
  remote.games[0] = {
    ...playTrackedMove(initial, {
      ...candidate,
      score: 2,
      tiles: [{ index: 112, letter: "A" }, { index: 113, letter: "t" }],
      blanks: 1,
      leave: "?ARST",
    }),
    revision: 1,
  };
  const user = await start();
  await waitFor(() => expect(current().trackedMoves).toHaveLength(1));
  const options = await openGameOptions(user);
  await user.click(options.getByRole("button", { name: "Replay game" }));
  const tray = screen.getByRole("group", { name: "Your rack tiles" });
  expect(replayRackLabels(tray)).toEqual(["blank", "A", "R", "S", "T", "blank, played", "A, played"]);
  expect(tray.querySelector("[data-used-group-start]")?.getAttribute("data-rack-slot")).toBe("5");
});

test("replay keeps a recorded score visible when the board cannot be recovered", async () => {
  remote.games[0] = {
    ...game(),
    rack: "CAT",
    revision: 1,
    trackedMoves: [{ player: "you", word: "CAT", score: 10, at: "" }],
  };
  const user = await start(1200);
  await waitFor(() => expect(current().trackedMoves).toHaveLength(1));
  const options = await openGameOptions(user);
  await user.click(options.getByRole("button", { name: "Replay game" }));

  expect(screen.getByText("Board unavailable for this move")).toBeTruthy();
  expect(cell("Preview recorded move CAT")).toHaveProperty("disabled", true);
  expect(screen.getByRole("textbox", { name: "Type on board" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("group", { name: "Replay score" }).textContent).toContain("10–0");
  expect(cell("Find moves")).toHaveProperty("disabled", true);
  expect(cell("Bag count unavailable")).toHaveProperty("disabled", true);
});

test("archiving drops undo history, keeps replay and endgame racks, and allows later edits", async () => {
  const saved = replayFixture();
  const physicalTiles = [...saved.board, ...saved.rack, "Z", "Y"];
  delete saved.trackedMoves![1].review!.observerRack;
  remote.games[0] = {
    ...saved,
    name: "Replay archive",
    template: {
      ...saved.template,
      tileCounts: Object.fromEntries(TILE_SYMBOLS.map((tile) => [
        tile, physicalTiles.filter((symbol) => symbol === tile).length,
      ])),
    },
  };
  const user = await start(390);
  await waitFor(() => expect(current().trackedMoves).toHaveLength(2));
  expect(current().past.length).toBeGreaterThan(0);
  const options = await openGameOptions(user);
  await user.click(options.getByRole("button", { name: "Archive game" }));
  await act(() => store.flush());
  expect(remote.games[0].archived).toBe(true);
  expect(remote.games[0].past).toEqual([]);
  expect(remote.games[0].archivedState?.past).toEqual([]);
  await user.click(cell("Open sidebar"));
  await user.click(navLink("Archived games"));
  await user.click(screen.getByRole("button", { name: /^Replay archive/ }));
  await screen.findByRole("heading", { name: "Replay archive" });
  const archivedOptions = await openGameOptions(user);
  for (const name of ["Move history", "Import screenshot"])
    expect(archivedOptions.queryByRole("button", { name })).toBeNull();
  expect(archivedOptions.getByRole("button", { name: "Replay game" })).toBeTruthy();
  await user.click(archivedOptions.getByRole("button", { name: "Close dialog" }));
  expect(cell("Undo")).toHaveProperty("disabled", true);
  await user.click(cell("A1: TW"));
  await user.keyboard("Q");
  await screen.findByRole("button", { name: "A1: Q, edited after archiving" });
  const controls = within(screen.getByRole("group", { name: "Game replay" }));
  const slider = controls.getByRole("slider", { name: "Replay moves" });
  const trialTiles = () => screen.getByRole("region", { name: "Game board" }).querySelectorAll(".square.trial-tile");
  const scorePanel = within(screen.getByRole("region", { name: "Game scores" }));
  expect(slider).toHaveProperty("value", "3");
  expect(scorePanel.getByText("1 move · Avg 10.0")).toBeTruthy();
  expect(scorePanel.getByText("1 move · Avg 4.0")).toBeTruthy();
  expect(controls.getByRole("button", { name: "Play from start" })).toBeTruthy();
  const strip = within(controls.getByRole("status"));
  expect(strip.getByText("Final board")).toBeTruthy();
  await user.click(scorePanel.getByText("Tracked move history"));
  const history = within(await scorePanel.findByRole("table", { name: "Tracked moves" }));
  expect(history.getAllByRole("columnheader").map((header) => header.textContent))
    .toEqual(["#", "Player", "Play", "Pts", "Total", "Strength"]);
  const reply = history.getByRole("button", { name: "Replay move 2: ART" });
  expect(reply.textContent).toBe("AR(T)");
  const replyRow = reply.closest("tr")!;
  expect(replyRow.getAttribute("data-player")).toBe("opponent");
  expect(within(replyRow).getAllByRole("cell").map((cell) => cell.textContent))
    .toEqual(["2", "Opp", "AR(T)", "4", "4", "—"]);
  expect(scorePanel.queryByRole("button", { name: "Add missed move" })).toBeNull();
  expect(history.queryByRole("button", { name: /^Edit move/ })).toBeNull();
  fireEvent.change(slider, { target: { value: "0" } });
  expect(strip.getByText("Start of game")).toBeTruthy();
  expect(scorePanel.getAllByText("0 moves · Avg —")).toHaveLength(2);
  expect(scorePanel.getAllByText("Best — · 0 bingos")).toHaveLength(2);
  const opening = history.getByRole("button", { name: "Replay move 1: CAT" });
  await user.click(opening);
  expect(slider).toHaveProperty("value", "1");
  expect(opening.getAttribute("aria-current")).toBe("step");
  expect(scorePanel.getByText("1 move · Avg 10.0")).toBeTruthy();
  expect(scorePanel.getByText("Best 10 · 0 bingos")).toBeTruthy();
  expect(scorePanel.getByText("0 moves · Avg —")).toBeTruthy();
  expect(cell("H8: A, start")).toHaveProperty("disabled", false);
  expect(screen.queryByRole("button", { name: /^A1: Q/ })).toBeNull();
  expect(cell("Define")).toBeTruthy();
  expect(controls.getByRole("button", { name: "Preview recorded move CAT" }).getAttribute("aria-pressed")).toBe("true");
  expect(cell("H8: A, start").classList.contains("ghost")).toBe(true);
  expect(strip.queryByText("Final board")).toBeNull();
  expect(screen.getByRole("button", { name: "Unseen tiles, 0 estimated tiles in the bag before the play" })).toBeTruthy();
  expect(screen.queryByRole("group", { name: /Draw unknown|Tiles drawn/ })).toBeNull();

  await act(() => store.flush());
  const archivedBoard = current().board;
  const archivedRevision = current().revision;
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await user.click((await screen.findAllByRole("button", { name: /^CATS, / }))[0]);
  await screen.findByText("Trial from move 1");
  expect(trialTiles()).toHaveLength(4);
  const trialOptions = await openGameOptions(user);
  await user.click(trialOptions.getByRole("button", { name: "Close dialog" }));
  expect(screen.getByText("Trial from move 1")).toBeTruthy();
  expect(cell("Undo")).toHaveProperty("disabled", false);
  await user.click(cell("Undo"));
  expect(trialTiles()).toHaveLength(0);
  expect(cell("Redo")).toHaveProperty("disabled", false);
  await user.click(cell("Redo"));
  expect(trialTiles()).toHaveLength(4);
  await user.click(cell("Back to move 1"));
  expect(trialTiles()).toHaveLength(0);
  expect(cell("H8: A, start").classList.contains("ghost")).toBe(true);
  expect(cell("Undo")).toHaveProperty("disabled", true);
  await act(() => store.flush());
  expect(current().revision).toBe(archivedRevision);
  expect(current().board).toEqual(archivedBoard);

  await user.click(controls.getByRole("button", { name: "Next move" }));
  expect(controls.getByRole("button", { name: "Preview recorded move ART" }).getAttribute("aria-pressed")).toBe("true");
  expect(cell("I6: A").classList.contains("ghost")).toBe(true);
  await user.click(cell("A1: TW"));
  await user.keyboard("Z");
  expect(cell("A1: Z, trial tile")).toBeTruthy();
  expect(cell("H8: A, start").classList.contains("trial-tile")).toBe(false);
  await user.click(cell("Back to move 2"));
  expect(trialTiles()).toHaveLength(0);
  const opponentTray = screen.getByRole("group", { name: "Opponent rack" });
  expect(replayRackLabels(opponentTray))
    .toEqual(["Y", "Z", "A, played", "R, played", "empty", "empty", "empty"]);
  expect(opponentTray.querySelectorAll(".move-preview")).toHaveLength(2);
  const bag = screen.getByRole("button", { name: /^Unseen tiles, 0 estimated/ });
  await user.click(bag);
  expect(screen.getByRole("list", { name: "Unseen tile counts" }).closest(".phone-rack-details")).toBeTruthy();
  fireEvent.change(slider, { target: { value: "3" } });
  expect(cell("A1: Q, edited after archiving")).toHaveProperty("disabled", false);
  expect(slider).toHaveProperty("value", "3");
  expect(strip.getByText("Final board")).toBeTruthy();

  fireEvent.change(slider, { target: { value: "1" } });
  const restoreOptions = await openGameManagement(user);
  const boardTools = within(restoreOptions.getByRole("region", { name: "Board tools" }));
  const restore = boardTools.getByRole("button", { name: "Restore game" });
  expect(restoreOptions.getByText("Manage game").closest("details")?.contains(restore)).toBe(false);
  await user.click(restore);
  expect(slider).toHaveProperty("value", "3");
  expect(cell("A1: TW")).toBeTruthy();
  await act(() => store.flush());
  expect(remote.games[0].board).toEqual(saved.board);
});

test("entering your play infers a blank and records the move without searching", async () => {
  remote.games[0] = {
    ...game(), rack: "CA?E", excludedRackSlots: [0], requiredRackSlots: [3], revision: 1,
  };
  const user = await start(1200);
  await waitFor(() => expect(current().rack).toBe("CA?E"));

  await user.click(screen.getByText("Rack tools", { selector: "summary" }));
  await user.click(cell("Enter your play"));
  await user.click(cell("H8: DW, start"));
  await user.keyboard("CAT");
  expect(cell("J8: T blank, draft tile")).toBeTruthy();
  expect(screen.getByText("· 8 pts", { exact: false })).toBeTruthy();
  expect(current().board.every((tile) => !tile)).toBe(true);
  expect(current().rack).toBe("CA?E");
  expect(current().past).toHaveLength(0);

  await user.keyboard("{Enter}");
  expect(current().board.slice(112, 115).join("")).toBe("CAt");
  expect(current().rack).toBe("E");
  expect(current().scoring?.you.points).toBe(8);
  expect(current().trackedMoves).toMatchObject([{ player: "you", word: "CAT", score: 8 }]);
  expect(cell("Find moves")).toBeTruthy();
  await user.click(cell("Undo"));
  expect(current().rack).toBe("CA?E");
  expect(current().excludedRackSlots).toEqual([0]);
  expect(current().requiredRackSlots).toEqual([3]);
  expect(current().board.every((tile) => !tile)).toBe(true);
  await user.click(cell("Redo"));
  expect(current().scoring?.you.points).toBe(8);
  expect(current().rack).toBe("E");
});

test("your play warns on a missing tile and stays drafted through a rack correction", async () => {
  const base = { ...game(), rack: "CTEO" };
  const board = [...base.board];
  board[97] = "C";
  board[112] = "A";
  board[127] = "T";
  remote.games[0] = { ...new BoardEditHistory().apply(base, board, "enter"), revision: 1 };
  const user = await start(390);
  await waitFor(() => expect(current().board[112]).toBe("A"));
  const strip = () => document.querySelector(".direct-entry-status")!.textContent;
  const ownPlay = () => within(document.querySelector<HTMLElement>(".own-play-actions")!);
  const play = () => ownPlay().getByRole<HTMLButtonElement>("button", { name: "Play" });

  await user.click(screen.getByText("Rack tools").closest("summary")!);
  await user.click(cell("Enter your play"));
  await user.click(cell("G8: empty"));
  expect(boardDirection()).toBe("Across");
  await user.keyboard("CTS");
  expect(strip()).toBe("8K · Missing S");
  expect(cell("J8: S, missing S from rack").dataset.missingRack).toBe("true");
  expect(play().disabled).toBe(true);
  await user.keyboard("{Enter}");
  expect(document.activeElement).toBe(entry());
  expect(current().board).toEqual(board);

  await user.click(cell("Undo"));
  expect(strip()).not.toContain("Missing S");
  await user.click(cell("Redo"));
  expect(strip()).toContain("Missing S");
  await user.click(ownPlay().getByRole("button", { name: "Fix rack" }));
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Rack letters" }));
  await user.keyboard("S");
  expect(strip()).not.toContain("Missing S");
  expect(current().rack).toBe("CTEOS");
  expect(current().board).toEqual(board);
  expect(play().disabled).toBe(false);

  await user.click(cell("H8: A, start"));
  await user.keyboard("{Delete}");
  expect(cell("H8: A, start")).toBeTruthy();
  await user.click(play());
  expect(current().board.slice(111, 115).join("")).toBe("CATS");
  expect(current().rack).toBe("EO");
  expect(current().trackedMoves).toMatchObject([
    { player: "opponent", word: "CAT", score: 10 },
    { player: "you", word: "CATS", score: 6 },
  ]);
  expect(document.querySelector(".own-play-actions")).toBeNull();
});

test("record anyway confirms the actual rack leave inline before saving a play", async () => {
  const user = await start(390);
  await typeRack(user, "CAER");
  await user.click(screen.getByText("Rack tools").closest("summary")!);
  await user.click(cell("Enter your play"));
  await user.click(cell("H8: DW, start"));
  await user.keyboard("CAT");
  const record = cell("Record anyway");
  expect(record.getAttribute("aria-expanded")).toBe("false");
  expect(cell("J8: T, missing T from rack")).toBeTruthy();

  await user.click(record);
  const confirmation = () => within(screen.getByRole("form", { name: "Rack after play" }));
  const leave = () => confirmation().getByRole<HTMLInputElement>("textbox", { name: "Rack after play" });
  expect(leave().value).toBe("ER");
  expect(document.activeElement).toBe(leave());
  expect(record.getAttribute("aria-expanded")).toBe("true");
  expect(document.querySelector(".direct-entry-status")?.textContent).toContain("Missing T");
  expect(current().board.every((tile) => !tile)).toBe(true);
  expect(current().rack).toBe("CAER");

  await user.click(confirmation().getByRole("button", { name: "Back" }));
  expect(screen.queryByRole("form", { name: "Rack after play" })).toBeNull();
  expect(document.activeElement).toBe(record);
  expect(cell("J8: T, missing T from rack")).toBeTruthy();
  await user.click(record);
  await user.clear(leave());
  await user.type(leave(), "ABCDE");
  const confirm = confirmation().getByRole<HTMLButtonElement>("button", { name: "Confirm play" });
  expect(confirm.disabled).toBe(true);
  expect(confirmation().getByText("Enter at most 4 tiles.")).toBeTruthy();
  await user.clear(leave());
  await user.type(leave(), "Q?");
  expect(confirm.disabled).toBe(false);
  await user.click(confirm);

  expect(current().board.slice(112, 115).join("")).toBe("CAT");
  expect(current().rack).toBe("Q?");
  expect(current().scoring?.you.points).toBe(10);
  expect(current().trackedMoves?.[0]).toMatchObject({
    player: "you", word: "CAT", score: 10, review: { rack: "CATQ?" },
  });
  expect(screen.queryByRole("form", { name: "Rack after play" })).toBeNull();
  expect(cell("Find moves")).toBeTruthy();
  await user.click(cell("Undo"));
  expect(current().rack).toBe("CAER");
  expect(current().board.every((tile) => !tile)).toBe(true);
  await user.click(cell("Redo"));
  expect(current().rack).toBe("Q?");
  expect(current().trackedMoves?.[0].review?.rack).toBe("CATQ?");
});

test("record anyway with an empty leave can finish the game based on the corrected rack", async () => {
  const sample = game();
  remote.games[0] = {
    ...sample, rack: "CA", revision: 1,
    template: {
      ...sample.template, rackSize: 3,
      tileCounts: Object.fromEntries(TILE_SYMBOLS.map(tile => [tile, Number("CATXYZ".includes(tile))])),
    },
  };
  const user = await start(1200);
  await waitFor(() => expect(current().rack).toBe("CA"));
  await user.click(screen.getByText("Rack tools", { selector: "summary" }));
  await user.click(cell("Enter your play"));
  await user.click(cell("H8: DW, start"));
  await user.keyboard("CAT");
  await user.click(cell("Record anyway"));
  const leave = screen.getByRole("textbox", { name: "Rack after play" });
  expect(leave).toHaveProperty("value", "");
  await user.keyboard("{Enter}");
  expect(current().rack).toBe("");
  expect(current().scoring?.end).toMatchObject({ out: "you", rackPoints: 22 });
});

test("cancelling your play discards the draft and returns to opponent board entry", async () => {
  const user = await start();
  await typeRack(user, "CAT");
  await user.click(screen.getByText("Rack tools", { selector: "summary" }));
  await user.click(cell("Enter your play"));
  await user.click(cell("H8: DW, start"));
  await user.keyboard("CAT{Escape}");
  expect(current().board.every((tile) => !tile)).toBe(true);
  expect(current().rack).toBe("CAT");
  expect(document.querySelector(".own-play-actions")).toBeNull();

  await user.click(cell("H8: DW, start"));
  await user.keyboard("CAT");
  expect(current().board.slice(112, 115).join("")).toBe("CAT");
  expect(current().rack).toBe("CAT");
});

test.each(["phone", "desktop"])(
  "the %s game footer shows and copies the current game's ID",
  async (layout) => {
    const user = await start(layout === "phone" ? 390 : 1200);
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

test("the footer opens the dictionary credits", async () => {
  const user = await start(390);
  const footer = screen.getByRole("main").querySelector<HTMLElement>("footer.workspace-footer")!;
  await user.click(within(footer).getByRole("button", { name: "Dictionary sources" }));

  const credits = within(screen.getByRole("dialog", { name: "Dictionary sources" }));
  expect(credits.getByRole("link", { name: "English Wiktionary" }).getAttribute("href"))
    .toBe("https://en.wiktionary.org/");
  expect(credits.getByRole("link", { name: "CC BY-SA 4.0" }).getAttribute("href"))
    .toBe("https://creativecommons.org/licenses/by-sa/4.0/");
  expect(credits.getByRole("link", { name: "Kaikki’s Wiktextract exports" }).getAttribute("href"))
    .toBe("https://kaikki.org/");
  await user.click(credits.getByRole("button", { name: "Close dialog" }));
  expect(screen.queryByRole("dialog", { name: "Dictionary sources" })).toBeNull();
});

test("board hover shows both word scores on a shared ending and keeps them across tile gaps", async () => {
  const user = await start();
  await typeRack(user, "CAT");
  await user.click(screen.getByText("Rack tools", { selector: "summary" }));
  await user.click(cell("Enter your play"));
  await user.click(cell("G8: empty"));
  await user.keyboard("CAT{Enter}");
  await waitFor(() => expect(current().board[113]).toBe("T"));
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
  ).toBe("ART down, 4 points, opponent play");
  expect(end.querySelector(".board-word-score.across.opponent-word-score")).toBeNull();
  expect(end.querySelector(".board-word-score.down.opponent-word-score")).toBeTruthy();
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
  await user.keyboard("T");
  expect(current().board[143]).toBe("T");
  await user.click(cell("I10: T"));
  await user.keyboard("{Delete}");
  expect(current().board[143]).toBe("");
  await user.click(cell("Undo"));
  expect(current().board[143]).toBe("T");
  await user.click(cell("Redo"));
  expect(current().board[143]).toBe("");
  await store.flush();
  expect(remote.games[0].board).toEqual(current().board);
  expect(current().rack).toBe("");
});

test("click and Alt+B share direction detection within the physical rack size", async () => {
  const user = await start();
  const direction = boardDirection;
  await user.click(cell("G8: empty"));
  await user.keyboard("CAT");
  await user.click(cell("G6: empty"));
  await user.keyboard("T");
  await typeRack(user, "D");

  await user.click(cell("I6: empty"));
  expect(direction()).toBe("Across"); // One rack tile falls short of I8.

  await user.click(rackTile(3));
  await user.keyboard(" ");
  expect(current().rack).toBe("D.?");
  await user.click(cell("I5: empty"));
  expect(direction()).toBe("Across"); // The empty rack slot does not count.
  await user.click(cell("I6: empty"));
  expect(direction()).toBe("Down"); // The blank counts; G6 to the left does not.
  await user.click(cell("I6: empty"));
  expect(direction()).toBe("Across");
  await user.click(cell("I6: empty"));
  expect(direction()).toBe("Down");
  await user.keyboard("AR");
  expect([83, 98, 113].map((index) => current().board[index])).toEqual(["A", "R", "T"]);

  await user.click(cell("H6: empty"));
  expect(direction()).toBe("Across"); // Both the row and column have tiles.
  await user.click(cell("I5: empty"));
  expect(direction()).toBe("Across"); // Across can hook onto the tile below.
  await user.keyboard("{Alt>}b{/Alt}i5");
  expect(selectedCell()).toBe("68");
  expect(direction()).toBe("Across");
  await user.click(cell("A1: TW"));
  expect(direction()).toBe("Across"); // Neither path connects.
  await user.click(cell("I4: empty"));
  expect(direction()).toBe("Down");

  await user.keyboard("{Alt>}b{/Alt}i4");
  expect(selectedCell()).toBe("53");
  expect(direction()).toBe("Down");
  await user.keyboard("{Alt>}b{/Alt}4iN");
  expect(current().board[53]).toBe("N");
  expect(selectedCell()).toBe("68");
});

test("right/down switch direction first, then advance; left/up always move without turning", async () => {
  const user = await start();
  await user.click(cell("H8: DW, start"));
  await user.keyboard("{ArrowRight}");
  expect(selectedCell()).toBe("113");
  await user.keyboard("{ArrowDown}");
  expect(selectedCell()).toBe("113");
  expect(boardDirection()).toBe("Down");
  await user.keyboard("{ArrowDown}");
  expect(selectedCell()).toBe("128");
  await user.keyboard("{ArrowLeft}{ArrowUp}");
  expect(selectedCell()).toBe("112");
  expect(boardDirection()).toBe("Down");
  await user.keyboard("{ArrowRight}");
  expect(selectedCell()).toBe("112");
  expect(boardDirection()).toBe("Across");
  await user.keyboard("{ArrowRight}");
  expect(selectedCell()).toBe("113");
  await user.keyboard("{Shift>}{Enter}{/Shift}");
  expect(boardDirection()).toBe("Down");
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
  expect(boardDirection()).toBe("Down");
  expect(cell("Find moves")).toHaveProperty("disabled", false);

  await user.keyboard("{ArrowRight}CAT{Enter}");
  expect(await screen.findByRole("button", { name: /^CATS, / })).toBeTruthy();
  expect(current().board.slice(112, 116)).toEqual(["C", "A", "T", ""]);
  expect(current().rack).toBe("S");
});

test("a phone keyboard’s Shift flag on Enter still finds moves on the first press", async () => {
  const user = await start(390);
  await typeRack(user, "S");
  await user.click(cell("H8: DW, start"));
  expect(entry().getAttribute("autocapitalize")).toBe("off");
  await user.keyboard("cat");
  expect(boardDirection()).toBe("Across");
  fireEvent.keyDown(entry(), { key: "Enter", shiftKey: true });
  expect(await screen.findByRole("button", { name: /^CATS, / })).toBeTruthy();
});

test("letters and periods follow the board entry skip setting, and Backspace returns over skipped tiles", async () => {
  const user = await start();
  await user.click(screen.getByRole("button", { name: /^I8:/ }));
  await user.keyboard("A T");
  await user.click(cell("H8: DW, start"));
  expect(screen.getByText("8H · Space: blank · Click again: Down")).toBeTruthy();
  await user.keyboard("C");
  expect(selectedCell()).toBe("115");
  await user.keyboard("{Backspace}");
  expect(selectedCell()).toBe("112");
  expect(current().board.slice(112, 116)).toEqual(["", "A", "t", ""]);
  await user.keyboard(".");
  expect(selectedCell()).toBe("115");
  expect(current().board.slice(112, 116)).toEqual(["", "A", "t", ""]);
  await user.keyboard("{Backspace}");
  expect(selectedCell()).toBe("112");
  await user.paste("C R");
  expect(current().board.slice(112, 116)).toEqual(["C", "A", "t", "r"]);

  await user.click(cell("Settings"));
  const settings = within(screen.getByRole("dialog", { name: "Settings" }));
  const skip = settings.getByRole<HTMLInputElement>("checkbox", {
    name: "Skip played tiles during board entry",
  });
  expect(skip.checked).toBe(true);
  await user.click(skip);
  expect(
    JSON.parse(localStorage.getItem("tilemaxx:workspace-preferences")!).skipPlayedTiles,
  ).toBe(false);
  await user.click(settings.getByRole("button", { name: "Close dialog" }));
  await user.click(screen.getByRole("button", { name: /^H8: C/ }));
  expect(screen.getByText("8H · Space: blank · Period: skip · Click again: Down")).toBeTruthy();
  await user.keyboard(".");
  expect(selectedCell()).toBe("113");
  expect(current().board.slice(112, 116)).toEqual(["C", "A", "t", "r"]);
  await user.click(screen.getByRole("button", { name: /^H8: C/ }));
  await user.keyboard("CQ");
  expect(current().board.slice(112, 116)).toEqual(["C", "Q", "t", "r"]);
});

test("skipping a played run down to the edge stops pasted entry in that column", async () => {
  const user = await start();
  await user.click(screen.getByRole("button", { name: /^H14:/ }));
  await user.keyboard("{ArrowDown}AT");
  await user.click(screen.getByRole("button", { name: /^H13:/ }));
  await user.keyboard("{ArrowDown}");
  await user.paste("CATS");
  expect([187, 202, 217].map((square) => current().board[square])).toEqual([
    "C", "A", "T",
  ]);
  expect(current().board.filter(Boolean)).toHaveLength(3);
  expect(selectedCell()).toBe("187");
  expect(screen.getByRole("status").textContent).toContain("Board edge");
});

test("repeat tap toggles direction and controls preserve the same input focus", async () => {
  const user = await start();
  await user.click(cell("C3: DW"));
  const input = entry();
  expect(selectedCell()).toBe("32");
  expect(document.activeElement).toBe(input);
  expect(screen.getByText("3C · Space: blank · Click again: Down")).toBeTruthy();
  await user.click(cell("C3: DW"));
  expect(boardDirection()).toBe("Down");
  expect(screen.getByText("C3 · Space: blank · Click again: Across")).toBeTruthy();
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
  await user.keyboard("{Shift>}{Enter}{/Shift}");
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
  await user.type(screen.getByLabelText("Opponent"), "Another");
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
                  outscored: 0,
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
      if (request.kind === "reply-detail" || request.kind === "reply-line" || request.kind === "reply-histogram")
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
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Rack letters" }));
  expect(rackTile(1).getAttribute("aria-pressed")).toBe("true");
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
  const options = await openGameOptions(user);
  await user.click(options.getByRole("button", { name: "Move history" }));
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
  const options = await openGameOptions(user);
  await user.selectOptions(options.getByRole("combobox", { name: "Game dictionary" }), "other");
  await user.click(options.getByRole("button", { name: "Close dialog" }));
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(current().rack).toBe("CATS");
  expect(screen.queryByLabelText("Suggested moves")).toBeNull();
});

test("focus moves between board, rack and moves without leaving an inactive cursor", async () => {
  const user = await start();
  await user.click(cell("H8: DW, start"));
  await user.keyboard("A{ArrowRight}");
  expect(selectedCell()).toBe("114");
  await user.click(rackTile(1));
  expect(selectedCell()).toBeUndefined();
  expect(document.querySelector(".entry-arrow")).toBeNull();
  expect(rackTile(1).getAttribute("aria-pressed")).toBe("true");
  await user.keyboard("CAT");
  await user.click(cell("J8: empty"));
  expect(document.querySelector(".rack-tile.selected")).toBeNull();
  expect(selectedCell()).toBe("114");
  // Returning to the same square after blur must not turn the direction.
  expect(boardDirection()).toBe("Across");
  await user.click(screen.getByRole("heading", { name: "Possible moves" }));
  expect(selectedCell()).toBeUndefined();
  await user.click(cell("J8: empty"));
  await user.keyboard(" ");
  expect(document.querySelector(".pending-blank")).toBeTruthy();
  await user.click(rackTile(2));
  expect(document.querySelector(".pending-blank")).toBeNull();
  expect(current().board[114]).toBe("");
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
  expect(boardDirection()).toBe("Across");
  touch(square, "pointerdown");
  touch(square, "pointerup");
  // Exercise a browser that transfers focus after pointerup, before click.
  act(() => square.focus());
  expect(document.activeElement).toBe(square);
  expect(selectedCell()).toBeUndefined();
  fireEvent.mouseUp(square);
  fireEvent.click(square, { detail: 1 });
  expect(document.activeElement).toBe(entry());
  expect(boardDirection()).toBe("Down");
  expect(selectedCell()).toBe("112");
  touch(square, "pointerdown");
  touch(square, "pointerup");
  fireEvent.click(square, { detail: 1 });
  expect(boardDirection()).toBe("Across");
  await user.click(rackTile(1));
  expect(selectedCell()).toBeUndefined();
  touch(square, "pointerdown");
  touch(square, "pointerup");
  fireEvent.click(square, { detail: 1 });
  expect(boardDirection()).toBe("Across");
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

test.each(["phone Define", "desktop Define", "desktop right-click"] as const)("looking up a board intersection with %s shows both French words without editing the tile", async (method) => {
  const phone = method === "phone Define";
  const board = emptyBoard(15);
  board.splice(112, 4, ..."COTe");
  board[70] = "L";
  board[85] = "U";
  board[100] = "N";
  const original = game();
  remote.games[0] = {
    ...original,
    revision: 1,
    board,
    template: { ...original.template, rules: "scrabble-fr" },
  };
  const request = fetch;
  const fetchDefinitions = vi.fn(async (url: string, options?: RequestInit) => {
    if (!url.startsWith("/api/definitions?")) return request(url, options);
    return new Response(JSON.stringify({
      available: true,
      entries: [
        [{ spelling: "côte", headword: "côte", glosses: ["coast"], license: "CC BY-SA 4.0",
          sourceUrl: "https://en.wiktionary.org/wiki/c%C3%B4te#French" },
          { spelling: "côté", headword: "côté", glosses: ["side"] }],
        [{ spelling: "lune", headword: "lune", glosses: ["moon"] }],
      ],
      // Older servers may still include frequency data for French.
      wordFrequencyZipf: [3, null],
    }));
  });
  vi.stubGlobal("fetch", fetchDefinitions);
  const user = await start(phone ? 390 : 1200);
  const tile = await screen.findByRole("button", { name: "K8: E blank" });
  const empty = cell("B1: empty");
  expect(screen.queryByRole("button", { name: /^Blank tile:/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Erase selected tile" })).toBeNull();
  if (method !== "desktop right-click") {
    const define = cell("Define");
    const grid = tile.closest(".board-grid");
    expect(define).toHaveProperty("disabled", false);
    expect(selectedCell()).toBeUndefined();
    if (phone) {
      await user.click(tile);
      expect(document.activeElement).toBe(entry());
    }
    await user.click(define);
    expect(screen.getByText(phone ? "Tap a tile in a word" : "Click a tile in a word")).toBeTruthy();
    expect(grid?.getAttribute("data-defining")).toBe("true");
    expect(entry()).toHaveProperty("disabled", true);
    expect(empty).toHaveProperty("disabled", true);
    await user.click(cell("Cancel"));
    expect(grid?.hasAttribute("data-defining")).toBe(false);
    expect(empty).toHaveProperty("disabled", false);
    await user.click(cell("Define"));
    await user.click(tile);
    expect(grid?.hasAttribute("data-defining")).toBe(false);
    expect(empty).toHaveProperty("disabled", false);
  } else {
    expect(fireEvent.contextMenu(empty, { button: 2 })).toBe(true);
    touch(tile, "contextmenu", { button: 2 });
    expect(screen.queryByRole("region", { name: "Word definitions" })).toBeNull();
    expect(fireEvent.contextMenu(tile, { button: 2 })).toBe(false);
  }

  const tip = within(phone
    ? screen.getByRole("dialog", { name: "Words at K8" })
    : screen.getByRole("region", { name: "Word definitions" }));
  await tip.findByText("moon");
  expect(tip.getByText("Across")).toBeTruthy();
  expect(tip.getByText("COTE")).toBeTruthy();
  expect(tip.getByRole("link", { name: "côte" }).getAttribute("href"))
    .toBe("https://en.wiktionary.org/wiki/c%C3%B4te#French");
  expect(tip.queryByText(/CC BY-SA 4\.0/)).toBeNull();
  expect(tip.getByText("côté")).toBeTruthy();
  expect(tip.getByText("Down")).toBeTruthy();
  expect(tip.getByText("LUNE")).toBeTruthy();
  expect(tip.queryByText(/per (billion|million) words|No wordfreq estimate/)).toBeNull();
  expect(current().board[115]).toBe("e");
  expect(selectedCell()).toBeUndefined();
  expect(tile.getAttribute("data-definition-open")).toBe("true");
  expect(fetchDefinitions.mock.calls.filter(([url]) => url.startsWith("/api/definitions?"))
    .map(([url]) => url)).toEqual(["/api/definitions?language=fr&word=COTE&word=LUNE"]);
  if (phone) {
    const close = tip.getByRole("button", { name: "Close dialog" });
    expect(document.activeElement).toBe(tip.getByRole("heading", { name: "Words at K8" }));
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.click(close);
    expect(screen.queryByRole("dialog", { name: "Words at K8" })).toBeNull();
    expect(cell("Define")).toBeTruthy();
    expect(empty).toHaveProperty("disabled", false);
    expect(document.activeElement).not.toBe(entry());
  } else {
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("region", { name: "Word definitions" })).toBeNull();
  }
});

test.each(["touch", "mouse"])("a %s hold toggles a placed blank without moving the board cursor", async (pointerType) => {
  const user = await start(pointerType === "touch" ? 390 : 1200);
  await user.click(cell("H8: DW, start"));
  await user.keyboard("CAT");
  await user.click(rackTile(1));
  const played = cell("I8: A");
  const pointer = (type: string, extra = {}) => touch(played, type, { pointerType, ...extra });

  vi.useFakeTimers();
  try {
    const waitForHold = () => act(() => vi.advanceTimersByTime(500));
    pointer("pointerdown");
    pointer("pointermove", { clientY: 65 });
    pointer("pointercancel");
    waitForHold();
    expect(current().board[113]).toBe("A");
    expect(selectedCell()).toBeUndefined();

    pointer("pointerdown");
    const context = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    fireEvent(played, context);
    expect(context.defaultPrevented).toBe(true);
    waitForHold();
    expect(cell("I8: A blank")).toBe(played);
    expect(current().board[113]).toBe("a");
    pointer("pointerup");
    fireEvent.click(played);
    expect(document.activeElement).not.toBe(entry());
    expect(selectedCell()).toBeUndefined();

    fireEvent.click(cell("K8: empty"));
    expect(selectedCell()).toBe("115");
    pointer("pointerdown");
    waitForHold();
    pointer("pointerup");
    fireEvent.click(played);
    expect(current().board[113]).toBe("A");
    expect(selectedCell()).toBe("115");
    expect(document.activeElement).toBe(entry());

    pointer("pointerdown");
    pointer("pointerup");
    fireEvent.click(played);
    waitForHold();
    expect(current().board[113]).toBe("A");
    expect(selectedCell()).toBe("113");
    expect(document.activeElement).toBe(entry());
  } finally {
    vi.useRealTimers();
  }
  await user.click(cell("Undo"));
  expect(current().board[113]).toBe("a");
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

test("switching profiles clears focus from the profile selector", async () => {
  remote.profiles.push({ id: "other", name: "Other profile" });
  remote.games.push({ ...game(), id: "other-game", profileId: "other", name: "Other game" });
  const user = await start();
  const selector = screen.getByRole("combobox", { name: "Current profile" });
  act(() => selector.focus());
  expect(document.activeElement).toBe(selector);

  await user.selectOptions(selector, "other");

  expect(selector).toHaveProperty("value", "other");
  expect(document.activeElement).not.toBe(selector);
  expect(await screen.findByRole("heading", { name: "Other game" })).toBeTruthy();
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
  await user.click(screen.getByRole("link", { name: "Board studio" }));
  expect(location.pathname).toBe("/board-studio");
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
  const bag = (count: number) =>
    screen.getByRole("button", {
      name: `Unseen tiles, ${count} estimated tiles in the bag`,
    });
  expect(bag(93).textContent).toBe("93");
  await typeRack(user, "A ");
  expect(bag(91).textContent).toBe("91");
  await user.click(cell("H8: DW, start"));
  await user.keyboard(" Q");
  expect(bag(90).textContent).toBe("90");
  expect(bag(90).getAttribute("aria-expanded")).toBe("false");
  await user.click(bag(90));
  expect(bag(90).getAttribute("aria-expanded")).toBe("true");
  const pool = () =>
    within(screen.getByRole("list", { name: "Unseen tile counts" }));
  expect(
    pool().getByRole("listitem", { name: "Blank: 0 unseen" }),
  ).toBeTruthy();
  expect(pool().getByRole("listitem", { name: "Q: 1 unseen" })).toBeTruthy();
  const filter = screen.getByRole<HTMLSelectElement>("combobox", { name: "Filter unseen tiles" });
  await user.selectOptions(filter, "remaining");
  expect(pool().queryByRole("listitem", { name: /^Blank:/ })).toBeNull();
  await user.selectOptions(filter, "high");
  expect(pool().queryByRole("listitem", { name: /^A:/ })).toBeNull();
  expect(pool().getByRole("listitem", { name: "Q: 1 unseen" })).toBeTruthy();
  const summary = screen.getByText(/unseen tiles?$/, {
    selector: ".tile-pool summary strong",
  });
  const details = summary.closest("details")!;
  await user.click(summary);
  await waitFor(() => expect(bag(90).getAttribute("aria-expanded")).toBe("false"));
  expect(details.open).toBe(false);
  bag(90).focus();
  await user.keyboard("{Enter}");
  expect(details.open).toBe(true);
  expect(filter.value).toBe("high");
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(bag(91).textContent).toBe("91");
  await user.selectOptions(filter, "all");
  expect(
    pool().getByRole("listitem", { name: "Blank: 1 unseen" }),
  ).toBeTruthy();
  expect(screen.getByText("1 blank", { selector: ".tile-pool-breakdown span" })).toBeTruthy();
  await user.click(bag(91));
  expect(details.open).toBe(false);
});

test("the Lexulous bag icon and Optimal exchange both subtract an eight-tile opponent rack", async () => {
  const exchangeBags: number[] = [];
  vi.stubGlobal("Worker", class extends SolverWorker {
    postMessage(request: SolverRequest | PracticeRequest) {
      if (request.kind === "optimal-exchange") exchangeBags.push(request.exchange.bag);
      else if ("id" in request) super.postMessage(request);
    }
  });
  const template = PRESETS.find(({ id }) => id === "lexulous")!;
  const tiles = Object.entries(template.tileCounts!).flatMap(([tile, count]) => Array<string>(count).fill(tile));
  const board = emptyBoard(template.size);
  board.splice(0, 51, ...tiles.slice(0, 51));
  remote.games[0] = { ...game(), revision: 1, template, board, rack: tiles.slice(51, 59).join("") };
  const user = await start();
  const bag = await screen.findByRole("button", { name: "Unseen tiles, 22 estimated tiles in the bag" });
  expect(bag.textContent).toBe("22");
  expect(screen.queryByRole("button", { name: "Unseen tiles, 23 estimated tiles in the bag" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Optimal exchange" }));
  const exchange = within(screen.getByRole("region", { name: "Optimal exchange" }));
  expect(exchange.getByText("Bingo chance after the opponent’s turn")).toBeTruthy();
  expect(exchange.queryByText(/estimated in bag/)).toBeNull();
  expect(exchangeBags).toEqual([22]);
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

  await user.click(screen.getByRole("link", { name: "Archived games" }));
  const archive = screen.getByRole("button", { name: /^Archived match/ });
  expect(palette(archive.querySelector("svg.board-thumbnail"))).toBe(
    "in-person",
  );
  await user.click(archive);
  await waitFor(() => expect(palette(board())).toBe("in-person"));
});

test("Game options labels imported premiums and follows undo and redo", async () => {
  const template = PRESETS.find(({ id }) => id === "wordfeud")!;
  const premiums = [...template.premiums];
  premiums[0] = "DW";
  const imported = importBoard({ ...game(), template }, game().board, premiums);
  remote.games[0] = { ...imported, originalPremiums: undefined, revision: 1 };
  const user = await start();
  await waitFor(() => expect(current().revision).toBe(1));
  async function expectLayout(name: string) {
    const options = await openGameOptions(user);
    expect(options.getByText(`${name} · 15 × 15`)).toBeTruthy();
    await user.click(options.getByRole("button", { name: "Close dialog" }));
  }
  await expectLayout("Wordfeud (custom)");
  await user.click(screen.getByRole("button", { name: "Undo" }));
  await expectLayout("Wordfeud");
  await user.click(screen.getByRole("button", { name: "Redo" }));
  await expectLayout("Wordfeud (custom)");
});

test("new games start with score tracking on even after an earlier opt-out", async () => {
  const user = await start();
  async function createGame(name: string, trackScores: boolean) {
    await user.click(screen.getByRole("button", { name: "New game" }));
    const setup = within(screen.getByRole("dialog"));
    const tracking = setup.getByRole("checkbox", { name: "Track scores" });
    expect(tracking).toHaveProperty("checked", true);
    if (!trackScores) await user.click(tracking);
    await user.type(setup.getByLabelText("Opponent"), name);
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
  const noScoreBadge = () =>
    screen.queryByText("No score", {
      selector: ".game-heading .game-title-score",
    });
  const historyIcon = () =>
    within(cell("Switch game")).queryByRole("img", {
      name: "Incomplete move history",
    });
  expect(noScoreBadge()).toBeTruthy();
  expect(historyIcon()).toBeTruthy();
  await createGame("Tracked opponent", true);
  expect(noScoreBadge()).toBeNull();
  expect(historyIcon()).toBeNull();
  expect(scoreTotals()).toBe("0–0");
  expect(trackedScore().hasAttribute("data-turn")).toBe(false);
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
  let options = await openGameManagement(user);
  expect(options.getByRole("button", { name: "Archive game" })).toBeTruthy();
  await user.click(
    options.getByRole("button", { name: "Archive & start new game" }),
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
  await user.click(navLink("Archived games"));
  const archive = within(
    screen.getByRole("region", { name: "Archived games" }),
  );
  await user.click(archive.getByRole("button", { name: /^First game/ }));
  options = await openGameManagement(user);
  expect(options.getByRole("button", { name: "Move to My games" })).toBeTruthy();
  expect(options.queryByRole("button", { name: "Archive & start new game" })).toBeNull();
});

test("starting a new game from My games keeps the current game and copies its settings", async () => {
  const original = {
    ...game(),
    revision: 1,
    platform: "Scrabble GO",
    startedOn: "2026-10-08",
    notes: "Notes from this match",
    trackScores: false,
    rack: "CAT",
  };
  original.board[original.template.start] = "A";
  remote.games[0] = original;
  const user = await start();
  await waitFor(() => expect(current().revision).toBe(original.revision));
  const options = await openGameManagement(user);
  const startRow = options.getByRole("group", { name: "Start or duplicate" });
  const archiveRow = options.getByRole("group", { name: "Archive actions" });
  expect(within(startRow).getByRole("button", { name: "Duplicate game" })).toBeTruthy();
  expect(within(archiveRow).getByRole("button", { name: "Archive game" })).toBeTruthy();
  expect(within(archiveRow).getByRole("button", { name: "Archive & start new game" })).toBeTruthy();
  expect(startRow.nextElementSibling).toBe(archiveRow);
  const end = options.getByRole("button", { name: "End game" });
  expect(archiveRow.nextElementSibling).toBe(end.parentElement);
  expect(within(end.parentElement!).getAllByRole("button")).toEqual([end]);
  await user.click(within(startRow).getByRole("button", { name: "Start new game" }));
  await screen.findByText("New game started.");
  const [previous, fresh] = remote.games;
  expect(previous).toEqual(original);
  expect(fresh).toMatchObject({
    id: "g1",
    profileId: original.profileId,
    name: original.name,
    platform: original.platform,
    dictionaryId: original.dictionaryId,
    template: original.template,
    startedOn: localDate(),
    trackScores: false,
    archived: false,
    board: emptyBoard(original.template.size),
    rack: "",
    past: [],
    future: [],
  });
  expect(fresh.notes).toBeUndefined();
  expect(localStorage.getItem("tilewise:game")).toBe(fresh.id);
  expect(document.querySelector(".board-entry .square.occupied")).toBeNull();
});

test("sidebar Stats filters archived games and updates the monthly metric", async () => {
  const archived = (
    id: string, platform: string, rules: Game["template"]["rules"],
    endedOn: string, you: number, opponent: number,
  ) => archiveGame({
    ...game(),
    id,
    platform,
    template: { ...game().template, rules },
    startedOn: "2024-12-31",
    scoring: { ...emptyScoring(), end: { manual: true, endedOn, scores: { you, opponent } } },
  });
  remote.games.push(
    archived("one", "Wordfeud", "wordfeud-fr", "2025-01-02", 400, 300),
    archived("two", "Word feud", "wordfeud", "2026-04-12", 300, 380),
    archived("three", "Lexulous", "lexulous-it", "2026-05-02", 500, 400),
    { ...archived("different", "Wordfeud", "wordfeud-fr", "2025-01-02", 900, 300), profileId: "other" },
  );
  const user = await start(390);
  await user.click(cell("Open sidebar"));
  await user.click(navLink("Stats"));
  const stats = within(await screen.findByRole("region", { name: "Stats" }));
  await stats.findByText("of 3 games in this profile");
  expect(stats.getByText("400", { selector: "dd" })).toBeTruthy();
  expect(location.pathname).toBe("/stats");

  await user.selectOptions(stats.getByRole("combobox", { name: "Platform" }), "platform:wordfeud");
  expect(stats.getByText("350", { selector: "dd" })).toBeTruthy();
  await user.selectOptions(stats.getByRole("combobox", { name: "Language" }), "fr");
  await user.selectOptions(stats.getByRole("combobox", { name: "Year" }), "2025");
  expect(stats.getByText("400", { selector: "dd" })).toBeTruthy();
  await user.selectOptions(stats.getByRole("combobox", { name: "Trend metric" }), "winRate");
  expect(Object.fromEntries(new URLSearchParams(location.search))).toEqual({
    profile: "p", platform: "platform:wordfeud", language: "fr", year: "2025", metric: "winRate",
  });
  await user.click(stats.getByText("Monthly values"));
  const table = within(stats.getByRole("table", { name: "Monthly win rate" }));
  expect(table.getByRole("row", { name: /Jan.*2025.*100%.*1/ })).toBeTruthy();
  await user.selectOptions(stats.getByRole("combobox", { name: "Year" }), "2026");
  expect(stats.getByRole("status").textContent).toBe("No archived games match these filters.");
  history.back();
  await waitFor(() => expect(stats.getByRole("combobox", { name: "Year" })).toHaveProperty("value", "2025"));
  expect(stats.getByRole("combobox", { name: "Trend metric" })).toHaveProperty("value", "winRate");
  await user.click(stats.getByRole("button", { name: "Back to games" }));
  await screen.findByRole("heading", { name: /First game/ });
});

test("solo games track one score, use the whole bag, and restart solo from the archive", async () => {
  const user = await start(1200);
  await user.click(cell("New game"));
  const setup = within(screen.getByRole("dialog", { name: "New game" }));
  await user.selectOptions(setup.getByRole("combobox", { name: "Players" }), "1");
  expect(setup.queryByRole("textbox", { name: "Opponent" })).toBeNull();
  await user.type(setup.getByRole("textbox", { name: "Game name" }), "Practice run");
  await user.click(setup.getByRole("button", { name: "Create game" }));
  await screen.findByRole("heading", { name: "Practice run" });
  const id = remote.games[1].id;
  const solo = () => store.getSnapshot().games[id];
  expect(solo().solo).toBe(true);
  expect(scoreTotals()).toBe("0");
  await typeRack(user, "CAT");
  expect(screen.getByRole("button", { name: "Unseen tiles, 97 tiles in the bag" })).toBeTruthy();
  await user.click(cell("Enter your play"));
  await user.click(cell("H8: DW, start"));
  await user.keyboard("CAT{Enter}");
  expect(solo().rack).toBe("");
  expect(solo().trackedMoves).toMatchObject([{ player: "you", word: "CAT", score: 10 }]);
  expect(scoreTotals()).toBe("10");
  expect(scoreDelta()).toBeNull();
  await user.click(cell("Undo"));
  expect(solo().rack).toBe("CAT");
  expect(scoreTotals()).toBe("0");
  await user.click(cell("Redo"));
  expect(scoreTotals()).toBe("10");

  await user.click(cell("Review game"));
  const review = within(screen.getByRole("dialog", { name: "Review game" }));
  expect(review.queryByRole("button", { name: "Opponent plays" })).toBeNull();
  await user.click(review.getByRole("button", { name: /1 · CAT · 10 pts/ }));
  expect(review.getByRole("button", { name: "Find alternatives" })).toBeTruthy();
  await user.click(review.getByRole("button", { name: "Close dialog" }));

  const options = await openGameManagement(user);
  await user.click(options.getByRole("button", { name: "End game" }));
  const finish = within(screen.getByRole("dialog", { name: "End game" }));
  expect(finish.getAllByRole("spinbutton")).toHaveLength(1);
  expect(finish.getByRole("spinbutton", { name: "Your final score" })).toHaveProperty("value", "10");
  expect(finish.queryByRole("combobox", { name: "Result" })).toBeNull();
  await user.click(finish.getByRole("button", { name: "End game" }));

  await user.click(navLink("Archived games"));
  const archive = within(screen.getByRole("region", { name: "Archived games" }));
  await user.click(archive.getByRole("button", { name: /^Practice run/ }));
  expect(scoreTotals()).toBe("10");
  const archivedOptions = await openGameManagement(user);
  await user.click(archivedOptions.getByRole("button", { name: /^Start new game/ }));
  await screen.findByText("New game started.");
  expect(remote.games[2]).toMatchObject({
    name: "Practice run", solo: true, archived: false, rack: "",
    board: emptyBoard(15), startedOn: localDate(),
  });
  expect(scoreTotals()).toBe("0");
});

test("solo games show their playing styles and load each sampled utility breakdown", async () => {
  remote.games[0] = { ...game(), solo: true, revision: 1 };
  class SoloStyleWorker extends SolverWorker {
    private position?: Extract<SolverRequest, { kind: "solve" }>;

    postMessage(request: SolverRequest) {
      if (request.kind === "solve") this.position = request;
      if (request.kind !== "bingo-hunter") return super.postMessage(request);

      const position = this.position;
      const result = this.results.get(request.searchId);
      const style = request.style;
      if (!position?.solo || !result || !isSoloSimulatedStyle(style)) return;
      const words = ["AT", "CAT", "CATS", "ACT", "DOG", "RAT", "ART", "TAR"];
      const search = createSoloStyleSearch(new Lexicon(words), position, result.moves, style);
      for (const _ of search.steps) { /* complete the search */ }
      const { ranked, limited } = search.result();
      result.setProfile({ profile: style, profileBagSize: request.bagSize, profileSeed: request.id }, ranked);
      queueMicrotask(() => this.onmessage?.({
        data: { id: request.id, kind: "bingo-hunter", summary: { checked: ranked.length, limited } },
      }));
    }
  }
  vi.stubGlobal("Worker", SoloStyleWorker);
  const user = await start(1200);
  await waitFor(() => expect(current().solo).toBe(true));
  await typeRack(user, "CATS");
  await user.keyboard("{Enter}");
  const picker = await screen.findByRole("combobox", { name: "Playing style" });
  expect(within(picker).getAllByRole("option").map((option) => option.textContent)).toEqual([
    "No style", "Casual", "Learner", "Strong", "Greedy Bingo", "Score Lookahead", "Bingo & Triple Words",
  ]);
  await user.selectOptions(picker, "greedy-bingo");
  await user.click(screen.getByRole("button", { name: "Run Greedy Bingo" }));
  await user.click((await screen.findAllByRole("button", { name: /^Utility breakdown for/ }))[0]);
  expect(within(screen.getByRole("tooltip")).getByText("Next-turn bingo chance")).toBeTruthy();
  expect(within(screen.getByRole("tooltip")).queryByText("Expected bingo points next turn")).toBeNull();
  await user.keyboard("{Escape}");
  await user.selectOptions(picker, "triple-play");
  await user.click(screen.getByRole("button", { name: "Run Score Lookahead" }));
  await user.click((await screen.findAllByRole("button", { name: /^Utility breakdown for/ }))[0]);
  const lookahead = within(screen.getByRole("tooltip"));
  expect(lookahead.getByText("Score Lookahead · Rank 1")).toBeTruthy();
  expect(lookahead.getByText("Expected points two turns ahead")).toBeTruthy();
  expect(localStorage.getItem("tilemaxx:playing-style:g")).toBe("triple-play");
  await user.keyboard("{Escape}");
  await user.selectOptions(picker, "triple-threat");
  await user.click(screen.getByRole("button", { name: "Run Bingo & Triple Words" }));
  await user.click((await screen.findAllByRole("button", { name: /^Utility breakdown for/ }))[0]);
  const tripleWords = within(screen.getByRole("tooltip"));
  expect(tripleWords.getByText("Bingo & Triple Words · Rank 1")).toBeTruthy();
  expect(tripleWords.getByText("Play points now")).toBeTruthy();
  expect(tripleWords.getByText("Next-turn bingo chance")).toBeTruthy();
  expect(tripleWords.getByText("Triple-word lane adjustment")).toBeTruthy();
  expect(localStorage.getItem("tilemaxx:playing-style:g")).toBe("triple-threat");
});

test("starting another game from an archive copies settings onto a fresh board", async () => {
  const original = game();
  original.id = "archived";
  original.name = "Morgan";
  original.platform = "Wordfeud";
  original.startedOn = "2026-10-08";
  original.template = structuredClone(PRESETS.find(({ id }) => id === "wordfeud")!);
  original.originalPremiums = [...original.template.premiums];
  original.template.premiums[0] = "DW";
  original.dictionaryId = "other";
  remote.dictionaries.push({ ...remote.dictionaries[0], id: "other", name: "Other words" });
  original.board[original.template.start] = "A";
  original.rack = "CAT";
  original.notes = "Notes from the first match";
  original.trackScores = false;
  original.scoring = emptyScoring();
  original.trackedMoves = [{ player: "you", word: "AT", score: 4, at: "2026-10-08" }];
  original.past = [{
    board: emptyBoard(original.template.size),
    rack: "",
    label: "Previous board",
    at: "2026-10-08",
  }];
  const archived = archiveGame(original);
  remote.games.push(archived);
  const user = await start();
  await user.click(navLink("Archived games"));
  const archive = within(screen.getByRole("region", { name: "Archived games" }));
  await user.click(archive.getByRole("button", { name: /^Morgan/ }));
  const options = await openGameOptions(user);
  expect(options.getByRole("region", { name: "Board tools" })).toBeTruthy();
  expect(options.getByRole("region", { name: "Game details" })).toBeTruthy();
  const manage = options.getByText("Manage game", { selector: "summary" });
  expect(manage.closest("details")?.open).toBe(false);
  await user.click(manage);
  expect(manage.closest("details")?.open).toBe(true);
  await user.click(options.getByRole("button", { name: /^Start new game/ }));

  await screen.findByText("New game started.");
  const fresh = remote.games[2];
  expect(localStorage.getItem("tilewise:game")).toBe(fresh.id);
  expect(navLink("My games").getAttribute("aria-current")).toBe("page");
  expect(document.querySelector(".board-entry .square.occupied")).toBeNull();
  expect(fresh).toMatchObject({
    name: original.name,
    platform: original.platform,
    startedOn: localDate(),
    template: original.template,
    originalPremiums: original.originalPremiums,
    dictionaryId: original.dictionaryId,
    trackScores: false,
    archived: false,
    board: emptyBoard(original.template.size),
    rack: "",
    past: [],
    future: [],
  });
  expect(fresh.notes).toBeUndefined();
  expect(fresh.scoring).toBeUndefined();
  expect(fresh.trackedMoves).toBeUndefined();
  expect(remote.games[1]).toEqual(archived);
});

test("new games and copies require a connection while a saved game stays editable", async () => {
  const user = await start();
  const connectedFetch = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
  await act(() => store.refresh());
  const newGame = screen.getByRole<HTMLButtonElement>("button", { name: "New game" });
  expect(newGame.disabled).toBe(true);
  const menu = await openGameManagement(user);
  expect(menu.getByRole<HTMLButtonElement>("button", { name: "Duplicate game" }).disabled).toBe(true);
  await user.click(menu.getByRole("button", { name: "Close dialog" }));
  await typeRack(user, "CAT");
  expect(current().rack).toBe("CAT");
  expect(remote.games).toHaveLength(1);

  vi.stubGlobal("fetch", connectedFetch);
  await act(() => store.refresh());
  expect(newGame.disabled).toBe(false);
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
  await user.type(screen.getByLabelText("Opponent"), "Second game");
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
  const dictionary = (options: Awaited<ReturnType<typeof openGameOptions>>) =>
    options.getByRole<HTMLSelectElement>("combobox", { name: "Game dictionary" });
  let options = await openGameOptions(user);
  await user.selectOptions(dictionary(options), "other");
  await user.click(options.getByRole("button", { name: "Close dialog" }));
  expect(screen.getByText("Scrabble GO · Other words", { selector: ".game-heading-metadata" })).toBeTruthy();
  await act(() => store.flush());
  await user.click(cell("Switch game"));
  await user.click(screen.getByRole("menuitemradio", { name: /^First game/ }));
  expect(current().rack).toBe("CAT");
  expect(screen.getByText("Test words", { selector: ".game-heading-metadata" })).toBeTruthy();
  options = await openGameOptions(user);
  expect(dictionary(options).value).toBe("test");
  await user.click(options.getByRole("button", { name: "Close dialog" }));
  expect(remote.games.find((g) => g.name === "Second game")?.dictionaryId).toBe(
    "other",
  );
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("button", { name: "dark theme" }));
  expect(localStorage.getItem("tilemaxx:theme")).toBe("dark");
  await user.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(
    Object.values(store.snapshot.games).find((g) => g.name === "Second game")!
      .rack,
  ).toBe("DOG");
  await user.click(cell("Switch game"));
  await user.click(screen.getByRole("menuitemradio", { name: /^Second game/ }));
  options = await openGameOptions(user);
  expect(dictionary(options).value).toBe("other");
});

test("archive rows show saved tracked scores and outcome colors from summaries", async () => {
  const player = (points: number) => ({ points, moves: 1, best: points, bingos: 0 });
  const scoring = { you: player(300), opponent: player(280) };
  const finished = archiveGame({
    ...game(),
    id: "finished",
    name: "Finished opponent",
    scoring: {
      ...scoring,
      end: { out: "you", rackPoints: 4, endedOn: "2026-11-16" },
    },
  });
  remote.games.push(
    { ...finished, scoring: { ...scoring, you: player(350) } },
    { ...game(), id: "unfinished", name: "Unfinished opponent", archived: true, scoring },
    { ...game(), id: "untracked", name: "Untracked opponent", archived: true, trackScores: false },
    archiveGame({
      ...game(),
      id: "manual",
      name: "Manually ended opponent",
      trackScores: false,
      scoring: {
        ...scoring,
        end: { manual: true, outcome: "loss", scores: { you: 280, opponent: 300 } },
      },
    }),
  );
  const user = await start();
  await act(() => store.refresh());
  await user.click(navLink("Archived games"));
  const row = (name: string) =>
    within(screen.getByRole("region", { name: "Archived games" }))
      .getByRole("button", { name: new RegExp(`^${name}`) });
  const badge = (name: string) => within(row(name)).getByRole("group", { name: "Tracked score" });
  expect(badge("Finished opponent").textContent).toBe("304–276");
  expect(badge("Finished opponent").getAttribute("data-outcome")).toBe("win");
  expect(row("Finished opponent").querySelector("time")?.dateTime).toBe("2026-11-16");
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

  const board = () => within(screen.getByRole("region", { name: "Game board" }));
  const replay = () => screen.getByRole("button", { name: "Replay finish animation" });
  expect(board().queryByRole("heading", { name: "You win!" })).toBeNull();
  await user.click(replay());
  expect(board().getByRole("heading", { name: "You win!" })).toBeTruthy();
  expect(board().getByText("Won by 28")).toBeTruthy();
  const startSquare = board().getByRole("button", { name: /^H8:/ });
  expect(startSquare).toHaveProperty("disabled", true);
  expect(board().queryByRole("button", { name: "Archive game" })).toBeNull();
  await user.click(screen.getByRole("heading", { name: "Finished opponent" }));
  expect(board().queryByRole("heading", { name: "You win!" })).toBeNull();
  expect(startSquare).toHaveProperty("disabled", false);

  await user.click(navLink("Archived games"));
  await user.click(row("Manually ended opponent"));
  await screen.findByRole("heading", { name: "Manually ended opponent" });
  await screen.findByRole("button", { name: "Replay finish animation" });
  expect(board().queryByRole("heading", { name: "You lose" })).toBeNull();
  act(() => replay().focus());
  await user.keyboard("{Enter}");
  expect(board().getByRole("heading", { name: "You lose" })).toBeTruthy();
  expect(board().getByText("Lost by 20")).toBeTruthy();
  expect(board().queryByText(/went out/)).toBeNull();
  await user.keyboard("{Escape}");
  expect(board().queryByRole("heading", { name: "You lose" })).toBeNull();
});

test("archived games sort by finishing time with date and last-move fallbacks and can filter by opponent", async () => {
  remote.dictionaries.push({
    ...remote.dictionaries[0], id: "club", name: "Club word list", builtin: false,
  });
  remote.games.push(
    {
      ...game(),
      id: "recent",
      name: "Sam Cooke",
      dictionaryId: "club",
      archived: true,
      startedOn: "2026-04-01",
      scoring: {
        you: { points: 0, moves: 0, best: 0, bingos: 0 },
        opponent: { points: 0, moves: 0, best: 0, bingos: 0 },
        end: { manual: true, endedOn: "2026-06-05", endedAt: "2026-06-05T20:00:00.000Z" },
      },
    },
    {
      ...game(),
      id: "early",
      name: "Alba",
      archived: true,
      startedOn: "2026-06-05",
      trackedMoves: [
        { player: "you", word: "CAT", score: 10, at: "2026-06-05T10:00:00.000Z" },
      ],
      scoring: {
        you: { points: 10, moves: 1, best: 10, bingos: 0 },
        opponent: { points: 0, moves: 0, best: 0, bingos: 0 },
        end: { manual: true, endedOn: "2026-06-05", endedAt: "2026-06-05T15:00:00.000Z" },
      },
    },
    {
      ...game(),
      id: "legacy",
      name: "Zora",
      archived: true,
      startedOn: "2026-06-05",
      updatedAt: "2026-06-06T23:00:00.000Z",
      trackedMoves: [
        { player: "you", word: "CAT", score: 10, at: "2026-06-05T17:00:00.000Z" },
      ],
    },
    {
      ...game(),
      id: "older",
      name: "Alex Sampson",
      archived: true,
      startedOn: "2026-05-12",
    },
    {
      ...game(),
      id: "other",
      name: "Morgan",
      platform: "Sam",
      dictionaryId: "unavailable",
      archived: true,
      startedOn: "2026-06-01",
    },
  );
  const user = await start();
  await act(() => store.refresh());
  await user.click(navLink("Archived games"));
  const archive = within(screen.getByRole("region", { name: "Archived games" }));
  const search = archive.getByRole("searchbox", { name: "Filter by opponent" });
  const sort = archive.getByRole("combobox", { name: "Sort by" });
  const count = archive.getByRole("status", { name: "Archived game count" });
  const names = () =>
    archive
      .queryAllByRole("listitem")
      .map((row) => row.querySelector("strong")?.textContent);

  expect(count.textContent).toBe("5");
  expect(names()).toEqual(["Sam Cooke", "Zora", "Alba", "Morgan", "Alex Sampson"]);
  expect(archive.getAllByText("Ended Jun 5, 2026")).toHaveLength(2);
  expect(archive.getByRole("button", { name: /^Sam Cooke.*Club word list.*Ended/ })).toBeTruthy();
  expect(archive.getByRole("button", { name: /^Alex Sampson.*Test words/ })).toBeTruthy();
  expect(archive.getByRole("button", { name: /^Morgan.*Sam · Word list unavailable/ })).toBeTruthy();
  expect(store.getSnapshot().games.recent).toBeUndefined();
  await user.type(search, " sAm ");
  expect(names()).toEqual(["Sam Cooke", "Alex Sampson"]);
  expect(count.textContent).toBe("2 / 5");
  await user.selectOptions(sort, "opponent");
  expect(names()).toEqual(["Alex Sampson", "Sam Cooke"]);
  expect(search).toHaveProperty("value", " sAm ");
  await user.type(search, "Z");
  expect(names()).toHaveLength(0);
  expect(count.textContent).toBe("0 / 5");
  expect(archive.getByText("No matching games.")).toBeTruthy();
  await user.clear(search);
  expect(names()).toEqual(["Alba", "Alex Sampson", "Morgan", "Sam Cooke", "Zora"]);
  expect(count.textContent).toBe("5");
});

test("Review changes lists conflicts and opens the selected warning across profiles", async () => {
  const active = { ...game(), id: "g2", name: "Open match", revision: 2 };
  const archived = {
    ...archiveGame(game()),
    id: "g3",
    name: "Finished match",
    profileId: "other",
    revision: 3,
  };
  remote.profiles.push({ id: "other", name: "Other profile" });
  remote.games.push(active, archived);
  const user = await start();
  await waitFor(() => expect(store.snapshot.data?.games).toHaveLength(3));

  const fetchMock = vi.mocked(fetch);
  const fetchNormally = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((url, options) => {
    const target = [active, archived].find(({ id }) => url === `/api/games/${id}`);
    if (target && options?.method === "PUT") {
      return Promise.resolve(
        new Response(JSON.stringify({ game: target }), { status: 409 }),
      );
    }
    return fetchNormally(url, options);
  });
  await act(async () => {
    for (const target of [active, archived]) {
      store.update({ ...target, revision: target.revision - 1, rack: "A" });
    }
    await store.flush();
  });

  const review = screen.getByRole("button", { name: "Review changes" });
  const list = () => screen.getByRole("list", { name: "Games with sync conflicts" });
  expect(review.getAttribute("aria-expanded")).toBe("false");
  await user.hover(review);
  const activeItem = within(list()).getByRole("button", { name: /Open match/ });
  expect(within(list()).getByRole("button", { name: /Finished match.*Other profile.*Archived/ })).toBeTruthy();
  expect(within(list()).queryByText("First game")).toBeNull();
  const movePointerFrom = (from: HTMLElement, to: HTMLElement) => {
    const event = new MouseEvent("pointerout", { bubbles: true, relatedTarget: to });
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    fireEvent(from, event);
  };
  movePointerFrom(review, activeItem);
  expect(review.getAttribute("aria-expanded")).toBe("true");
  movePointerFrom(activeItem, document.body);
  expect(review.getAttribute("aria-expanded")).toBe("false");

  act(() => review.focus());
  await user.keyboard("{Enter}{Tab}{Tab}");
  expect(document.activeElement).toBe(within(list()).getByRole("button", { name: /Finished match/ }));
  await user.keyboard("{Escape}");
  expect(review.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(review);
  await user.keyboard("{Enter}{Tab}{Tab}{Enter}");
  expect(await screen.findByRole("heading", { name: "Finished match" })).toBeTruthy();
  expect((screen.getByRole("combobox", { name: "Current profile" }) as HTMLSelectElement).value).toBe("other");
  const warning = screen.getByText(/This game changed on another device/).closest(".banner");
  expect(document.activeElement).toBe(warning);
  expect(review.getAttribute("aria-expanded")).toBe("false");

  await user.click(screen.getByRole("button", { name: "Use server version" }));
  await user.hover(review);
  expect(within(list()).getByRole("button", { name: /Open match/ })).toBeTruthy();
  expect(within(list()).queryByText("Finished match")).toBeNull();
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
  await user.click(navLink("Archived games"));
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
  await user.click(navLink("Archived games"));
  const names = () =>
    archived()
      .getAllByRole("listitem")
      .map((row) => within(row).getAllByRole("button")[0].textContent);
  expect(names()).toEqual([
    "ZoeTest words · May 12, 2026",
    "Saved matchTest words · Apr 20, 2025",
    "AlexTest words · Date not set",
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
  expect(names()[0]).toBe("SamClub night · Test words · Jun 1, 2026");
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
  expect(screen.getByText("Club night · Test words", { selector: ".game-heading-metadata" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Switch game" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Back to archived games" })).toBeNull();
  expect(navLink("Archived games").getAttribute("aria-current")).toBe("page");
  expect(navLink("My games").getAttribute("aria-current")).toBeNull();
  expect(rackTile(1).getAttribute("aria-label")).toBe("Rack tile 1: D");
  const details = await openGameOptions(user);
  expect(details.getByText("Review the endgame.")).toBeTruthy();
  expect(details.getByText("Archived", { exact: true })).toBeTruthy();
  await user.click(details.getByRole("button", { name: "Close dialog" }));
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
  await user.click((await openGameManagement(user)).getByRole("button", { name: "Restore game" }));
  expect(cell("I8: empty")).toBeTruthy();
  expect(cell("H8: Z, start")).toBeTruthy();
  expect(screen.queryByText("Check tile counts")).toBeNull();
  const restored = await openGameOptions(user);
  expect(restored.getByText("Review the endgame.")).toBeTruthy();
  await user.click(restored.getByRole("button", { name: "Close dialog" }));
  await store.flush();
  expect(remote.games.find((g) => g.id === "archived")).toMatchObject({
    archived: true,
    board: archivedBoard,
  });
  await user.click(navLink("Archived games"));
  expect(location.pathname).toBe("/archived-games");
  expect(names()[0]).toBe("SamClub night · Test words · Jun 1, 2026");
  expect(screen.queryByRole("heading", { name: "Sam" })).toBeNull();
  await user.click(navLink("My games"));
  expect(screen.getByRole("heading", { name: "First game" })).toBeTruthy();
  expect(cell("Switch game")).toBeTruthy();
  expect(navLink("My games").getAttribute("aria-current")).toBe("page");
});

test("the game header, picker, and archive mark incomplete move histories", async () => {
  const user = await start();
  const icon = { name: "Incomplete move history" };
  expect(within(cell("Switch game")).queryByRole("img", icon)).toBeNull();
  await user.click(cell("H8: DW, start"));
  await user.keyboard("C");
  expect(within(cell("Switch game")).queryByRole("img", icon)).toBeNull();
  await user.keyboard("AT");
  await act(() => store.flush());
  await act(() => store.refresh());
  expect(within(cell("Switch game")).queryByRole("img", icon)).toBeNull();
  await user.click(cell("Record opponent move"));
  await act(() => store.flush());
  expect(within(cell("Switch game")).queryByRole("img", icon)).toBeNull();
  expect(screen.queryByText("TIP", { exact: true })).toBeNull();

  const complete = current();
  remote.games.push(
    { ...game(), id: "active-partial", name: "Active partial match", board: complete.board },
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
  expect(within(active).queryByRole("img", icon)).toBeNull();
  const activePartial = screen.getByRole("menuitemradio", { name: /^Active partial match/ });
  expect(within(activePartial).getByRole("img", icon)).toBeTruthy();
  await user.click(activePartial);
  await screen.findByRole("heading", { name: "Active partial match" });
  expect(within(cell("Switch game")).getByRole("img", icon)).toBeTruthy();
  expect(cell("Switch game").getAttribute("aria-description")).toContain(icon.name);
  await user.click(navLink("Archived games"));
  const tracked = screen.getByRole("button", { name: /^Tracked match/ });
  expect(within(tracked).queryByRole("img", icon)).toBeNull();
  const partial = screen.getByRole("button", { name: /^Partial match/ });
  expect(within(partial).getByRole("img", icon)).toBeTruthy();
  await user.click(partial);
  const heading = await screen.findByRole("heading", { name: "Partial match" });
  expect(within(heading.closest("header")!).getByRole("img", icon)).toBeTruthy();
});

test.each(["phone", "tablet", "desktop"])(
  "the %s header shows the platform and word list with the selector in Game options",
  async (layout) => {
    Object.assign(remote.games[0], {
      revision: 1,
      platform: "Lexulous",
      startedOn: "2026-02-18",
      notes: "Club round",
    });
    const user = await start(layout === "phone" ? 360 : layout === "tablet" ? 820 : 1200);
    await waitFor(() => expect(current().revision).toBe(1));
    const heading = cell("Game options").closest("header")!;
    expect(within(heading).getByText("Lexulous · Test words")).toBeTruthy();
    expect(within(heading).getByRole("group", { name: "Tracked score" })).toBeTruthy();
    expect(heading.querySelector("time")).toBeNull();
    const board = screen.getByRole("region", { name: "Game board" });
    expect(board.parentElement?.firstElementChild).toBe(board);
    const scores = screen.getByRole("region", { name: "Game scores" });
    const moves = screen.getByRole("heading", { name: "Possible moves" });
    expect(moves.compareDocumentPosition(scores)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryByRole("combobox", { name: "Game dictionary" })).toBeNull();
    const options = await openGameOptions(user);
    expect(options.getByRole("combobox", { name: "Game dictionary" })).toBeTruthy();
    expect(options.getByText("Club round")).toBeTruthy();
    expect(options.getByText("Started", { exact: true })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Game options" }).querySelector("time")?.dateTime).toBe("2026-02-18");
    expect(options.getByText("Scrabble · 15 × 15")).toBeTruthy();
  },
);

test("Word list checker shows lookup progress and defines only words found in a supported list", async () => {
  const base = remote.dictionaries[0];
  remote.dictionaries.push(
    { ...base, id: "french-list", name: "Grammalecte 7.7", builtin: false },
    { ...base, id: "english-list", name: "CSW24", builtin: false },
  );
  class CheckerWorker extends SolverWorker {
    postMessage(request: SolverRequest | WordListCheckRequest) {
      if (!("source" in request)) return super.postMessage(request);
      const { id, source, word } = request;
      const found = (source === "french-list" && word === "COEUR") ||
        (source === "english-list" && word === "DOG");
      queueMicrotask(() => this.onmessage?.({ data: { id, found } }));
    }
  }
  vi.stubGlobal("Worker", CheckerWorker);
  const request = fetch;
  let finishLookup: (() => void) | undefined;
  const lookup = vi.fn(async (url: string, options?: RequestInit) => {
    if (!url.startsWith("/api/definitions?")) return request(url, options);
    const query = new URLSearchParams(url.split("?")[1]);
    const word = query.get("word");
    if (word === "COEUR" && query.get("language") === "fr") {
      return new Promise<Response>((resolve) => {
        finishLookup = () => resolve(new Response(JSON.stringify({ available: true, entries: [[{
          spelling: "cœur", headword: "cœur", glosses: ["heart"], partOfSpeech: "noun",
          sourceUrl: "https://en.wiktionary.org/wiki/c%C5%93ur#French",
        }]] })));
      });
    }
    return new Response(JSON.stringify({ available: false, entries: [] }));
  });
  vi.stubGlobal("fetch", lookup);
  const requests = () => lookup.mock.calls.map(([url]) => url).filter((url) => url.startsWith("/api/definitions?"));

  const user = await start();
  await user.click(navLink("Word list checker"));
  const checker = within(screen.getByRole("dialog", { name: "Word list checker" }));
  const list = checker.getByRole("combobox", { name: "Word list" });
  const input = checker.getByRole("textbox", { name: "Word" });
  const status = checker.getByRole("status");
  const submit = checker.getByRole("button", { name: "Check word" });
  expect(checker.getAllByRole("textbox")).toEqual([input]);
  expect(checker.getAllByRole("combobox")).toEqual([list]);

  await user.selectOptions(list, "french-list");
  await user.type(input, "cœur");
  expect(requests()).toEqual([]);
  await user.keyboard("{Enter}");
  expect(status.textContent).toContain("COEUR is in Grammalecte 7.7.");
  expect(checker.getByText("Looking up definitions…")).toBeTruthy();
  expect(requests()).toEqual(["/api/definitions?language=fr&word=COEUR"]);
  await act(() => finishLookup?.());
  expect(await checker.findByText("heart")).toBeTruthy();
  expect(checker.queryByText("Looking up definitions…")).toBeNull();
  expect(checker.getByRole("link", { name: "cœur" }).getAttribute("href")).toContain("#French");

  await user.selectOptions(list, "english-list");
  expect(checker.queryByText("heart")).toBeNull();
  await user.clear(input);
  await user.type(input, "cat");
  expect(requests()).toHaveLength(1);
  await user.click(submit);
  expect(status.textContent).toContain("CAT is absent from CSW24.");
  expect(checker.queryByText(/definition/i)).toBeNull();
  expect(requests()).toHaveLength(1);

  await user.clear(input);
  await user.type(input, "dog{Enter}");
  expect(status.textContent).toContain("DOG is in CSW24.");
  expect(requests().at(-1)).toBe("/api/definitions?language=en&word=DOG");
  expect(checker.queryByText(/definitions unavailable/i)).toBeNull();

  await user.selectOptions(list, "test");
  await user.click(submit);
  expect(status.textContent).toContain("DOG is absent from Test words.");
  expect(requests()).toHaveLength(2);
});

test("word lists confirm removal, display a conflict and update the game selector", async () => {
  remote.dictionaries.push({
    id: "house",
    name: "House words",
    count: 4,
    builtin: false,
    description: "Imported word list",
  });
  const user = await start();
  let options = await openGameOptions(user);
  const gameDictionary = () => options.getByRole<HTMLSelectElement>("combobox", { name: "Game dictionary" });
  const picker = gameDictionary();
  await options.findByRole("option", { name: "House words" });
  await user.selectOptions(picker, "house");
  await waitFor(() => expect(remote.games[0].dictionaryId).toBe("house"));
  const wordLists = () => options.getByRole("button", { name: "About word lists" });
  await user.click(wordLists());
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
  options = await openGameOptions(user);
  await user.selectOptions(gameDictionary(), "test");
  await waitFor(() => expect(remote.games[0].dictionaryId).toBe("test"));
  await user.click(wordLists());
  await remove();
  await confirm();
  expect(await screen.findByText("House words removed.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Remove House words" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Close dialog" }));
  options = await openGameOptions(user);
  expect(options.queryByRole("option", { name: "House words" })).toBeNull();
  expect(gameDictionary().value).toBe("test");
});

test("the sidebar checker uses the selected list or local file independently of the game", async () => {
  remote.dictionaries.push({
    id: "house",
    name: "House words",
    count: 1,
    builtin: false,
    description: "Imported word list",
  });
  const requests: WordListCheckRequest[] = [];
  let delayed: (() => void) | undefined;
  class CheckerWorker extends SolverWorker {
    postMessage(request: SolverRequest | WordListCheckRequest) {
      if (!("source" in request)) return super.postMessage(request);
      requests.push(request);
      const { id, word, source } = request;
      const reply = (found: boolean) => this.onmessage?.({ data: { id, found } });
      if (word === "WAIT") delayed = () => reply(true);
      else queueMicrotask(() => reply(
        (source === "test" && word === "CAT") || (source instanceof File && word === "DOG"),
      ));
    }
  }
  vi.stubGlobal("Worker", CheckerWorker);
  const user = await start();
  await user.click(screen.getByRole("link", { name: "Word list checker" }));
  const dialog = within(screen.getByRole("dialog", { name: "Word list checker" }));
  const list = dialog.getByRole<HTMLSelectElement>("combobox", { name: "Word list" });
  const word = dialog.getByRole("textbox", { name: "Word" });
  const status = dialog.getByRole("status");
  expect(list.value).toBe("test");
  expect(document.activeElement).toBe(word);
  await user.keyboard(" cat {Enter}");
  expect(status.textContent).toContain("CAT is in Test words.");
  expect(requests[0]).toMatchObject({ word: "CAT", source: "test" });

  await dialog.findByRole("option", { name: "House words" });
  await user.selectOptions(list, "house");
  expect(status.textContent).toBe("");
  await user.click(dialog.getByRole("button", { name: "Check word" }));
  expect(status.textContent).toContain("CAT is absent from House words.");
  await user.clear(word);
  await user.type(word, "two words{Enter}");
  expect(status.textContent).toContain("Enter one word");
  expect(requests).toHaveLength(2);

  await user.clear(word);
  await user.type(word, "wait{Enter}");
  expect(status.textContent).toContain("Checking House words");
  const file = new File(["DOG\n"], "club.txt", { type: "text/plain" });
  await user.upload(dialog.getByLabelText("Open word list file"), file);
  expect(list.selectedOptions[0].textContent).toBe("club.txt (local file)");
  await user.clear(word);
  await user.type(word, "dog{Enter}");
  expect(requests.at(-1)?.source).toBe(file);
  expect(status.textContent).toContain("DOG is in club.txt.");
  await act(() => delayed?.());
  expect(status.textContent).toContain("DOG is in club.txt.");
  await user.click(dialog.getByRole("button", { name: "Close dialog" }));
  expect(current().dictionaryId).toBe("test");
  expect(remote.dictionaries.map(({ id }) => id)).toEqual(["test", "house"]);
});

test.each([
  { width: 1320, overlay: false },
  { width: 820, overlay: true },
  { width: 390, overlay: true },
])("the sidebar collapses and reopens at $width px", async ({ width, overlay }) => {
  const user = await start(width);
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
  expect(collapse().previousElementSibling?.classList.contains("brand")).toBe(true);
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

test("resizing changes the game layout once and preserves open score history", async () => {
  const user = await start(751);
  const header = screen.getByRole("heading", { name: "First game" }).closest("header")!;
  const moves = screen.getByRole("region", { name: "Possible moves" });
  const scores = screen.getByRole("region", { name: "Game scores" });
  expect(scores.previousElementSibling).toBe(moves);
  const history = within(scores).getByText("Tracked move history");
  await user.click(history);
  const shell = header.closest(".app-shell")!;
  const sidebar = () => screen.queryByRole("complementary", { name: "Sidebar" });
  expect(shell.classList.contains("stacked-game")).toBe(true);
  expect(shell.classList.contains("phone-layout")).toBe(true);

  for (const width of [752, 800, 801, 960, 991, 992, 1150, 1500]) {
    act(() => resizeShell(width));
    expect(shell.classList.contains("compact-game"), String(width)).toBe(true);
    expect(shell.classList.contains("phone-layout"), String(width)).toBe(false);
    expect(!!sidebar(), String(width)).toBe(width >= 992);
    expect(screen.getByRole("region", { name: "Game scores" })).toBe(scores);
    expect(scores.previousElementSibling).toBe(moves);
    expect(history.closest("details")?.open).toBe(true);
  }

  await user.click(cell("Collapse sidebar"));
  expect(shell.classList.contains("compact-game")).toBe(true);
  await user.click(within(header).getByRole("button", { name: "Open sidebar" }));
  expect(shell.classList.contains("compact-game")).toBe(true);

  act(() => resizeShell(820));
  expect(sidebar()).toBeNull();
  await user.click(within(header).getByRole("button", { name: "Open sidebar" }));
  expect(shell.classList.contains("compact-game")).toBe(true);
  expect(shell.querySelector(".sidebar-scrim")).toBeTruthy();
  act(() => resizeShell(751));
  expect(shell.classList.contains("stacked-game")).toBe(true);
  expect(shell.classList.contains("phone-layout")).toBe(true);
  expect(history.closest("details")?.open).toBe(true);
  expect(document.querySelector(".breadcrumb, .topbar")).toBeNull();
});

test("the desktop board offers screenshot import next to its entry hint while empty", async () => {
  const user = await start(820);
  const board = within(screen.getByRole("region", { name: "Game board" }));
  const importShortcut = () => board.queryByRole("button", { name: "Import screenshot" });
  expect(importShortcut()?.nextElementSibling).toBe(board.getByText("Tap a square and type"));
  await user.click(importShortcut()!);
  const screenshot = screen.getByRole("dialog", { name: "Import a screenshot" });
  await user.click(within(screenshot).getByRole("button", { name: "Close dialog" }));

  await user.click(cell("H8: DW, start"));
  await user.keyboard("C");
  expect(importShortcut()).toBeNull();
  const options = await openGameOptions(user);
  for (const name of ["Import screenshot", "Move history", "Board help"])
    expect(options.getByRole("button", { name })).toBeTruthy();
  await user.click(options.getByRole("button", { name: "Close dialog" }));
  await user.click(board.getByRole("button", { name: "Undo" }));
  expect(importShortcut()).toBeTruthy();
});

test.each([false, true])("the sidebar opens the illustrated guide (phone %s)", async (phone) => {
  const user = await start(phone ? 360 : 1200);
  if (phone)
    await user.click(screen.getByRole("button", { name: "Open sidebar" }));
  const menu = within(screen.getByRole("complementary", { name: "Sidebar" }));
  await user.click(menu.getByRole("link", { name: "UI guide" }));

  const guide = within(screen.getByRole("dialog", { name: "UI guide" }));
  expect(guide.getByRole("img").getAttribute("alt")).toMatch(
    phone ? /selected JILT/ : /sidebar, board, rack/,
  );
  if (phone) return;

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
  const user = await start(360);
  const main = within(screen.getByRole("main"));
  const menu = main.getByRole("button", { name: "Open sidebar" });
  expect(menu.closest(".game-heading")).toBeTruthy();
  expect(document.querySelector(".breadcrumb")).toBeNull();
  expect(main.queryByRole("button", { name: "dark theme" })).toBeNull();
  await user.click(menu);
  const sidebar = within(screen.getByRole("complementary"));
  expect(sidebar.queryByRole("group", { name: "Color theme" })).toBeNull();
  const settingsButton = sidebar.getByRole("button", { name: "Settings" });
  expect(settingsButton.textContent).toBe("");
  expect(settingsButton.nextElementSibling).toBe(sidebar.getByText(`v${version}`));
  await user.click(settingsButton);
  const settings = within(screen.getByRole("dialog", { name: "Settings" }));
  const theme = settings.getByRole("group", { name: "Color theme" });
  await user.click(within(theme).getByRole("button", { name: "dark theme" }));
  expect(document.documentElement.dataset.theme).toBe("dark");
  await user.click(settings.getByRole("button", { name: "Close dialog" }));
  await user.click(main.getByRole("button", { name: "Open sidebar" }));
  await user.click(sidebar.getByRole("link", { name: "My games" }));

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
  expect(main.queryByRole("button", { name: "Toggle entry direction" })).toBeNull();
  expect(entryTools?.contains(main.getByRole("button", { name: "Define" }))).toBe(true);
  await user.click(cell("H8: DW, start"));
  await user.keyboard("C");
  expect(main.getByText("8I · Space: blank · Tap again: Down")).toBeTruthy();
  await user.click(undo);
  expect(current().board[112]).toBe("");
  await user.click(redo);
  expect(current().board[112]).toBe("C");
  await user.click(undo);

  const rack = within(screen.getByRole("region", { name: "Your rack" }));
  const findMoves = main.getByRole("button", { name: "Find moves" });
  expect(rack.queryByRole("heading", { name: "Your rack" })).toBeNull();
  expect(rack.queryByRole("button", { name: "Find moves" })).toBeNull();
  const tiles = rack.getByRole("group", { name: "Your rack tiles" });
  const tools = rack.getByText("Rack tools").closest(".rack-lane-tools");
  const bag = rack.getByRole("button", { name: /Unseen tiles,/ });
  expect(tools?.nextElementSibling).toBe(tiles.parentElement);
  expect(tiles.parentElement?.nextElementSibling).toBe(bag);
  expect(findMoves.hasAttribute("disabled")).toBe(true);
  await typeRack(user, "CAT");
  await user.click(findMoves);
  await screen.findAllByRole("button", { name: /^CAT, / });
  const search = main.getByRole("button", { name: "Search possible moves" });
  const header = search.closest("header")!;
  const toolbar = within(header);
  const optionsMenu = toolbar.getByText("Options", { selector: "summary" });
  const stylePicker = toolbar.getByRole("combobox", { name: "Playing style" });
  const allMoves = toolbar.getByRole("button", { name: "All moves" });
  expect(allMoves.textContent).toBe("");
  expect(allMoves.querySelector(".lucide-list")).toBeTruthy();
  expect(toolbar.getByRole("button", { name: "Close possible moves" })).toBeTruthy();
  expect(optionsMenu.closest("details")?.open).toBe(false);
  const moveMenu = await openMoveOptions(user);
  expect(moveMenu.queryByRole("combobox", { name: "Playing style" })).toBeNull();
  expect(moveMenu.queryByRole("button", { name: "All moves" })).toBeNull();
  expect(moveMenu.getByRole("button", { name: /^Shortlist/ })).toBeTruthy();
  expect(moveMenu.getByRole("button", { name: "Analyze" }).closest("details")).toBe(optionsMenu.closest("details"));
  act(() => moveMenu.getByRole("button", { name: "Mark squares" }).focus());
  await user.keyboard("{Escape}");
  expect(document.activeElement).toBe(optionsMenu);
  expect(optionsMenu.closest("details")?.open).toBe(false);
  expect(toolbar.queryByRole("textbox", { name: "Filter moves" })).toBeNull();
  await user.click(search);
  const filter = toolbar.getByRole("textbox", { name: "Filter moves" });
  expect(toolbar.getByRole("combobox", { name: "Playing style" })).toBe(stylePicker);
  expect(toolbar.getByRole("button", { name: "All moves" })).toBe(allMoves);
  expect(document.activeElement).toBe(filter);
  await user.type(filter, "CAT");
  expect(main.queryByRole("button", { name: /^ACT, / })).toBeNull();
  expect((await openMoveOptions(user)).getByRole("button", { name: /^Shortlist/ })).toBeTruthy();
  await user.click(filter);
  expect(optionsMenu.closest("details")?.open).toBe(false);
  await user.keyboard("{Escape}");
  expect(toolbar.queryByRole("textbox", { name: "Filter moves" })).toBeNull();
  expect(document.activeElement).toBe(search);
  await user.click(search);
  expect(search.getAttribute("aria-expanded")).toBe("true");
  await user.click(search);
  expect(search.getAttribute("aria-expanded")).toBe("false");
  expect(toolbar.queryByRole("textbox", { name: "Filter moves" })).toBeNull();
  expect(toolbar.getByRole("button", { name: "All moves" })).toBe(allMoves);
  expect(main.getByRole("button", { name: "Undo" }).closest(".board-review-actions")).toBeTruthy();
  await chooseMoveOption(user, "Mark squares");
  expect(optionsMenu.closest("details")?.open).toBe(false);
  const markControls = main.getByRole("button", { name: "Done" }).closest(".move-square-controls");
  expect(markControls?.contains(main.getByRole("button", { name: "Undo" }))).toBe(true);
  const redoWhileMarking = main.getByRole("button", { name: "Redo" });
  expect(markControls?.contains(redoWhileMarking)).toBe(true);
  await user.click(redoWhileMarking);
  expect(current().board[112]).toBe("C");
});

test("entering the opponent's final tile updates the score and ends the game on the phone", async () => {
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
  const user = await start(390);
  await waitFor(() => expect(scoreTotals()).toBe("20–10"));
  expect(trackedScore().getAttribute("data-outcome")).toBe("playing");
  expect(trackedScore().classList.contains("value-good")).toBe(false);
  expect(scoreDelta()?.textContent).toBe("+10");
  expect(scoreDelta()?.classList.contains("value-good")).toBe(true);
  expect(screen.getByText("+10 pts").classList.contains("value-good")).toBe(true);
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
  expect(remote.games[0].scoring?.end).toEqual({
    out: "opponent",
    rackPoints: 10,
    endedOn: localDate(),
    endedAt: expect.any(String),
  });
  const undo = cell("Undo");
  expect(undo).toHaveProperty("disabled", true);
  await user.click(cell("Dismiss result"));
  expect(current().board[115]).toBe("S");
  await user.click(undo);
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
    const options = await openGameManagement(user);
    await user.click(options.getByRole("button", { name: "End game" }));
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
    endedOn: localDate(),
    endedAt: expect.any(String),
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
      scoring: {
        end: { manual: true, scores: { you: 30, opponent: 24 }, endedOn: localDate() },
      },
    },
  });
});

test.each([false, true])("a finished game can be resumed and have another move recorded (archived: %s)", async (archive) => {
  const user = await start();
  await user.click(cell("H8: DW, start"));
  await user.keyboard("CAT");
  await typeRack(user, "S");
  await user.click(cell("Find moves"));
  const before = current();
  expect(before.trackedMoves?.map(({ word }) => word)).toEqual(["CAT"]);

  const options = await openGameManagement(user);
  await user.click(options.getByRole("button", { name: "End game" }));
  const finish = within(screen.getByRole("dialog", { name: "End game" }));
  if (!archive) await user.click(finish.getByRole("checkbox", { name: "Archive game" }));
  await user.click(finish.getByRole("button", { name: "End game" }));
  await act(() => store.flush());
  expect(remote.games[0].archived).toBe(archive);
  expect(remote.games[0].scoring?.end?.endedAt).toBeTruthy();

  if (archive) {
    const sidebar = screen.queryByRole("button", { name: "Open sidebar" });
    if (sidebar) await user.click(sidebar);
    await user.click(navLink("Archived games"));
    await user.click(await screen.findByRole("button", { name: /^First game/ }));
    await screen.findByRole("heading", { name: "First game" });
    await user.click(cell("A1: TW"));
    await user.keyboard("Q");
    expect(cell("A1: Q, edited after archiving")).toBeTruthy();
    const management = await openGameManagement(user);
    const resume = management.getByRole("button", { name: /Resume game/ });
    expect(management.getByRole("group", { name: "Archive actions" }).nextElementSibling).toBe(resume.parentElement);
    await user.click(resume);
  } else {
    await user.click(within(screen.getByRole("region", { name: "Possible moves" })).getByRole("button", { name: "Resume game" }));
  }
  expect(current().archived).toBe(false);
  expect(current().scoring?.end).toBeUndefined();
  expect(current().board).toEqual(before.board);
  expect(current().rack).toBe("S");
  expect(scoreTotals()).toBe("0–10");
  expect(current().trackedMoves).toEqual(before.trackedMoves);
  const findMoves = screen.queryByRole("button", { name: "Find moves" });
  if (findMoves) await user.click(findMoves);
  await user.click(await screen.findByRole("button", { name: /^CATS, / }));
  await act(() => store.flush());
  expect(remote.games[0].trackedMoves?.map(({ word }) => word)).toEqual(["CAT", "CATS"]);
  expect(remote.games[0].scoring?.end).toBeUndefined();
  expect(scoreTotals()).toBe("6–10");
  if (archive) {
    await user.click((await openGameManagement(user)).getByRole("button", { name: "End game" }));
    await user.click(within(screen.getByRole("dialog", { name: "End game" })).getByRole("button", { name: "End game" }));
    await act(() => store.flush());
    expect(remote.games[0].archivedState?.scoring?.end).toMatchObject({
      manual: true, scores: { you: 6, opponent: 10 },
    });
    expect(remote.games[0].archivedState?.trackedMoves?.map(({ word }) => word)).toEqual(["CAT", "CATS"]);
  }
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
    const options = await openGameManagement(user);
    await user.click(options.getByRole("button", { name: "End game" }));

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

test.each([52, 380])("phone rack entry reveals the tiles above the keyboard and restores the page (%i px rack)", async (rackHeight) => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
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

  const user = await start(390);
  const rack = screen.getByRole("group", { name: "Your rack tiles" });
  vi.spyOn(rack, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(28, 640 - scrollY, 48, rackHeight),
  );
  vi.spyOn(rackTile(3), "getBoundingClientRect").mockImplementation(
    () => new DOMRect(28, 660 - scrollY, 32, 32),
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
  expect(rack.closest(".move-review")).toBeTruthy();
});

test.each([
  { layout: "phone", width: 390 },
  { layout: "desktop", width: 950 },
])("on $layout, dictionary warnings appear between the latest-turn strip and the board", async ({ layout, width }) => {
  class ValidatingWorker extends SolverWorker {
    protected boardWarnings(
      lexicon: Lexicon,
      request: Extract<SolverRequest, { kind: "solve" }>,
    ) {
      return inspectBoard(lexicon, request.board, request.template);
    }
  }
  vi.stubGlobal("Worker", ValidatingWorker);

  const fixture = remote.games[0];
  fixture.revision++;
  fixture.board.splice(fixture.template.start, 3, "C", "A", "T");
  fixture.trackedMoves = [
    { word: "CAT", player: "you", score: 10, bingo: false, at: "2026-11-20T10:00:00Z" },
  ];
  fixture.scoring = {
    ...emptyScoring(),
    you: { points: 10, moves: 1, best: 10, bingos: 0 },
  };
  const user = await start(width);
  const board = screen.getByRole("region", { name: "Game board" });
  const workspace = board.closest<HTMLElement>(".workspace-grid")!;
  await user.click(cell("G8: empty"));
  await user.keyboard("Z");
  await typeRack(user, "CATS");
  await user.keyboard("{Enter}");

  const warningArea = layout === "phone" ? within(workspace) : within(board);
  const warning = await warningArea.findByRole("alert");
  expect(warning.textContent).toBe("Not in this dictionary: ZCAT.");
  if (layout === "phone") {
    expect(warning.parentElement).toBe(board.parentElement);
    expect(warning.previousElementSibling).toBe(screen.getByRole("region", { name: "Your rack" }));
  } else {
    expect(warning.previousElementSibling?.querySelector(".last-play-word")).toBeTruthy();
    expect(warning.nextElementSibling).toBe(board.querySelector(".board-entry"));
  }
  expect(workspace.classList.contains("move-review")).toBe(layout === "phone");

  await user.click(cell("A1: TW"));
  await user.keyboard("DOG{Enter}");
  const warnings = await warningArea.findByRole("alert");
  expect(Array.from(warnings.querySelectorAll(":scope > p"), (message) => message.textContent)).toEqual([
    "Some tiles are disconnected. Check the board transcription.",
    "Not in this dictionary: ZCAT.",
  ]);
  expect(warnings.querySelectorAll("svg")).toHaveLength(1);

  await user.click(cell("G8: Z"));
  await user.keyboard("{Delete}");
  expect(warningArea.queryByRole("alert")).toBeNull();
});

test.each([
  { layout: "phone", width: 390 },
  { layout: "narrow laptop", width: 690 },
])("on a $layout, the rack stays beside the board through search, preview, and close", async ({ layout, width }) => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query !== "(any-hover: hover)",
    addEventListener() {},
    removeEventListener() {},
  }));
  const user = await start(width);
  const board = document.querySelector(".board-entry")!;
  const workspace = board.closest(".workspace-grid")!;
  const reviewing = () => workspace.classList.contains("move-review");
  const ghosts = () => board.querySelectorAll(".ghost");
  const rack = screen.getByRole("region", { name: "Your rack" });
  const column = board.closest(".phone-board-column");
  const divider = screen.getByRole("slider", { name: "Board size" });
  const expectFixedLayout = () => {
    expect(column).toBeTruthy();
    expect(board.closest(".phone-board-column")).toBe(column);
    expect(rack.closest(".phone-board-column")).toBe(column);
    expect(divider.closest(".phone-board-column")).toBe(column);
    expect(screen.getByRole("region", { name: "Your rack" })).toBe(rack);
  };
  expectFixedLayout();
  expect(reviewing()).toBe(false);
  await typeRack(user, "CATSQ");
  await user.keyboard("{Enter}");
  const row = (await screen.findAllByRole("button", { name: /^CATS, / }))[0];
  expect(reviewing()).toBe(true);
  expect(ghosts()).toHaveLength(0);

  await user.click(row);
  expect(ghosts()).toHaveLength(4);
  expectFixedLayout();
  expect(document.querySelectorAll(".board-grid")).toHaveLength(1);
  expect(
    screen.getByRole("button", { name: "Play" }).hasAttribute("disabled"),
  ).toBe(false);
  expect(current().board.some(Boolean)).toBe(false);

  const outside = screen.getByRole("heading", { name: "Possible moves" });
  await user.pointer({ keys: "[TouchA]", target: outside });
  expect(row.classList.contains("pinned")).toBe(false);
  expect(ghosts()).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Play" })).toHaveProperty("disabled", true);
  expect(current().board.some(Boolean)).toBe(false);

  await user.pointer({ keys: "[TouchA]", target: row });
  expect(ghosts()).toHaveLength(4);

  await user.click(rackTile(2));
  expect(reviewing()).toBe(false);
  expect(ghosts()).toHaveLength(0);
  expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("textbox", { name: "Rack letters" }),
  );
  expect(current().rack).toBe("CATSQ");

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

  expect(current().rack).toBe("Q");
  expect(rackTile(2).getAttribute("aria-pressed")).toBe("true");
  await user.keyboard("XZ{Enter}");
  expect(current().rack).toBe("QXZ");
  await screen.findByRole("heading", { name: "No legal moves found" });
  expect(reviewing()).toBe(false);
  await user.click(screen.getByRole("button", { name: "Close possible moves" }));
  expect(reviewing()).toBe(false);
  expectFixedLayout();
});

test.each(["phone", "desktop"])("%s square selection filters moves without editing the board", async (layout) => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const user = await start(layout === "phone" ? 390 : 1200);
  await typeRack(user, "CATS");
  await user.keyboard("{Enter}");
  const catRows = () => screen.findAllByRole("button", { name: /^CAT, / });
  const original = await catRows();
  expect(original.some((row) => /down/.test(row.getAttribute("aria-label")!))).toBe(true);
  const filter = async () => (await openMoveOptions(user)).getByRole("button", { name: "Mark squares" });
  await user.click(await filter());
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
  expect((await openMoveOptions(user)).getByRole<HTMLButtonElement>("button", { name: "Analyze" }).disabled).toBe(true);
  await user.click(diagonal);
  const [match] = await catRows();
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(document.activeElement).toBe(screen.getByText("Options", { selector: "summary" }));
  expect((await filter()).getAttribute("aria-pressed")).toBe("false");
  await act(() => match.focus());
  expect(document.querySelector('.board-entry [data-cell="113"].ghost.move-filter-square')).toBeTruthy();

  await user.click(await filter());
  await user.click(screen.getByRole("button", { name: "Clear" }));
  expect(await catRows()).toHaveLength(original.length);
  await user.click(cell("I8: empty"));
  await user.keyboard("{Escape}");
  expect((await filter()).getAttribute("aria-pressed")).toBe("false");
  await user.click(cell("H8: DW, start"));
  await user.keyboard("A");
  expect(current().board[112]).toBe("A");
  expect(document.querySelector(".board-entry .move-filter-square")).toBeNull();
});

function finishFixture(out: "you" | "opponent") {
  const initial = game();
  const { start } = initial.template;
  const yourFinish = out === "you";
  initial.board.splice(start, yourFinish ? 3 : 2, ...("CAT".slice(0, yourFinish ? 3 : 2)));
  initial.rack = yourFinish ? "S" : "Q";
  initial.scoring = emptyScoring();
  initial.scoring.you.points = yourFinish ? 10 : 20;
  initial.scoring.opponent.points = yourFinish ? 25 : 10;
  initial.template = {
    ...initial.template,
    tileCounts: Object.fromEntries(
      TILE_SYMBOLS.map((tile) => [tile, Number("ACQST".includes(tile))]),
    ),
  };
  return { ...initial, revision: initial.revision + 1 };
}

test.each([1200, 390])("finish overlay waits for the last tile, dismisses outside the card, and archives in place at %s px", async (width) => {
  const phone = width === 390;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: !phone && query === "(any-hover: hover)",
    addEventListener() {},
    removeEventListener() {},
  }));
  remote.games[0] = finishFixture("you");
  remote.games.push({ ...game(), id: "second", name: "Other active game" });
  const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: () => ({ finished, cancel() {} }),
  });
  const rect = HTMLElement.prototype.getBoundingClientRect;
  const geometry = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      if (this.matches(".board-grid")) return new DOMRect(10, 20, 300, 320);
      if (this.matches(".board-finish")) return new DOMRect(10, 20, 500, 530);
      if (this.matches('[data-cell="0"]')) return new DOMRect(40, 70, 24, 24);
      if (this.matches('[data-cell="224"]')) return new DOMRect(480, 510, 24, 24);
      return this.matches(".rack-slot-window, .square")
        ? new DOMRect(60, 80, 24, 24)
        : rect.call(this);
    });
  try {
    const user = await start(width);
    await screen.findByRole("button", { name: "Rack tile 1: S" });
    const board = within(screen.getByRole("region", { name: "Game board" }));
    await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
    const [move] = await screen.findAllByRole("button", { name: /^CATS, / });
    const reviewing = () => !!document.querySelector(".move-review");
    expect(reviewing()).toBe(phone);
    await user.click(move);
    if (phone) await user.click(board.getByRole("button", { name: "Play" }));
    await waitFor(() => expect(document.querySelector(".tile-flight-layer")).toBeTruthy());
    expect(reviewing()).toBe(phone);
    expect(board.queryByRole("heading", { name: "You win!" })).toBeNull();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await act(async () => finish());
      expect(document.querySelector(".tile-flight-layer")).toBeNull();
      expect(reviewing()).toBe(false);
      const outcome = board.getByRole("heading", { name: "You win!" });
      expect(document.activeElement).not.toBe(screen.getByRole("textbox", { name: "Rack letters" }));
      expect(outcome.closest(".board-grid")).toBeTruthy();
      expect(board.getByText("Won by 11")).toBeTruthy();
      expect(board.getByText(/You went out/).textContent).toContain("CATS +6");
      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      expect(board.getByRole("heading", { name: "You win!" })).toBe(outcome);
    } finally {
      vi.useRealTimers();
    }
    await user.click(board.getByRole("heading", { name: "You win!" }));
    expect(board.getByRole("heading", { name: "You win!" })).toBeTruthy();
    expect(board.queryByRole("button", { name: "View board" })).toBeNull();
    await user.click(board.getByRole("button", { name: "Dismiss result" }));
    expect(board.queryByRole("heading", { name: "You win!" })).toBeNull();
    expect(current().archived).toBe(false);
    const replay = screen.getByRole("button", { name: "Replay finish animation" });
    await user.click(replay);
    const firstReplay = board.getByRole("heading", { name: "You win!" });
    const overlay = firstReplay.closest<HTMLElement>(".board-finish")!;
    expect(overlay.style.getPropertyValue("--finish-x")).toBe("262px");
    expect(overlay.style.getPropertyValue("--finish-y")).toBe("282px");
    const particlePattern = () =>
      Array.from(document.querySelectorAll(".board-finish-fleck"), (particle) =>
        particle.getAttribute("style"),
      );
    const firstBurst = particlePattern();
    expect(firstBurst).toHaveLength(16);
    await user.click(replay);
    expect(board.getByRole("heading", { name: "You win!" })).not.toBe(firstReplay);
    const secondBurst = particlePattern();
    expect(secondBurst).toHaveLength(16);
    expect(secondBurst).not.toEqual(firstBurst);
    await user.keyboard("{Escape}");
    expect(board.queryByRole("heading", { name: "You win!" })).toBeNull();
    await user.click(board.getByRole("button", { name: "Undo" }));
    await user.click(board.getByRole("button", { name: "Redo" }));
    expect(board.queryByRole("heading", { name: "You win!" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Replay finish animation" }));
    const finished = current();
    await user.click(board.getByRole("button", { name: "Archive game" }));
    expect(board.queryByRole("heading", { name: "You win!" })).toBeNull();
    expect(screen.getByRole("heading", { name: "First game" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Switch game" })).toBeNull();
    expect(current().archived).toBe(true);
    expect(current().archivedBoard).toEqual(finished.board);
    expect(current().archivedState?.scoring).toEqual(finished.scoring);
    await act(() => store.flush());
    expect(remote.games[0].archived).toBe(true);
    expect(remote.games[1].archived).toBe(false);
  } finally {
    geometry.mockRestore();
    if (originalAnimate) Object.defineProperty(Element.prototype, "animate", originalAnimate);
    else Reflect.deleteProperty(Element.prototype, "animate");
  }
});

test("typing the opponent's last tile shows the adjusted loss and locks the board until dismissal", async () => {
  remote.games[0] = finishFixture("opponent");
  const user = await start();
  const board = within(screen.getByRole("region", { name: "Game board" }));
  await board.findByRole("button", { name: /^H8: C/ });
  await user.click(board.getByRole("button", { name: /^J8:/ }));
  expect(boardDirection()).toBe("Across");
  await user.keyboard("T");
  expect(board.queryByRole("heading", { name: "You lose" })).toBeNull();
  expect(document.activeElement).toBe(entry());

  await user.keyboard("S");
  const outcome = await board.findByRole("heading", { name: "You lose" });
  const result = within(outcome.closest('[role="status"]') as HTMLElement);
  expect(result.getByText("Lost by 16")).toBeTruthy();
  expect(result.getByText("10", { selector: ".board-finish-your-total" })).toBeTruthy();
  expect(result.getByText("26").classList.contains("board-finish-your-total")).toBe(false);
  const badge = screen.getByRole("button", { name: "Replay finish animation" });
  expect(badge.querySelector("svg")).toBeNull();
  expect(result.getByText("–", { selector: ".game-score-separator" }).textContent)
    .toBe(badge.querySelector(".game-score-separator")?.textContent);
  expect(board.getByText(/First game went out/).textContent).toContain("CATS +6");
  expect(document.activeElement).not.toBe(entry());

  const square = board.getByRole("button", { name: /^H8: C/ });
  const undo = board.getByRole("button", { name: "Undo" });
  const finishedBoard = current().board;
  expect(square).toHaveProperty("disabled", true);
  expect(entry()).toHaveProperty("disabled", true);
  expect(undo).toHaveProperty("disabled", true);
  expect(board.getByRole("button", { name: "Define" })).toHaveProperty("disabled", true);
  await user.click(square);
  await user.keyboard("Z{Backspace}");
  await user.click(undo);
  expect(current().board).toEqual(finishedBoard);

  await user.keyboard("{Escape}");
  expect(board.queryByRole("heading", { name: "You lose" })).toBeNull();
  expect(square).toHaveProperty("disabled", false);
  expect(entry()).toHaveProperty("disabled", false);
  expect(undo).toHaveProperty("disabled", false);
  await user.click(square);
  await user.keyboard("Z");
  expect(board.getByRole("button", { name: /^H8: Z/ })).toBeTruthy();
});

test("turning tracking on after a screenshot restores the saved move scores", async () => {
  const initial = game();
  const lexicon = new Lexicon(["CAT"]);
  const rack = "CAT";
  const move = solve(lexicon, initial.board, rack, initial.template)[0];
  const placed = [...initial.board];
  for (const tile of move.tiles) placed[tile.index] = tile.letter;
  remote.games[0] = importBoard(
    {
      ...initial,
      revision: initial.revision + 1,
      board: placed,
      past: [
        {
          board: initial.board,
          rack,
          label: "CAT",
          score: move.score,
          at: "2026-11-12T01:30:00.000Z",
        },
      ],
    },
    placed,
  );
  const user = await start();
  const scores = within(screen.getByRole("region", { name: "Game scores" }));
  await scores.findByText(/recover scores from saved moves/);
  expect(
    screen.getByText("No score", { selector: ".game-heading .game-title-score" }),
  ).toBeTruthy();
  const tracking = scores.getByRole("checkbox", { name: "Track scores" });
  expect(tracking).toHaveProperty("checked", false);
  expect(scores.queryByRole("button", { name: "Review game" })).toBeNull();
  await user.click(tracking);
  expect(tracking).toHaveProperty("checked", true);
  expect(scores.getByText(/1 move/)).toBeTruthy();
  const history = scores.getByText("Tracked move history");
  const expander = history.closest("details")!;
  const review = scores.getByRole("button", { name: "Review game" });
  expect(expander.open).toBe(false);
  expect(expander.contains(review)).toBe(false);
  await user.click(review);
  const dialog = screen.getByRole("dialog", { name: "Review game" });
  await user.click(within(dialog).getByRole("button", { name: "Close dialog" }));
  expect(expander.open).toBe(false);
  await user.click(history);
  expect(scores.getByRole("button", { name: "Review move 1: CAT" })).toBeTruthy();
  await waitFor(() => expect(remote.games[0].scoring?.you.points).toBe(move.score));
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(tracking).toHaveProperty("checked", false);
  await user.click(screen.getByRole("button", { name: "Redo" }));
  expect(tracking).toHaveProperty("checked", true);
  expect(scores.getByRole("button", { name: "Review move 1: CAT" })).toBeTruthy();
});

test("score tracking records typed opponent moves and solver plays across undo, redo and saving", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(any-hover: hover)",
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
  expect(titleScore()?.closest(".game-title-row")).toBeNull();
  const boardStrip = cell("Undo").closest(".board-panel .direct-entry-tools");
  expect(boardStrip?.contains(cell("Redo"))).toBe(true);
  expect(boardStrip?.textContent).toContain("Tap a square and type");
  expect(heading?.querySelector(".board-undo, .board-redo")).toBeNull();

  await user.click(cell("H8: DW, start"));
  await user.keyboard("CAQ{Backspace}T");
  expect(current().scoring?.opponent.moves).toBe(0);
  expect(scores().getByText("Opponent move ·").textContent).toBe("Opponent move · CAT · 10 pts");
  await typeRack(user, "S");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  expect(scoreTotals()).toBe("0–10");
  expect(trackedScore().getAttribute("data-turn")).toBe("you");
  expect(scores().getByRole("img", { name: "Your turn" })).toBeTruthy();
  expect(current().trackedMoves?.map(({ word }) => word)).toEqual(["CAT"]);
  await act(() => store.flush());
  expect(remote.games[0].scoring?.opponent.points).toBe(10);
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
  expect(trackedScore().getAttribute("data-turn")).toBe("opponent");
  expect(trackedScore().getAttribute("aria-description")).toContain("Opponent’s turn");
  expect(scores().getByRole("img", { name: "Opponent’s turn" })).toBeTruthy();
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
    ["2", "You", "(CAT)S", "6", "6", "—"],
    ["1", "Opp", "CAT", "10", "10", "—"],
  ]);
  await user.click(cell("Undo"));
  expect(current().scoring?.opponent.points).toBe(10);
  expect(current().scoring?.you.points).toBe(0);
  expect(scoreTotals()).toBe("0–10");
  expect(trackedScore().getAttribute("data-turn")).toBe("you");
  expect(current().board.slice(112, 116)).toEqual(["C", "A", "T", ""]);
  expect(moves().getAllByRole("row").slice(1)).toHaveLength(1);
  await user.click(cell("Undo"));
  expect(current().board.every((tile) => !tile)).toBe(true);
  expect(scoreTotals()).toBe("0–0");
  expect(trackedScore().hasAttribute("data-turn")).toBe(false);
  expect(scores().queryByText("Opponent move ·")).toBeNull();
  await user.click(cell("Redo"));
  expect(current().board.slice(112, 116)).toEqual(["C", "A", "T", ""]);
  expect(scoreTotals()).toBe("0–10");
  await user.click(cell("Redo"));
  expect(current().board.slice(112, 116)).toEqual(["C", "A", "T", "S"]);
  expect(scoreTotals()).toBe("6–10");
  expect(trackedScore().getAttribute("data-turn")).toBe("opponent");
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
  expect(scoreTotals()).toBe("0–13");
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

test("on a phone the score updates before choosing a reply and a missing tile can be added to that turn", async () => {
  const user = await start(390);
  await user.click(cell("H8: DW, start"));
  await user.keyboard("CAT");
  await typeRack(user, "S");
  const findMoves = () => screen.getByRole("button", { name: "Find moves" });
  await user.click(findMoves());
  expect(scoreTotals()).toBe("0–10");
  await screen.findByRole("button", { name: /^CATS, / });
  expect(document.querySelector(".move-review")).toBeTruthy();
  await user.click(cell("Edit last opponent move"));
  expect(scoreTotals()).toBe("0–0");
  expect(document.querySelector(".move-review")).toBeNull();
  await user.click(cell("K8: empty"));
  await user.keyboard("S{Enter}");
  expect(scoreTotals()).toBe("0–12");
  expect(current().trackedMoves?.map(({ word, score }) => [word, score])).toEqual([["CATS", 12]]);
  await user.click(cell("Undo"));
  expect(scoreTotals()).toBe("0–0");
  expect(current().board.every((tile) => !tile)).toBe(true);
  await user.click(cell("Redo"));
  expect(scoreTotals()).toBe("0–12");
});

test("holding a board tile corrects recorded scores and saves with undo and redo", async () => {
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
    .getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[3].textContent);
  const tile = cell("H8: C, start");
  vi.useFakeTimers();
  try {
    touch(tile, "pointerdown", { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(500));
    touch(tile, "pointerup", { pointerType: "mouse" });
    fireEvent.click(tile);
  } finally {
    vi.useRealTimers();
  }
  expect(cell("H8: C blank, start")).toBeTruthy();
  expect(scoreTotals()).toBe("3–4");
  expect(points()).toEqual(["3", "4"]);
  expect(cell("You CATS 3 pts 8H")).toBeTruthy();
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

test.each([false, true])("definitions work on recorded words and inside game review (phone %s)", async (phone) => {
  const opening = { ...game(), rack: "CAT", revision: 1 };
  const [move] = solve(new Lexicon(["CAT"]), opening.board, opening.rack, opening.template);
  remote.games[0] = playTrackedMove(opening, move, 90);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: !phone && query === "(any-hover: hover)",
    addEventListener() {},
    removeEventListener() {},
  }));
  const request = fetch;
  const lookup = vi.fn(async (url: string, options?: RequestInit) => {
    if (!url.startsWith("/api/definitions?")) return request(url, options);
    return new Response(JSON.stringify({
      available: true,
      entries: [[{ spelling: "cat", glosses: ["A domestic feline."] }]],
      wordFrequencyZipf: [4.78],
    }));
  });
  vi.stubGlobal("fetch", lookup);
  const user = await start(phone ? 390 : 1200);

  async function define(container: Element) {
    const word = container.querySelector("[data-move-id]")!;
    const parentDialog = word.closest("dialog");
    vi.useFakeTimers();
    try {
      if (phone) {
        touch(word, "pointerdown");
        expect(fireEvent.contextMenu(word)).toBe(false);
        await act(() => vi.advanceTimersByTimeAsync(450));
        const sheet = screen.getByRole("dialog", { name: "CAT" });
        expect(within(sheet).getByText("A domestic feline.")).toBeTruthy();
        expect(within(sheet).getByText("Common")).toBeTruthy();
        expect(within(sheet).getByText("~60.3 per million words")).toBeTruthy();
        touch(sheet, "pointerup");
        expect(fireEvent.click(word, { detail: 1 })).toBe(false);
        act(() => vi.advanceTimersByTime(32));
        const close = within(sheet).getByRole("button", { name: "Close dialog" });
        touch(close, "pointerdown");
        fireEvent.click(close, { detail: 1 });
        expect(screen.queryByRole("dialog", { name: "CAT" })).toBeNull();
      } else {
        touch(word, "pointerover", { pointerType: "mouse", buttons: 0 });
        await act(() => vi.advanceTimersByTimeAsync(500));
        const tip = screen.getByRole("tooltip");
        expect(within(tip).getByText("A domestic feline.")).toBeTruthy();
        expect(within(tip).getByText("Common")).toBeTruthy();
        expect(within(tip).getByText("~60.3 per million words")).toBeTruthy();
        expect(tip.closest("dialog")).toBe(parentDialog);
        touch(word, "pointerout", { pointerType: "mouse" });
        act(() => vi.advanceTimersByTime(200));
        expect(screen.queryByRole("tooltip")).toBeNull();
      }
    } finally {
      vi.useRealTimers();
    }
  }

  const lastPlay = await screen.findByRole("button", { name: /You CAT/ });
  await define(lastPlay);
  if (phone) expect(lastPlay.getAttribute("aria-expanded")).toBe("false");

  const scores = within(screen.getByRole("region", { name: "Game scores" }));
  await user.click(scores.getByText("Tracked move history"));
  const history = scores.getByRole("button", { name: "Review move 1: CAT" });
  await define(history);
  expect(screen.queryByRole("dialog", { name: /Review move 1/ })).toBeNull();
  await user.click(history);
  const review = screen.getByRole("dialog", { name: /Review move 1/ });
  await define(within(review).getByRole("heading", { level: 2 }));
  await user.click(within(review).getByRole("button", { name: "Back to game review" }));
  const timeline = screen.getByRole("table", { name: "Your moves by turn" });
  await define(within(timeline).getByRole("button", { name: "1 · CAT" }));
  expect(screen.getByRole("dialog", { name: "Review game" })).toBeTruthy();
  expect(lookup.mock.calls.filter(([url]) => url.includes("/api/definitions?")).map(([url]) => url))
    .toEqual(Array(4).fill("/api/definitions?language=en&word=CAT"));
});

test("correcting the last opponent play updates the board, the latest-turn strip, and history without finding moves again", async () => {
  const user = await start();
  const scores = within(screen.getByRole("region", { name: "Game scores" }));
  const lastPlay = (word: string, points: number) =>
    cell(`Opponent ${word} ${points} pts 8H`);
  const latestMove = () => within(scores.getByRole("table", { name: "Tracked moves" }))
    .getAllByRole("row").slice(1).map((row) =>
      within(row).getAllByRole("cell").map((value) => value.textContent),
    );
  await user.click(cell("H8: DW, start"));
  await user.keyboard("CAT");
  await typeRack(user, "S");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  expect(lastPlay("CAT", 10)).toBeTruthy();
  await user.click(scores.getByText("Tracked move history"));

  await user.click(cell("H8: C, start"));
  await user.keyboard(" C");
  const blank = cell("H8: C blank, start");
  expect(within(blank).getByText("0")).toBeTruthy();
  expect(scoreTotals()).toBe("0–4");
  expect(latestMove()).toEqual([["1", "Opp", "cAT", "4", "4", "—"]]);
  expect(trackedScore().getAttribute("data-turn")).toBe("you");
  expect(cell("Edit last opponent move")).toBeTruthy();
  await user.hover(blank);
  expect(screen.getByLabelText("CAT across, 4 points, opponent play")
    .classList.contains("opponent-word-score")).toBe(true);
  await user.click(lastPlay("CAT", 4));
  const breakdown = within(screen.getByRole("table", { name: "Last play point breakdown" }));
  expect(breakdown.getByText("2 × 2 DW")).toBeTruthy();
  expect(breakdown.getByText("4 pts")).toBeTruthy();

  await user.click(cell("Undo"));
  expect(lastPlay("CAT", 10)).toBeTruthy();
  await user.click(cell("Redo"));
  expect(lastPlay("CAT", 4)).toBeTruthy();
  await user.click(cell("H8: C blank, start"));
  await user.keyboard("C");
  expect(lastPlay("CAT", 10)).toBeTruthy();

  await user.click(cell("H8: C, start"));
  await user.keyboard("{Delete} C");
  expect(lastPlay("CAT", 4)).toBeTruthy();
  expect(latestMove()).toEqual([["1", "Opp", "cAT", "4", "4", "—"]]);
  expect(cell("Edit last opponent move")).toBeTruthy();

  await user.click(cell("H8: C blank, start"));
  await user.keyboard("{Delete}");
  expect(scoreTotals()).toBe("0–0");
  await user.keyboard("C");
  expect(lastPlay("CAT", 10)).toBeTruthy();
  expect(latestMove()).toEqual([["1", "Opp", "CAT", "10", "10", "—"]]);

  await user.click(cell("J8: T"));
  await user.keyboard("B");
  expect(lastPlay("CAB", 14)).toBeTruthy();
  expect(scoreTotals()).toBe("0–14");
  expect(latestMove()).toEqual([["1", "Opp", "CAB", "14", "14", "—"]]);
  await store.flush();
  await act(() => store.refresh());
  expect(lastPlay("CAB", 14)).toBeTruthy();
  expect(remote.games[0].trackedMoves?.map(({ word, score }) => [word, score])).toEqual([["CAB", 14]]);
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

  await user.click(screen.getByRole("button", { name: "Search possible moves" }));
  const filter = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Filter moves" });
  await user.type(filter(), "ZZZ");
  await waitFor(() => expect(screen.queryByRole("button", { name: /^CAT, / })).toBeNull());
  await user.click(rackTile(1));
  await user.keyboard("{Enter}");
  expect(filter().value).toBe("");
  await screen.findAllByRole("button", { name: /^CAT, / });
  expect(solves).toBe(1);

  dropPages = true;
  await user.type(filter(), "CAT");
  expect(await screen.findByText(/Move results are unavailable/)).toBeTruthy();
  dropPages = false;
  await user.click(screen.getByRole("button", { name: "Find moves" }));
  await screen.findAllByRole("button", { name: /^CAT, / });
  expect(filter().value).toBe("");
  expect(solves).toBe(2);

  await user.type(filter(), "ZZZ");
  await user.click(cell("H8: DW, start"));
  await user.keyboard("S");
  expect(current().rack).toBe("CAT");
  await user.click(screen.getByRole("button", { name: "Find moves" }));
  await waitFor(() => expect(filter().value).toBe(""));
  expect(solves).toBe(3);
});

test("delete game requires confirmation, cancel retains it, deleting last game shows empty workspace", async () => {
  const user = await start();
  await user.click((await openGameManagement(user)).getByRole("button", { name: /^Delete game/ }));
  expect(remote.games).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Keep game" }));
  expect(current()).toBeTruthy();
  await user.click((await openGameManagement(user)).getByRole("button", { name: /^Delete game/ }));
  await user.click(screen.getByRole("button", { name: "Delete permanently" }));
  await waitFor(() => expect(remote.games).toHaveLength(0));
  expect(store.snapshot.data!.games).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Create a game" })).toBeTruthy();
});

test.each([
  { mark: "exclude", tile: 4, keys: "{ArrowDown}", word: "CAT" },
  { mark: "require", tile: 5, keys: "{ArrowDown}{ArrowDown}", word: "DOG" },
])("points delta uses the unmarked rack when we $mark a tile", async ({ tile, keys, word }) => {
  const user = await start();
  await typeRack(user, "CATSDOG");
  const find = () => screen.getAllByRole("button", { name: "Find moves" })[0];
  const rows = (word: string) => screen.findAllByRole("button", {
    name: new RegExp(`^${word}, `),
  });
  const score = (row: HTMLElement) => Number(row.querySelector(".result-score strong")?.textContent);
  await user.click(find());
  const top = score((await rows("CATS"))[0]);

  await user.click(rackTile(tile));
  await user.keyboard(keys);
  await user.click(find());
  const [move] = await rows(word);
  expect(screen.queryByRole("button", { name: /^CATS, / })).toBeNull();
  const sacrificed = top - score(move);
  expect(sacrificed).toBeGreaterThan(0);
  const delta = move.querySelector(".result-score-delta");
  expect(delta?.textContent).toBe(`−${sacrificed}`);
  expect(delta?.getAttribute("title")).toBe(`Best score with rack marks cleared is ${top} points`);
});

test("exclude rack tiles with Down or taps and move held tiles to the start after playing", async () => {
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
  await waitFor(() => expect(current().rack).toBe("S"));
  expect(current().excludedRackSlots).toBeUndefined();
  expect(rackTile(1).getAttribute("aria-label")).toBe("Rack tile 1: S");
  expect(rackTile(2).getAttribute("aria-pressed")).toBe("true");
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(current().rack).toBe("CATS");
  expect(current().excludedRackSlots).toEqual([3]);
  await user.click(rackTile(4));
  await user.keyboard("S");
  expect(current().excludedRackSlots).toBeUndefined();
});

test("Down cycles rack marks, Require tiles filters moves, and Undo restores both marks", async () => {
  const user = await start();
  await typeRack(user, "CATSQ");
  await user.click(rackTile(4));
  await user.keyboard("{ArrowDown}{ArrowDown}");
  expect(current().excludedRackSlots).toBeUndefined();
  expect(current().requiredRackSlots).toEqual([3]);
  expect(rackTile(4).getAttribute("aria-label")).toContain("required for this move");
  expect(rackTile(4).querySelector(".rack-required-stripe")?.textContent).toBe("REQ");
  await user.keyboard("{ArrowDown}");
  expect(current().requiredRackSlots).toBeUndefined();
  expect(rackTile(4).querySelector(".rack-required-stripe")).toBeNull();
  await user.click(rackTile(5));
  await user.keyboard("{ArrowDown}");
  await user.click(screen.getByText("Rack tools"));
  await user.click(screen.getByRole("button", { name: "Require tiles" }));
  await user.click(rackTile(4));
  expect(rackTile(4).getAttribute("aria-pressed")).toBe("true");
  await user.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(remote.games[0].requiredRackSlots).toEqual([3]));
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  const move = (await screen.findAllByRole("button", { name: /^CATS, / }))[0];
  expect(screen.queryByRole("button", { name: /^CAT, / })).toBeNull();

  await user.click(move);
  await waitFor(() => expect(current().rack).toBe("Q"));
  expect(current().excludedRackSlots).toBeUndefined();
  expect(current().requiredRackSlots).toBeUndefined();
  await waitFor(() => {
    expect(remote.games[0].rack).toBe("Q");
    expect(remote.games[0].requiredRackSlots).toBeUndefined();
  });
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(current().rack).toBe("CATSQ");
  expect(current().excludedRackSlots).toEqual([4]);
  expect(current().requiredRackSlots).toEqual([3]);
  expect(rackTile(4).querySelector(".rack-required-stripe")?.textContent).toBe("REQ");
  await user.click(screen.getByRole("button", { name: "Redo" }));
  expect(current().rack).toBe("Q");
  expect(current().requiredRackSlots).toBeUndefined();
  expect(current().excludedRackSlots).toBeUndefined();
});

test("a phone rack hold cycles marks without opening the keyboard or marking during a swipe", async () => {
  const user = await start(390);
  await typeRack(user, "CAT");
  await user.keyboard("{Escape}");
  const input = screen.getByRole("textbox", { name: "Rack letters" });
  const tile = rackTile(1);
  vi.useFakeTimers();
  try {
    const hold = () => act(() => vi.advanceTimersByTime(500));
    const tapEnds = () => {
      touch(tile, "pointerup");
      fireEvent.click(tile, { detail: 1 });
    };
    touch(tile, "pointerdown");
    touch(tile, "pointermove", { clientX: 65 });
    hold();
    tapEnds();
    expect(current().excludedRackSlots).toBeUndefined();
    expect(document.activeElement).not.toBe(input);

    touch(tile, "pointerdown");
    touch(tile, "pointercancel");
    hold();
    expect(current().excludedRackSlots).toBeUndefined();

    for (const [excluded, required] of [[[0], undefined], [undefined, [0]], [undefined, undefined]]) {
      touch(tile, "pointerdown");
      expect(fireEvent.contextMenu(tile)).toBe(false);
      hold();
      tapEnds();
      expect(current().excludedRackSlots).toEqual(excluded);
      expect(current().requiredRackSlots).toEqual(required);
      expect(tile.querySelector(".rack-required-stripe")?.textContent).toBe(required ? "REQ" : undefined);
      expect(document.activeElement).not.toBe(input);
    }

    touch(tile, "pointerdown");
    tapEnds();
    hold();
    expect(document.activeElement).toBe(input);
    expect(current().rack).toBe("CAT");
    expect(current().excludedRackSlots).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

test("shuffle moves excluded, required, and exchange marks with their tiles", async () => {
  const user = await start();
  const shuffle = cell("Shuffle rack");
  expect(shuffle).toHaveProperty("disabled", true);
  await typeRack(user, "CATS");
  await user.click(rackTile(1));
  await user.keyboard("{ArrowDown}");
  await user.click(rackTile(2));
  await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}");
  await user.click(rackTile(3));
  await user.keyboard("{ArrowUp}");

  await user.click(screen.getByRole("button", { name: "Find moves" }));
  const move = (await screen.findAllByRole("button", { name: /^AT, / }))[0];
  const random = vi.spyOn(Math, "random").mockReturnValue(0);
  try {
    await user.click(shuffle);
  } finally {
    random.mockRestore();
  }
  expect(current().rack).toBe("ATSC");
  expect(move.isConnected).toBe(true);
  expect(current().excludedRackSlots).toEqual([3]);
  expect(current().requiredRackSlots).toEqual([0]);
  expect(rackTile(2).getAttribute("aria-label")).toContain("T, marked for exchange");
  const requiredArrow = rackTile(1).querySelector(".rack-required-stripe .rack-exchange-icon");
  const exchangeArrow = rackTile(2).querySelector(".rack-slot > .rack-exchange-icon");
  expect(requiredArrow?.getAttribute("stroke-width")).toBe("3.2");
  expect(exchangeArrow?.getAttribute("stroke-width")).toBe("3.2");
  await act(() => store.flush());
  expect(remote.games[0].rack).toBe("ATSC");
});

test.each(["mouse", "touch"])("rack drag inserts between tiles and suppresses a typing tap (%s)", async (pointerType) => {
  const user = await start();
  await typeRack(user, "CATS");
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Find moves" }));
  const move = (await screen.findAllByRole("button", { name: /^CATS, / }))[0];
  const rack = screen.getByRole("group", { name: "Your rack tiles" });
  vi.spyOn(rack, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 280, 40));
  for (let i = 0; i < 7; i++)
    vi.spyOn(rackTile(i + 1), "getBoundingClientRect").mockReturnValue(new DOMRect(i * 40, 0, 36, 36));
  const first = rackTile(1);
  touch(first, "pointerdown", { pointerType, clientX: 18 });
  touch(first, "pointermove", { pointerType, clientX: 118 });
  expect(first.hasAttribute("data-rack-lifted")).toBe(true);
  expect(rackTile(2).style.getPropertyValue("--rack-shift-x")).toBe("-40px");
  touch(first, "pointerup", { pointerType, clientX: 118 });
  fireEvent.click(first, { detail: 1 });
  expect(current().rack).toBe("ATCS");
  expect(move.isConnected).toBe(true);
  expect(rack.querySelector(".rack-insertion-slot")).toBeNull();
  expect(document.activeElement).not.toBe(screen.getByRole("textbox", { name: "Rack letters" }));

  rackTile(3).focus();
  await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
  expect(current().rack).toBe("ATSC");
  expect(document.activeElement).toBe(rackTile(4));
});

test("the phone divider restores saved positions and uses the available board width", async () => {
  shellWidth = 390;
  localStorage.setItem("tilewise:phone-rack-width", "58");
  const { unmount } = render(<App />);
  await screen.findByRole("heading", { name: /First game/ });
  const divider = screen.getByRole<HTMLInputElement>("slider", { name: "Board size" });
  const column = divider.closest<HTMLElement>(".phone-board-column")!;
  expect(divider.value).toBe("58");
  expect(divider.getAttribute("aria-valuetext")).toBe("14 pixels narrower");
  expect(Number(divider.max) - Number(divider.min)).toBeGreaterThan(120);
  const wideLimit = divider.max;
  fireEvent.change(divider, { target: { value: "200" } });
  expect(column.style.getPropertyValue("--phone-board-reduction")).toBe("156px");
  expect(column.style.getPropertyValue("--phone-rack-width")).toBe("44px");

  act(() => resizeShell(320));
  expect(Number(divider.max)).toBeLessThan(Number(wideLimit));
  expect(divider.value).toBe(divider.max);
  act(() => resizeShell(390));
  expect(divider.value).toBe("200");

  unmount();
  render(<App />);
  await screen.findByRole("heading", { name: /First game/ });
  expect(screen.getByRole<HTMLInputElement>("slider", { name: "Board size" }).value).toBe("200");
});

test("the phone board extends toward the edge in live play and reserves room for draws in replay", async () => {
  remote.games[0] = replayFixture();
  const user = await start(390);
  await waitFor(() => expect(current().trackedMoves).toHaveLength(2));
  const divider = screen.getByRole<HTMLInputElement>("slider", { name: "Board size" });
  const column = divider.closest<HTMLElement>(".phone-board-column")!;
  expect(column.hasAttribute("data-live")).toBe(true);
  expect(divider.min).toBe("44");

  const options = await openGameOptions(user);
  await user.click(options.getByRole("button", { name: "Replay game" }));
  expect(column.hasAttribute("data-live")).toBe(false);
  expect(divider.min).toBe("88");
  expect(screen.queryByRole("group", { name: "Tiles drawn" })).toBeNull();
  await user.click(cell("Previous move"));
  expect(screen.getByRole("group", { name: "Tiles drawn" })).toBeTruthy();
  expect(divider.min).toBe("88");

  await user.click(cell("Back to live"));
  expect(column.hasAttribute("data-live")).toBe(true);
  expect(divider.value).toBe("44");
});

test("the desktop divider retains its width when switching between play and replay", async () => {
  remote.games[0] = replayFixture();
  localStorage.setItem("tilemaxx:desktop-board-width", "420");
  const user = await start();
  await waitFor(() => expect(current().trackedMoves).toHaveLength(2));
  const divider = screen.getByRole<HTMLInputElement>("slider", { name: "Board size" });
  const workspace = divider.closest<HTMLElement>(".workspace-grid")!;
  expect(divider.value).toBe("420");
  expect(workspace.style.getPropertyValue("--desktop-board-width")).toBe("420px");
  fireEvent.change(divider, { target: { value: "510" } });
  expect(localStorage.getItem("tilemaxx:desktop-board-width")).toBe("510");
  const options = await openGameOptions(user);
  await user.click(options.getByRole("button", { name: "Replay game" }));
  expect(workspace.classList.contains("replay-workspace")).toBe(true);
  expect(screen.getByRole("slider", { name: "Board size" })).toBe(divider);
  expect(divider.value).toBe("510");
  act(() => resizeShell(800));
  expect(divider.value).toBe(divider.max);
  act(() => resizeShell(1200));
  expect(divider.value).toBe("510");
  await user.click(cell("Back to live"));
  expect(workspace.classList.contains("replay-workspace")).toBe(false);
  expect(divider.value).toBe("510");
});

test("the vertical rack uses up and down to select tiles and horizontal arrows to mark them", async () => {
  const user = await start(390);
  await typeRack(user, "CAT");
  await user.click(rackTile(2));
  await user.keyboard("{ArrowUp}");
  expect(rackTile(1).classList.contains("selected")).toBe(true);
  await user.keyboard("{ArrowDown}");
  expect(rackTile(2).classList.contains("selected")).toBe(true);

  await user.keyboard("{ArrowRight}");
  expect(current().excludedRackSlots).toEqual([1]);
  await user.keyboard("{ArrowRight}");
  expect(current().requiredRackSlots).toEqual([1]);
  await user.keyboard("{ArrowRight}");
  expect(current().excludedRackSlots).toBeUndefined();
  expect(current().requiredRackSlots).toBeUndefined();
  await user.keyboard("{ArrowLeft}");
  expect(rackTile(2).getAttribute("aria-label")).toContain("marked for exchange");
  await user.keyboard("{ArrowLeft}");
  expect(rackTile(2).getAttribute("aria-label")).not.toContain("marked for exchange");
  expect(rackTile(2).classList.contains("selected")).toBe(true);

  await user.keyboard("{Escape}?");
  const guide = within(screen.getByRole("dialog", { name: "Keyboard shortcuts" }));
  expect(guide.getByText("Move between rack tiles").previousElementSibling?.textContent).toBe("↑ / ↓");
  expect(guide.getByText("Mark or unmark a rack tile for exchange").previousElementSibling?.textContent).toBe("←");
});

test("the vertical rack supports reordering tiles by touch and keyboard", async () => {
  const user = await start(390);
  await typeRack(user, "CATS");
  await user.keyboard("{Escape}");
  const rack = screen.getByRole("group", { name: "Your rack tiles" });
  vi.spyOn(rack, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 40, 280));
  for (let i = 0; i < 7; i++) {
    vi.spyOn(rackTile(i + 1), "getBoundingClientRect").mockReturnValue(new DOMRect(0, i * 40, 36, 36));
  }
  const first = rackTile(1);
  touch(first, "pointerdown", { clientY: 18 });
  touch(first, "pointermove", { clientY: 118 });
  expect(first.hasAttribute("data-rack-lifted")).toBe(true);
  expect(rackTile(2).style.getPropertyValue("--rack-shift-y")).toBe("-40px");
  touch(first, "pointerup", { clientY: 118 });
  fireEvent.click(first, { detail: 1 });
  expect(current().rack).toBe("ATCS");
  expect(document.activeElement).not.toBe(screen.getByRole("textbox", { name: "Rack letters" }));

  rackTile(3).focus();
  await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
  expect(current().rack).toBe("ATSC");
  expect(document.activeElement).toBe(rackTile(4));
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

test("the board turn border follows the active player and remembers its placement", async () => {
  localStorage.setItem("tilemaxx:workspace-preferences", JSON.stringify({
    autoUpdate: false,
    turnBorder: "panel-and-divider",
  }));
  const user = userEvent.setup();
  const app = render(<App />);
  const board = () => screen.getByRole("region", { name: "Game board" });
  await screen.findByRole("heading", { name: /First game/ });
  expect(board().getAttribute("data-turn-border")).toBe("panel-only");
  expect(board().getAttribute("data-turn")).toBe("you");

  await user.click(cell("Your turn. Switch active player"));
  expect(board().getAttribute("data-turn")).toBe("opponent");
  expect(board().getAttribute("aria-description")).toBe("Opponent’s turn");

  await user.click(cell("Settings"));
  const settings = within(screen.getByRole("dialog", { name: "Settings" }));
  const turnBorder = within(settings.getByRole("group", { name: "Turn border" }));
  const panelOnly = turnBorder.getByRole("button", { name: "Panel only" });
  const panelAndDivider = turnBorder.getByRole("button", { name: "Panel and divider" });
  expect(panelOnly.getAttribute("aria-pressed")).toBe("true");
  expect(panelAndDivider.getAttribute("aria-pressed")).toBe("false");
  await user.click(panelAndDivider);
  expect(panelOnly.getAttribute("aria-pressed")).toBe("false");
  expect(panelAndDivider.getAttribute("aria-pressed")).toBe("true");
  await user.click(settings.getByRole("button", { name: "Close dialog" }));
  expect(board().getAttribute("data-turn-border")).toBe("panel-and-divider");
  expect(board().getAttribute("data-turn")).toBe("opponent");

  await user.click(cell("Pass"));
  expect(current().trackedMoves?.at(-1)?.player).toBe("opponent");
  expect(board().getAttribute("data-turn")).toBe("you");

  app.unmount();
  render(<App />);
  await screen.findByRole("heading", { name: /First game/ });
  expect(board().getAttribute("data-turn-border")).toBe("panel-and-divider");
});

test("Dark replaces the old System default and a new System selection persists", async () => {
  localStorage.setItem("tilewise:theme", "system");
  const user = userEvent.setup();
  const app = render(<App />);
  await screen.findByRole("heading", { name: /First game/ });
  expect(document.documentElement.dataset.theme).toBe("dark");

  await user.click(cell("Settings"));
  const settings = within(screen.getByRole("dialog", { name: "Settings" }));
  expect(settings.getByRole("button", { name: "dark theme" }).getAttribute("aria-pressed")).toBe("true");
  await user.click(settings.getByRole("button", { name: "system theme" }));
  expect(document.documentElement.dataset.theme).toBe("system");
  await user.click(settings.getByRole("button", { name: "Close dialog" }));

  app.unmount();
  render(<App />);
  await screen.findByRole("heading", { name: /First game/ });
  expect(document.documentElement.dataset.theme).toBe("system");
});

test("workspace settings keep board previews visible with plain rack tiles and persist across reloads", async () => {
  const hardware = vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(8);
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
  const workerOption = "Limit compute workers to";
  const hardwareInfo = () => within(dialog().getByRole("group", { name: "Hardware info" }));
  const computeLimit = () => hardwareInfo().getByText("Compute worker limit").nextElementSibling?.textContent;
  const workerCap = () => hardwareInfo().getByRole<HTMLInputElement>("spinbutton", { name: "Maximum compute workers" });

  await openSettings();
  expect(dialog().getByText("Applies to all games in this browser only.")).toBeTruthy();
  expect(dialog().getByRole("button", { name: "dark theme" }).getAttribute("aria-pressed")).toBe("true");
  for (const theme of ["light", "system", "dark"]) {
    await user.click(dialog().getByRole("button", { name: `${theme} theme` }));
    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(localStorage.getItem("tilemaxx:theme")).toBe(theme);
  }
  expect(
    ["Move previews", "Gameplay", "Updates"].map(
      (name) =>
        within(dialog().getByRole("group", { name })).getAllByRole("checkbox").length,
    ),
  ).toEqual([2, 2, 1]);
  expect(hardwareInfo().getByText("Browser concurrency hint").nextElementSibling?.textContent).toBe("8");
  expect(computeLimit()).toBe("8");
  expect(option(workerOption).checked).toBe(false);
  expect(workerCap().value).toBe("1");
  expect(workerCap().disabled).toBe(true);
  await user.click(option(workerOption));
  expect(computeLimit()).toBe("1");
  expect(workerCap().max).toBe("8");
  await user.clear(workerCap());
  await user.type(workerCap(), "3");
  expect(computeLimit()).toBe("3");
  await user.clear(workerCap());
  await user.type(workerCap(), "0");
  expect(computeLimit()).toBe("3");
  await user.tab();
  expect(workerCap().value).toBe("3");
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
  expect(dialog().getByRole("button", { name: "dark theme" }).getAttribute("aria-pressed")).toBe("true");
  for (const name of [rackHighlight, pulse, playAnimation, autoUpdate]) {
    expect(option(name).checked).toBe(false);
  }
  expect(option(workerOption).checked).toBe(true);
  expect(workerCap().value).toBe("3");
  expect(computeLimit()).toBe("3");
  await user.click(option(workerOption));
  expect(computeLimit()).toBe("8");
  expect(workerCap().disabled).toBe(true);
  expect(workerCap().value).toBe("3");
  await user.click(option(workerOption));
  expect(computeLimit()).toBe("3");
  hardware.mockRestore();
});

test("the existing one-worker preference enables the editable limit at one", async () => {
  localStorage.setItem("tilemaxx:workspace-preferences", JSON.stringify({ singleComputeWorker: true }));
  const user = await start();
  await user.click(cell("Settings"));
  const settings = within(screen.getByRole("dialog", { name: "Settings" }));
  const toggle = settings.getByRole<HTMLInputElement>("checkbox", { name: "Limit compute workers to" });
  const cap = settings.getByRole<HTMLInputElement>("spinbutton", { name: "Maximum compute workers" });
  expect(toggle.checked).toBe(true);
  expect(cap.disabled).toBe(false);
  expect(cap.value).toBe("1");
  expect(settings.getByText("Compute worker limit").nextElementSibling?.textContent).toBe("1");
});

test("the version offers a manual update when automatic updates are off", async () => {
  const user = await start();
  const settings = () => within(screen.getByRole("dialog", { name: "Settings" }));
  const autoUpdate = () =>
    settings().getByRole("checkbox", { name: "Automatically reload when an update is available" });
  const updateIcon = () => screen.queryByRole("button", { name: "Update and reload" });
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
  expect(updateIcon()?.textContent?.trim()).toBe("Update and reload");
  expect(updateIcon()?.getAttribute("aria-description")).toBe(`Version ${remote.version} is available.`);
  expect(updateIcon()?.tabIndex).toBe(0);

  const visible = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const reloadAttempt = vi.fn();
  const setItem = Storage.prototype.setItem;
  const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(
    function (this: Storage, key, value) {
      if (this === sessionStorage && key === "tilemaxx:automatic-update-attempt") {
        reloadAttempt(value);
        throw new Error("Navigation blocked by test");
      }
      setItem.call(this, key, value);
    },
  );
  try {
    expect(reloadAttempt).not.toHaveBeenCalled();
    await user.click(updateIcon()!);
    await waitFor(() => expect(reloadAttempt).toHaveBeenCalledWith(`${version} → ${remote.version}`));
  } finally {
    storage.mockRestore();
    visible.mockRestore();
  }

  await user.click(cell("Settings"));
  await user.click(autoUpdate());
  expect(document.querySelector(".app-update-icon")).toBeNull();
});

test.each(["board odds", "reply histogram"] as const)(
  "automatic updates wait for a pending %s",
  async (last) => {
    type Summary = Extract<ReplyRequest, { kind: "reply-summary" }>;
    type BoardOdds = Extract<SolverRequest, { kind: "board-odds" }>;
    type Histogram = Extract<ReplyRequest, { kind: "reply-histogram" }>;
    let summary: { worker: SolverWorker; request: Summary } | undefined;
    let boardOdds: { worker: SolverWorker; request: BoardOdds } | undefined;
    let histogram: { worker: SolverWorker; request: Histogram } | undefined;
    class DeferredAnalysisWorker extends SolverWorker {
      postMessage(request: SolverRequest | ReplyRequest) {
        if (request.kind === "reply-summary") summary = { worker: this, request };
        else if (request.kind === "board-odds") boardOdds = { worker: this, request };
        else if (request.kind === "reply-histogram") histogram = { worker: this, request };
        else if (request.kind !== "reply-detail" && request.kind !== "reply-line")
          super.postMessage(request);
      }
    }
    vi.stubGlobal("Worker", DeferredAnalysisWorker);
    const visibility = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const reloadAttempt = vi.fn();
    const setItem = Storage.prototype.setItem;
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(
      function (this: Storage, key, value) {
        if (this === sessionStorage && key === "tilemaxx:automatic-update-attempt") {
          reloadAttempt(value);
          // JSDOM cannot navigate. Intercept the marker written just before reload.
          throw new Error("Navigation blocked by test");
        }
        setItem.call(this, key, value);
      },
    );
    try {
      const user = await start();
      await typeRack(user, "CATS");
      await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
      await waitFor(() => expect(summary).toBeDefined());
      act(() => summary!.worker.onmessage?.({
        data: { id: summary!.request.id, kind: "reply-summary", done: true },
      }));
      await waitFor(() => expect(boardOdds).toBeDefined());
      const [check] = await screen.findAllByRole("button", { name: /^Check reply histogram for/ });
      await user.click(check);
      await waitFor(() => expect(histogram).toBeDefined());
      const finishHistogram = () => act(() => histogram!.worker.onmessage?.({
        data: { id: histogram!.request.id, kind: "reply-histogram" },
      }));
      const finishBoardOdds = () => {
        const { worker, request } = boardOdds!;
        act(() => worker.onmessage?.({
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
        }));
      };
      const [major, minor, patch] = version.split(".").map(Number);
      remote.version = `${major}.${minor}.${patch + 1}`;
      (document.activeElement as HTMLElement | null)?.blur();
      await act(() => store.refresh());
      expect(reloadAttempt).not.toHaveBeenCalled();
      if (last === "board odds") finishHistogram();
      else finishBoardOdds();
      expect(reloadAttempt).not.toHaveBeenCalled();

      if (last === "board odds") finishBoardOdds();
      else finishHistogram();
      await waitFor(() =>
        expect(reloadAttempt).toHaveBeenCalledWith(`${version} → ${remote.version}`),
      );
    } finally {
      visibility.mockRestore();
      storage.mockRestore();
    }
  },
);

test("workspace shortcuts focus the rack and game filter, and the guide leaves rack blanks intact", async () => {
  remote.games.push({ ...game(), id: "second", name: "Jo Smith" });
  const user = await start();
  await act(() => store.refresh());
  const guide = () => screen.queryByRole("dialog", { name: "Keyboard shortcuts" });
  await user.click(cell("H8: DW, start"));
  fireEvent.keyDown(entry(), { key: "®", code: "KeyR", altKey: true });
  const rack = screen.getByRole("textbox", { name: "Rack letters" });
  expect(document.activeElement).toBe(rack);
  await user.keyboard("CA?");
  expect(current().rack).toBe("CA?");
  expect(guide()).toBeNull();

  fireEvent.keyDown(rack, { key: "ƒ", code: "KeyF", altKey: true });
  const search = screen.getByRole("searchbox", { name: "Filter by opponent" });
  expect(document.activeElement).toBe(search);
  await user.keyboard("Smith{Enter}");
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "Jo Smith" }),
  );
  expect(screen.queryByRole("searchbox", { name: "Filter by opponent" })).toBeNull();
  await user.tab();
  expect(document.activeElement).toBe(cell("Switch game"));

  await user.keyboard("?");
  expect(guide()).toBeTruthy();
  expect(within(guide()!).getByText("Alt / Option + R")).toBeTruthy();
  expect(within(guide()!).getByText("Alt / Option + F")).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: "f", code: "KeyF", altKey: true });
  expect(screen.queryByRole("searchbox", { name: "Filter by opponent" })).toBeNull();
  await user.click(within(guide()!).getByRole("button", { name: "Close dialog" }));
  await user.click(navLink("Keyboard shortcuts"));
  expect(guide()).toBeTruthy();
});

test("Option+U and Option+Y undo and redo game history", async () => {
  const user = await start();
  const placed = () => current().board.slice(112, 115).join("");
  await user.click(cell("H8: DW, start"));
  await user.keyboard("CAT");
  expect(placed()).toBe("CAT");

  expect(fireEvent.keyDown(entry(), { key: "Dead", code: "KeyU", altKey: true })).toBe(false);
  expect(placed()).toBe("");
  expect(document.activeElement).toBe(entry());

  await user.click(rackTile(1));
  const rack = screen.getByRole("textbox", { name: "Rack letters" });
  expect(fireEvent.keyDown(rack, { key: "¥", code: "KeyY", altKey: true })).toBe(false);
  expect(placed()).toBe("CAT");
  await user.keyboard("{Alt>}u{/Alt}{Alt>}u{/Alt}");
  expect(placed()).toBe("");
  expect(current().future).toHaveLength(1);

  await user.click(navLink("Keyboard shortcuts"));
  const guide = within(screen.getByRole("dialog", { name: "Keyboard shortcuts" }));
  expect(guide.getByText("Alt / Option + U")).toBeTruthy();
  expect(guide.getByText("Alt / Option + Y")).toBeTruthy();
  fireEvent.keyDown(guide.getByRole("button", { name: "Close dialog" }), {
    key: "¥", code: "KeyY", altKey: true,
  });
  expect(placed()).toBe("");
  await user.click(guide.getByRole("button", { name: "Close dialog" }));
  await user.keyboard("{Alt>}y{/Alt}");
  expect(placed()).toBe("CAT");
});

test("Alt+B leaves Define mode and focuses coordinate entry", async () => {
  const game = remote.games[0];
  game.board.splice(game.template.start, 3, ..."CAT");
  game.revision++;
  const user = await start();
  await screen.findByRole("button", { name: "H8: C, start" });
  await user.click(cell("Define"));
  expect(entry()).toHaveProperty("disabled", true);
  await user.keyboard("{Alt>}b{/Alt}");
  expect(entry()).toHaveProperty("disabled", false);
  expect(document.activeElement).toBe(entry());
  await user.keyboard("h6");
  expect(selectedCell()).toBe("82");
  expect(document.querySelector(".board-grid[data-defining]")).toBeNull();
});

test("Alt+B defaults to across on an empty board and groups the entered word", async () => {
  const user = await start();
  const overlay = () => document.querySelector(".board-coordinate-grid");
  const labels = () => [...overlay()!.querySelectorAll(".board-coordinate-label[data-match]")];
  await user.click(cell("H8: DW, start"));
  await user.keyboard("{ArrowDown}");
  expect(boardDirection()).toBe("Down");

  const rack = screen.getByRole("textbox", { name: "Rack letters" });
  await user.click(rackTile(1));
  fireEvent.keyDown(rack, { key: "∫", code: "KeyB", altKey: true });
  expect(document.activeElement).toBe(entry());
  expect(overlay()?.querySelectorAll(".board-coordinate-label")).toHaveLength(225);
  expect(selectedCell()).toBeUndefined();

  await user.keyboard("f{ArrowRight}{ArrowRight}{ArrowDown}");
  expect(labels().map((label) => label.textContent)).toEqual(
    Array.from({ length: 15 }, (_, row) => `H${row + 1}`),
  );
  await user.keyboard("6CAT");
  expect(overlay()).toBeNull();
  expect(current().board.slice(82, 85)).toEqual(["C", "A", "T"]);
  expect(current().rack).toBe("");
  expect(current().past).toHaveLength(1);
  await user.click(cell("Undo"));
  expect(current().board.some(Boolean)).toBe(false);

  await user.keyboard("{Alt>}b{/Alt}7{ArrowUp}{ArrowLeft}");
  expect(labels()).toHaveLength(15);
  expect(labels().map((label) => label.textContent).slice(0, 2)).toEqual(["A6", "B6"]);
  await user.keyboard("hCAT");
  expect(overlay()).toBeNull();
  expect(current().board.slice(82, 85)).toEqual(["C", "A", "T"]);
  expect(current().past).toHaveLength(1);
});

test("coordinate entry stops at edges, distinguishes two-digit rows, and can be cancelled", async () => {
  const user = await start();
  const overlay = () => document.querySelector(".board-coordinate-grid");
  const status = () => screen.getByRole("status").textContent;
  const startCoordinate = () => user.keyboard("{Alt>}b{/Alt}");
  await startCoordinate();
  await user.keyboard("a{ArrowLeft}{ArrowRight}{ArrowLeft}");
  expect(status()).toContain("Column A");
  await user.keyboard("1");
  expect(status()).toContain("1A");
  expect(overlay()).toBeNull();
  expect(selectedCell()).toBe("0");
  await user.keyboard("5");
  expect(overlay()).toBeNull();
  expect(selectedCell()).toBe("210");

  await startCoordinate();
  await user.keyboard("15{ArrowDown}");
  expect(status()).toContain("Row 15");
  await user.keyboard("{ArrowUp}{Backspace}");
  expect(status()).toContain("Row 1");
  await user.keyboard("{ArrowUp}o");
  expect(selectedCell()).toBe("14");

  await startCoordinate();
  await user.keyboard("h1");
  expect(overlay()).toBeNull();
  expect(selectedCell()).toBe("7");
  expect(boardDirection()).toBe("Across");

  await startCoordinate();
  await user.keyboard("h0");
  expect(status()).toContain("Use A1–O15");
  await user.keyboard("{Escape}");
  expect(overlay()).toBeNull();
  expect(selectedCell()).toBeUndefined();

  await startCoordinate();
  await user.keyboard("h");
  expect(status()).toContain("Column H");
  expect(fireEvent.keyDown(entry(), { key: "∫", code: "KeyB", altKey: true })).toBe(false);
  expect(overlay()).toBeNull();
  expect(selectedCell()).toBeUndefined();
  expect(document.activeElement).not.toBe(entry());

  await startCoordinate();
  expect(status()).toBe("Type a coordinate");
  await user.click(rackTile(1));
  expect(overlay()).toBeNull();
  expect(current().board.some(Boolean)).toBe(false);
  expect(current().past).toHaveLength(0);

  await user.click(navLink("Keyboard shortcuts"));
  expect(screen.getByText("Alt / Option + B")).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: "∫", code: "KeyB", altKey: true });
  expect(overlay()).toBeNull();
});

test("letter-first row one selects immediately and accepts tile entry", async () => {
  const user = await start();
  await typeRack(user, "CAT");
  const overlay = () => document.querySelector(".board-coordinate-grid");
  const startCoordinate = () => user.keyboard("{Alt>}b{/Alt}");
  await startCoordinate();
  await user.keyboard("h1");
  expect(overlay()).toBeNull();
  expect(selectedCell()).toBe("7");
  expect(document.activeElement).toBe(entry());

  await user.keyboard("{Backspace}");
  expect(overlay()).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("Column H");
  await user.keyboard("1{Enter}");
  expect(overlay()).toBeNull();
  expect(selectedCell()).toBe("7");
  expect(document.activeElement).toBe(entry());

  await startCoordinate();
  await user.keyboard("h1cat");
  expect(current().board.slice(7, 10)).toEqual(["C", "A", "T"]);
  expect(current().board.slice(142, 145)).toEqual(["", "", ""]);

  await startCoordinate();
  await user.keyboard("h10cat");
  expect(current().board.slice(142, 145)).toEqual(["C", "A", "T"]);
});

test("coordinate entry follows the current custom board size", async () => {
  const template = {
    ...game().template,
    id: "large-custom",
    builtin: false,
    name: "Large custom board",
    size: 25,
    premiums: Array(625).fill(""),
    start: 312,
  };
  remote.games[0] = { ...game(), template, board: emptyBoard(25), revision: 1 };
  const user = await start();
  await act(() => store.refresh());
  await screen.findByRole("button", { name: "Y25: empty" });
  await user.keyboard("{Alt>}b{/Alt}y{ArrowRight}2");
  const overlay = () => document.querySelector(".board-coordinate-grid");
  expect(overlay()).toBeNull();
  expect(selectedCell()).toBe("49");
  await user.keyboard("5");
  expect(overlay()).toBeNull();
  expect(selectedCell()).toBe("624");
});

test("search games focuses the archived filter and can return there from an archived game", async () => {
  remote.games.push({ ...game(), id: "finished", name: "Jo Smith", archived: true });
  const user = await start();
  await act(() => store.refresh());
  await user.click(navLink("Archived games"));
  const search = () => screen.getByRole("searchbox", { name: "Filter by opponent" });
  await user.keyboard("{Alt>}f{/Alt}");
  expect(document.activeElement).toBe(search());
  await user.keyboard("Smith");
  await user.click(screen.getByRole("button", { name: /^Jo Smith/ }));
  expect(await screen.findByRole("heading", { name: "Jo Smith" })).toBeTruthy();
  await user.keyboard("{Alt>}f{/Alt}");
  expect(document.activeElement).toBe(search());
});

test("active game options show the tracked score inline with your score first", async () => {
  const scoring = emptyScoring();
  scoring.you.points = 218;
  scoring.opponent.points = 192;
  remote.games.push(
    { ...game(), id: "tracked", name: "Morgan Lee", scoring },
    { ...game(), id: "untracked", name: "Taylor Brooks", trackScores: false },
  );
  const user = await start();
  await user.click(cell("Switch game"));
  const tracked = screen.getByRole("menuitemradio", { name: /^Morgan Lee/ });
  const score = within(tracked).getByText("218–192");
  expect(score.parentElement).toBe(within(tracked).getByText("Morgan Lee").closest(".game-picker-name-line"));
  expect(tracked.getAttribute("aria-description")).toContain("Your score 218, opponent score 192");
  const newGame = screen.getByRole("menuitemradio", { name: /^First game/ });
  expect(within(newGame).getByText("0–0")).toBeTruthy();
  const untracked = screen.getByRole("menuitemradio", { name: /^Taylor Brooks/ });
  expect(untracked.querySelector(".game-picker-score")).toBeNull();
});

test("typing in the game picker filters active games by opponent name", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
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
  expect(options()[0].textContent).toMatch(/^1Jo Smith0–0Scrabble GO/);
  expect(options()[1].textContent).toMatch(/^2Jo Smith0–0Wordfeud/);
  expect(screen.queryByRole("menuitem", { name: /Reorder/ })).toBeNull();

  await user.keyboard("x{ArrowDown}{Enter}");
  expect(screen.getByText("No matching games.").getAttribute("role")).toBe(
    "status",
  );
  expect(options()).toHaveLength(0);
  await user.keyboard("{Backspace}{ArrowDown}{ArrowDown}{Enter}");
  expect(await screen.findByRole("heading", { name: "Jo Smith" })).toBeTruthy();
  expect(localStorage.getItem("tilewise:game")).toBe("second");

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

test("new games appear above the saved order without changing the selected game", async () => {
  const user = await start();
  remote.games.push({ ...game(), id: "second", name: "Second game" });
  await act(() => store.refresh());
  await user.click(cell("Switch game"));
  const handle = screen.getByRole("menuitem", { name: "Reorder First game" });
  expect(handle.closest("[data-selected]")).toBeTruthy();
  expect(screen.getByTitle("2 active games").textContent).toBe("2");
  handle.focus();
  await user.keyboard("{ArrowUp}");
  const options = () =>
    screen
      .getAllByRole("menuitemradio")
      .map((item) => [
        item.querySelector(".game-picker-number")?.textContent,
        item.querySelector("strong")?.textContent,
      ]);
  const reordered = [
    ["1", "First game"],
    ["2", "Second game"],
  ];
  await waitFor(() => expect(options()).toEqual(reordered));
  expect(remote.profiles[0].gameOrder).toEqual(["g", "second"]);
  expect(cell("Switch game").textContent).toContain("First game");
  remote.games.push({
    ...game(),
    id: "third",
    name: "New arrival",
    startedOn: "2020-01-01",
  });
  await act(() => store.refresh());
  expect(options()).toEqual([
    ["1", "New arrival"],
    ["2", "First game"],
    ["3", "Second game"],
  ]);
  expect(remote.profiles[0].gameOrder).toEqual(["g", "second"]);
  expect(cell("Switch game").textContent).toContain("First game");
  await user.keyboard("{Escape}");
  expect(screen.queryByTitle("3 active games")).toBeNull();
});

test.each([false, true])("the endgame heading and opponent rack follow the bag count (phone %s)", async (phone) => {
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
  const user = await start(phone ? 390 : 1200);
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
  const visibleRack = await panel.findByRole("img", { name: "Opponent rack: J, J, blank" });
  expect([...visibleRack.children].map((tile) => tile.textContent)).toEqual(["J", "J", ""]);
  const rackEntry = yourRack.closest<HTMLElement>(".rack-entry");
  expect(rackEntry?.style.getPropertyValue("--opponent-rack-rows")).toBe("2");
  expect(panel.getByRole("button", { name: "Unseen tiles, 0 estimated tiles in the bag" }).textContent).toBe("0");
  expectLabeledRacks();
  const tools = panel.getByText("Rack tools").closest(".rack-lane-tools");
  expect(tools?.parentElement).toBe(phone ? yourRack.closest(".rack-entry") : opponentRack()?.parentElement);
  expect(panel.queryByRole("button", { name: "Optimal exchange" })).toBeNull();
  expect(panel.queryByText(/tap.*to type/i)).toBeNull();
  expect(yourRack.closest(".rack-entry")?.querySelector(".rack-entry-actions")).toBeNull();
  expect(screen.getByRole("heading", { name: "Possible moves - Endgame" })).toBeTruthy();

  await user.click(panel.getByText("Rack tools"));
  await user.click(panel.getByRole("button", { name: "Exclude tiles" }));
  await user.click(panel.getByRole("button", { name: /^Rack tile 3: T/ }));
  await user.click(panel.getByRole("button", { name: "Done" }));
  expect(opponentRack()).toBeTruthy();
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await screen.findAllByRole("button", { name: /^CAT, / });
  expect(!!yourRack.closest(".move-review")).toBe(phone);
  expectLabeledRacks();
  await openMoveOptions(user);
  await user.click(screen.getByText("Reply settings", { selector: "summary" }));
  const bag = screen.getByRole("spinbutton", { name: "Tiles in bag" });
  await user.type(bag, "1");
  await user.click(
    screen.getByRole("button", { name: "Update reply analysis" }),
  );
  expect(opponentRack()).toBeNull();
  if (!phone)
    expect(panel.getByRole("button", { name: "Unseen tiles, 1 tile in the bag" }).textContent).toBe("1");
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
  if (phone) {
    await user.click(panel.getByRole("button", { name: /Unseen tiles,.*check tile counts/ }));
    expect(screen.getByText("Check tile counts").closest(".phone-rack-details")).toBeTruthy();
  } else {
    expect(panel.getByText("Check tile counts")).toBeTruthy();
  }
});

test("the bag and top board strip warn about excess tiles until the rack is fixed", async () => {
  const board = remote.games[0].board;
  board.fill("U", 0, 4);
  remote.games[0].revision++;
  const user = await start();
  await waitFor(() => expect(current().revision).toBe(1));
  const bag = screen.getByRole("button", { name: /^Unseen tiles,/ });
  const gameBoard = within(screen.getByRole("region", { name: "Game board" }));
  const warning = () => gameBoard.queryByRole("img", { name: "Tile count error" });
  expect(bag.hasAttribute("data-overdrawn")).toBe(false);
  expect(warning()).toBeNull();
  await typeRack(user, "UUA");
  expect(bag.getAttribute("data-overdrawn")).toBe("true");
  expect(warning()?.closest(".last-play-row")?.lastElementChild).toBe(warning());
  expect(warning()?.querySelector(".lucide-triangle-alert")).toBeTruthy();
  expect(bag.getAttribute("aria-label")).toContain("check tile counts");
  expect(
    screen
      .getByLabelText("37 vowels, count exceeded")
      .classList.contains("tile-pool-category-alert"),
  ).toBe(true);
  expect(screen.getByText("56 consonants")).toBeTruthy();
  expect(screen.getByText("2 blanks")).toBeTruthy();
  await user.click(bag);
  expect(bag.getAttribute("aria-expanded")).toBe("true");
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

  await user.click(rackTile(1));
  await user.keyboard("S");
  expect(bag.hasAttribute("data-overdrawn")).toBe(true);
  expect(pool.getByRole("listitem", { name: "U: 1 extra" })).toBeTruthy();
  await user.click(rackTile(2));
  await user.keyboard("T");
  expect(bag.hasAttribute("data-overdrawn")).toBe(false);
  expect(warning()).toBeNull();
  expect(bag.getAttribute("aria-label")).not.toContain("check tile counts");
  expect(pool.getByRole("listitem", { name: "U: 0 unseen" })).toBeTruthy();
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

test("Optimal exchange shows a 100% keep or swap bingo chance in green", () => {
  render(
    <OptimalExchange
      game={{ ...game(), rack: "RETAINS" }}
      bag={86}
      restoredResult={{
        keepBingo: true,
        checked: 2,
        finalists: 2,
        screeningDraws: 128,
        refinementDraws: 256,
        bestSwaps: [
          { slots: [0], chance: 1, close: false },
          { slots: [1], chance: 0.5, close: false },
        ],
      }}
      onClose={vi.fn()}
      onUse={vi.fn()}
    />,
  );
  expect(screen.getByText("100%").classList.contains("value-good")).toBe(true);
  expect(screen.getByText("≈100%").classList.contains("value-good")).toBe(true);
  expect(screen.getByText("≈50%").classList.contains("value-bad")).toBe(true);
});

test("Optimal exchange restores the rankings and caches each completed simulation", async () => {
  remote.games[0].template = { ...remote.games[0].template, rackSize: 3 };
  remote.games[0].revision = 1;
  const searches: Extract<PracticeRequest, { kind: "optimal-exchange" }>[] = [];
  const simulations: Extract<PracticeRequest, { kind: "exchange" }>[] = [];
  let finishOptimal: (() => void) | undefined;
  let pendingSimulation: SolverWorker | undefined;
  vi.stubGlobal(
    "Worker",
    class extends SolverWorker {
      postMessage(request: SolverRequest | PracticeRequest) {
        if (request.kind === "optimal-exchange") {
          searches.push(request);
          const finish = () =>
            this.onmessage?.({
              data: {
                result: {
                  keepBingo: false,
                  checked: 7,
                  finalists: 7,
                  screeningDraws: 128,
                  refinementDraws: 256,
                  bestSwaps: [
                    { slots: [0, 2], chance: 0.42, close: false },
                    { slots: [1, 2], chance: 0.35, close: false },
                    { slots: [0], chance: 0.18, close: false },
                    { slots: [0, 1, 2], chance: 0, close: false },
                  ],
                },
              },
            });
          if (searches.length === 1) {
            finishOptimal = finish;
            queueMicrotask(() => this.onmessage?.({
              data: { progress: { completed: 128, total: 256, phase: "replies" } },
            }));
          } else queueMicrotask(finish);
        } else if (request.kind === "exchange") {
          simulations.push(request);
          pendingSimulation = this;
        } else if ("id" in request) {
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
  await waitFor(() => expect(current().template.rackSize).toBe(3));
  await typeRack(user, "CAT");
  const openOptimal = screen.getByRole("button", { name: "Optimal exchange" });
  expect(openOptimal.closest(".rack-entry-actions")).toBeTruthy();
  expect(openOptimal.closest(".rack-tools")).toBeNull();
  await user.click(openOptimal);
  const optimal = within(
    screen.getByRole("region", { name: "Optimal exchange" }),
  );
  expect(await optimal.findByText("128 / 256 reply scenarios checked")).toBeTruthy();
  await act(() => finishOptimal?.());
  expect(optimal.getByText(/Bingo chance after the opponent’s turn/)).toBeTruthy();
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
  expect(screen.queryByRole("region", { name: "Optimal exchange" })).toBeNull();
  const simulator = within(
    screen.getByRole("region", { name: "Simulate exchange" }),
  );
  expect(simulations[0].exchange.slots).toEqual([1, 2]);
  expect(simulations[0].exchange.bag).toBe(searches[0].exchange.bag);
  expect(
    simulator.getByText("Bingo chance after reply · ≈35% from Optimal exchange"),
  ).toBeTruthy();
  finishSimulation(24, 0.27);
  expect(simulator.getByText("24.0 pts")).toBeTruthy();
  expect(simulator.getByText("27%")).toBeTruthy();
  expect(simulator.getByText("Bingo chance on current board")).toBeTruthy();
  expect(simulator.getByText("Bingo chance after reply · ≈35% from Optimal exchange")).toBeTruthy();
  expect(
    screen.getByLabelText("Rack tile 2: A, marked for exchange"),
  ).toBeTruthy();
  expect(current().rack).toBe("CAT");
  await user.click(
    simulator.getByRole("button", { name: "Back to Optimal exchange" }),
  );
  expect(
    screen.queryByRole("region", { name: "Simulate exchange" }),
  ).toBeNull();
  const restored = within(
    screen.getByRole("region", { name: "Optimal exchange" }),
  );
  expect(restored.getAllByRole("row").map((row) => row.textContent)).toEqual(
    optimal.getAllByRole("row").map((row) => row.textContent),
  );
  expect(document.activeElement).toBe(
    restored.getByRole("heading", { name: "Optimal exchange" }),
  );
  await user.click(
    restored.getByRole("button", { name: "Simulate exchanging C, T" }),
  );
  expect(simulations[1].exchange.slots).toEqual([0, 2]);
  const other = within(
    screen.getByRole("region", { name: "Simulate exchange" }),
  );
  expect(
    other.getByText("Bingo chance after reply · ≈42% from Optimal exchange"),
  ).toBeTruthy();
  finishSimulation(31, 0.44);
  expect(other.getByText("31.0 pts")).toBeTruthy();
  await user.click(
    other.getByRole("button", { name: "Back to Optimal exchange" }),
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
    cached.getByRole("button", { name: "Back to Optimal exchange" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Simulate exchanging A, T" }),
  );
  expect(screen.getByText("28.0 pts")).toBeTruthy();
  expect(simulations).toHaveLength(3);
  await user.click(rackTile(1));
  await user.keyboard("B");
  expect(current().rack).toBe("BAT");
  expect(screen.queryByRole("region", { name: "Optimal exchange" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Back to Optimal exchange" }),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Optimal exchange" }));
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
    within(section).queryByRole("button", { name: "Back to Optimal exchange" }),
  ).toBeNull();
  expect(section.closest(".rack-panel")).toBeTruthy();
  const cat = await within(section).findByText("CAT");
  const row = within(cat.closest("li")!);
  expect(requests).toHaveLength(1);
  expect(
    row.getByText("C", { selector: ".mini-tiles span" }),
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
    matches: query !== "(prefers-reduced-motion: reduce)",
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
  const user = await start(fromResults ? 390 : 1200);
  await typeRack(user, "CATSUVW");
  await user.click(rackTile(7));
  await user.keyboard(fromResults ? "{ArrowRight}" : "{ArrowDown}");
  const solve = screen.getAllByRole("button", { name: "Find moves" })[0];
  await user.click(solve);
  await screen.findAllByRole("button", { name: /^CATS, / });
  expect(screen.queryByRole("button", { name: /^Swap .* pts/ })).toBeNull();
  expect(pending).toBeTruthy();
  expect(adviceRequest?.exchange.excludedRackSlots).toEqual([6]);
  if (!fromResults) {
    // Reverse the order of the recommended tiles before the worker replies.
    rackTile(6).focus();
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(current().rack).toBe("CATSVUW");
  }
  await act(() => pending?.onmessage?.({
    data: { result: { slots: [4, 5], edge: 8, comparedWith: "CATS" } },
  }));
  const rack = screen.getByRole("region", { name: "Your rack" });
  const header = screen.getByRole("heading", { name: "Possible moves" }).closest("header")!;
  const swap = { name: fromResults ? "Swap UV · +8 pts" : "Swap VU · +8 pts" };
  const action = within(fromResults ? header : rack).getByRole("button", swap);
  const tiles = within(rack).getByRole("group", { name: "Your rack tiles" });
  const scroll = vi.fn();
  tiles.scrollIntoView = scroll;
  await user.click(action);
  if (fromResults) expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: "start", behavior: "smooth" });
  else expect(scroll).not.toHaveBeenCalled();
  const panel = screen.getByRole("region", { name: "Simulate exchange" });
  expect(panel.closest(fromResults ? ".phone-rack-details" : ".rack-panel")).toBeTruthy();
  expect(within(panel).getByText(/Estimated \+8 points vs. CATS/)).toBeTruthy();
  expect(screen.getByLabelText(`Rack tile 5: ${fromResults ? "U" : "V"}, marked for exchange`)).toBeTruthy();
  expect(screen.getByLabelText(`Rack tile 6: ${fromResults ? "V" : "U"}, marked for exchange`)).toBeTruthy();
  expect(screen.getByLabelText("Rack tile 7: W, held out of solver")).toBeTruthy();
  expect(simulation?.exchange.slots).toEqual([4, 5]);
  expect(simulation?.exchange.excludedRackSlots).toEqual([6]);
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Simulate exchange (2)" }),
  );
  expect(current().rack).toBe(fromResults ? "CATSUVW" : "CATSVUW");

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

test("style exchanges replace general advice and ignore stale worker replies", async () => {
  let slow: SolverWorker | undefined;
  let simulation: Extract<PracticeRequest, { kind: "exchange" }> | undefined;
  const styles: string[] = [];
  vi.stubGlobal("Worker", class extends SolverWorker {
    override exchangeRequest(request: Extract<SolverRequest, { kind: "solve" }>) {
      return { ...request, plays: [] };
    }
    override postMessage(request: SolverRequest | PracticeRequest) {
      if (request.kind === "exchange-advice") {
        queueMicrotask(() => this.onmessage?.({ data: { result: { slots: [5], edge: 6, comparedWith: "CATS" } } }));
        return;
      }
      if (request.kind === "style-exchange") {
        const { profile, move } = request.exchange;
        styles.push(profile);
        expect(move?.word).toBe("AT");
        if (profile === "strong") slow = this;
        else queueMicrotask(() => this.onmessage?.({ data: { result: {
          slots: [4, 5], profile, problem: "awkward", comparedWith: { word: move!.word, score: move!.score },
        } } }));
        return;
      }
      if (request.kind === "exchange") {
        simulation = request;
        return;
      }
      if (request.kind === "page" && request.query.profile) {
        const result = this.results.get(request.searchId);
        const move = result?.moves.find(({ word }) => word === "AT");
        if (move) result!.setProfile(request.query, [{ move, utility: {
          total: 5, points: 5, premium: 0, visibility: 1, appeal: 2, leave: 0, goingOut: 0,
        } }], undefined, request.query.profile === "learner" ? {
          rack: "CATSVUW",
          advice: {
            slots: [4], profile: "learner", problem: "awkward", edge: 7,
            comparedWith: { word: move.word, score: move.score },
          },
        } : request.query.profile === "casual" ? {
          rack: "CATSUVW",
          advice: {
            slots: [4, 5], profile: "casual", problem: "awkward",
            comparedWith: { word: move.word, score: move.score },
          },
        } : undefined);
      }
      if (["solve", "page", "shortlist", "endgame", "discard", "cancel"].includes(request.kind))
        super.postMessage(request as SolverRequest);
    }
  });
  const user = await start();
  await typeRack(user, "CATSUVW");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  const header = within(screen.getByRole("heading", { name: "Possible moves" }).closest("header")!);
  await header.findByRole("button", { name: "Swap V · +6 pts" });
  const picker = screen.getByRole("combobox", { name: "Playing style" });
  await user.selectOptions(picker, "learner");
  const forecast = await header.findByRole("button", { name: "Swap V" });
  expect(forecast.title).toContain("Learner estimates +7 points through your next turn");
  await user.click(forecast);
  expect(simulation?.exchange.slots).toEqual([5]);
  expect(styles).toEqual([]);
  await user.click(screen.getByRole("button", { name: "Clear marks" }));
  expect(screen.queryByRole("region", { name: "Simulate exchange" })).toBeNull();

  await user.selectOptions(picker, "casual");
  const styled = await header.findByRole("button", { name: "Swap UV" });
  expect(header.queryByRole("button", { name: "Swap V · +6 pts" })).toBeNull();
  expect(screen.getAllByRole("button", { name: "Swap UV" })).toHaveLength(2);
  await user.click(styled);
  const panel = screen.getByRole("region", { name: "Simulate exchange" });
  expect(within(panel).getByText(/Casual would exchange to shed awkward tiles. Its best spotted play is AT for/)).toBeTruthy();
  expect(simulation?.exchange.slots).toEqual([4, 5]);

  await user.selectOptions(picker, "strong");
  await waitFor(() => expect(slow).toBeTruthy());
  expect(header.queryByRole("button", { name: /^Swap/ })).toBeNull();
  await user.selectOptions(picker, "");
  expect(slow?.terminate).toHaveBeenCalled();
  await act(() => slow?.onmessage?.({ data: { result: { slots: [6], profile: "strong", edge: 5 } } }));
  expect(header.queryByRole("button", { name: "Swap W" })).toBeNull();
  expect(header.getByRole("button", { name: "Swap V · +6 pts" })).toBeTruthy();
  expect(styles).toEqual(["strong"]);
});

test("a new search after playing starts with highest points", async () => {
  const user = await start();
  await typeRack(user, "CATS");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  await user.click(await screen.findByLabelText("Word sort options"));
  await user.click(screen.getByRole("button", { name: "Sort by word length" }));
  expect(screen.getByLabelText("Word sort options").textContent).toBe("LENGTH");
  await user.click(
    (await screen.findAllByRole("button", { name: /^AT, / }))[0],
  );
  await typeRack(user, "CATS");
  await user.click(screen.getAllByRole("button", { name: "Find moves" })[0]);
  const points = await screen.findByRole("button", { name: "Sort by points" });
  expect(points.getAttribute("aria-pressed")).toBe("true");
  expect(points.getAttribute("title")).toBe("points (descending)");
});


test("the empty Possible moves tiles keep their word and colors until the panel reopens", async () => {
  const random = vi.spyOn(Math, "random").mockReturnValue(0.999);
  try {
    const user = await start();
    const panel = screen.getByRole("region", { name: "Possible moves" });
    const tiles = () => [...panel.querySelectorAll(".illustrated-tiles > span")];
    const word = () => tiles().map((tile) => tile.textContent);
    const colors = () => tiles().map((tile) => tile.classList.contains("illustrated-tile-green"));
    expect(word()).toEqual(["O1", "H4", "O1"]);
    expect(colors()).toEqual([false, false, false]);

    random.mockReturnValue(0);
    await typeRack(user, "CATS");
    expect(word()).toEqual(["O1", "H4", "O1"]);
    expect(colors()).toEqual([false, false, false]);

    await user.click(within(panel).getByRole("button", { name: "Find moves" }));
    const close = await within(panel).findByRole("button", { name: "Close possible moves" });
    random.mockReturnValueOnce(0).mockReturnValueOnce(0.1).mockReturnValueOnce(0.2).mockReturnValueOnce(0.8);
    fireEvent.click(close);
    expect(word()).toEqual(["A1", "H4", "A1"]);
    expect(colors()).toEqual([true, true, false]);
  } finally {
    random.mockRestore();
  }
});

test.each([false, true])("the idle header collapses and its star still finds moves (phone %s)", async (phone) => {
  remote.games[0] = { ...playBeforeRefill(), rack: "DSD" };
  const searches: string[] = [];
  let finish: (() => void) | undefined;
  vi.stubGlobal("Worker", class extends SolverWorker {
    postMessage(request: SolverRequest | OpponentEndgameRequest) {
      if (request.kind === "solve") {
        searches.push(request.kind);
        finish = () => super.postMessage(request);
      } else if (request.kind === "solve-opponent-endgame") {
        searches.push(request.kind);
      } else super.postMessage(request);
    }
  });

  const user = await start(phone ? 390 : 1200);
  const panel = within(screen.getByRole("region", { name: "Possible moves" }));
  const star = await panel.findByRole("button", { name: "Find moves shortcut" });
  expect(star.closest("header")).toBeTruthy();
  const intro = () => panel.getByRole("button", { name: /^Possible moves/ });
  expect(intro().getAttribute("aria-expanded")).toBe("true");
  expect(panel.getByRole("button", { name: "Solve endgame" })).toBeTruthy();
  await user.click(intro());
  expect(intro().getAttribute("aria-expanded")).toBe("false");
  expect(panel.queryByRole("button", { name: "Find moves" })).toBeNull();
  expect(panel.queryByRole("button", { name: "Solve endgame" })).toBeNull();
  expect(searches).toEqual([]);
  await user.keyboard("{Enter}");
  expect(panel.getByRole("button", { name: "Find moves" })).toBeTruthy();
  await user.click(intro());
  if (phone) await user.click(star);
  else {
    star.focus();
    await user.keyboard("{Enter}");
  }

  expect(searches).toEqual(["solve"]);
  expect(panel.queryByRole("button", { name: "Find moves shortcut" })).toBeNull();
  expect(panel.getByRole("heading", { name: "Finding moves…" })).toBeTruthy();
  await act(() => finish?.());
  expect((await panel.findAllByRole("button", { name: /, \d+ points,/ })).length).toBeGreaterThan(0);
  expect(panel.queryByRole("button", { name: "Find moves shortcut" })).toBeNull();
  await user.click(panel.getByRole("button", { name: "Close possible moves" }));
  expect(intro().getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(intro());
});

test("the filled search button follows the active turn in the endgame", async () => {
  remote.games[0] = { ...playBeforeRefill(), rack: "DSD", scoring: emptyScoring() };
  const user = await start();
  const board = within(screen.getByRole("region", { name: "Game board" }));
  const moves = within(screen.getByRole("region", { name: "Possible moves" }));
  const find = () => moves.getByRole("button", { name: "Find moves" });
  const endgame = () => moves.getByRole("button", { name: "Solve endgame" });

  expect(find().classList.contains("primary")).toBe(true);
  expect(endgame().classList.contains("secondary")).toBe(true);
  await user.click(board.getByRole("button", { name: "Pass" }));
  expect(find().classList.contains("secondary")).toBe(true);
  expect(endgame().classList.contains("primary")).toBe(true);
  await user.click(board.getByRole("button", { name: "Pass" }));
  expect(find().classList.contains("primary")).toBe(true);
  expect(endgame().classList.contains("secondary")).toBe(true);
});

test.each([false, true])("after the last draw, Solve endgame previews opponent lines without playing (phone %s)", async (phone) => {
  const played = playBeforeRefill();
  remote.games[0] = { ...played, trackScores: true, scoring: emptyScoring() };
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: !phone && query === "(any-hover: hover)",
    addEventListener() {},
    removeEventListener() {},
  }));
  const requests: OpponentEndgameRequest[] = [];
  let finds = 0;
  class WorkerWithEndgame extends SolverWorker {
    postMessage(request: SolverRequest | OpponentEndgameRequest) {
      if (request.kind !== "solve-opponent-endgame") {
        if (request.kind === "solve") finds++;
        return super.postMessage(request);
      }
      requests.push(request);
      void parallelOpponentEndgame(
        new Lexicon(opponentEndgameWords), request, 1, () => undefined,
      ).then((result) => this.onmessage?.({ data: { result } }));
    }
  }
  vi.stubGlobal("Worker", WorkerWithEndgame);
  const request = fetch;
  const lookup = vi.fn(async (url: string, options?: RequestInit) => {
    if (!url.startsWith("/api/definitions?")) return request(url, options);
    const word = new URL(url, "http://localhost").searchParams.get("word");
    return new Response(JSON.stringify({
      available: true,
      entries: [[{ spelling: word?.toLowerCase(), glosses: ["Sample definition."] }]],
    }));
  });
  vi.stubGlobal("fetch", lookup);
  const user = await start(phone ? 390 : 1200);
  expect(screen.queryByRole("button", { name: "Solve endgame" })).toBeNull();
  await user.click(rackTile(3));
  await user.keyboard("D");

  const empty = within(screen.getByRole("region", { name: "Possible moves" }));
  const solve = empty.getByRole("button", { name: "Solve endgame" });
  expect(solve.previousElementSibling).toBe(empty.getByRole("button", { name: "Find moves" }));
  await user.click(solve);

  const result = within(await screen.findByRole("region", { name: "Opponent endgame" }));
  expect(result.getByRole("heading", { name: "Opponent endgame" }).previousElementSibling
    ?.querySelector(".lucide-swords")).toBeTruthy();
  const list = result.getByRole("list", { name: /sorted by swing for you/ });
  const rows = within(list).getAllByRole("button");
  expect(rows).toHaveLength(5);
  expect(within(rows[0]).getByText(/^Lose by \d+$/)).toBeTruthy();
  expect(rows.map((row) => row.querySelector(".endgame-ply-count")?.textContent)).toEqual([
    "1 ply", "1 ply", "1 ply", "3 plies", "5 plies (3)",
  ]);
  expect(rows[4].querySelector(".endgame-ply-count")?.getAttribute("title"))
    .toBe("5 plies · 3 plays · 2 passes");
  expect(finds).toBe(0);
  expect(requests[0]).toMatchObject({ rack: "DSD", opponentRack: "AOT", dictionaryId: "test" });
  const boardBefore = [...current().board];
  const timing = result.getByRole("button", { name: /^Calculation timing,/ });
  await user.click(timing);
  const dialog = within(screen.getByRole("dialog", { name: "Calculation timing" }));
  expect(dialog.getByText("Total elapsed time")).toBeTruthy();
  expect(dialog.getByText(/^Options 1–\d+$/)).toBeTruthy();
  await user.click(dialog.getByRole("button", { name: "Close dialog" }));

  expect(result.getByText(phone ? /hold a word to define/ : /hover over a word to define/)).toBeTruthy();
  async function define(letters: Element, word: string, row: Element) {
    vi.useFakeTimers();
    try {
      const attribute = row.hasAttribute("aria-expanded") ? "aria-expanded" : "aria-pressed";
      const before = row.getAttribute(attribute);
      if (phone) {
        touch(letters, "pointerdown");
        expect(fireEvent.contextMenu(letters)).toBe(false);
        await act(() => vi.advanceTimersByTimeAsync(450));
        const sheet = screen.getByRole("dialog", { name: word });
        expect(within(sheet).getByText("Sample definition.")).toBeTruthy();
        touch(sheet, "pointerup");
        expect(fireEvent.click(letters, { detail: 1 })).toBe(false);
        act(() => vi.advanceTimersByTime(32));
        const close = within(sheet).getByRole("button", { name: "Close dialog" });
        touch(close, "pointerdown");
        fireEvent.click(close, { detail: 1 });
        expect(screen.queryByRole("dialog", { name: word })).toBeNull();
      } else {
        touch(letters, "pointerover", { pointerType: "mouse", buttons: 0 });
        await act(() => vi.advanceTimersByTimeAsync(500));
        const tooltip = screen.getByRole("tooltip");
        expect(within(tooltip).getByText("Sample definition.")).toBeTruthy();
        expect(row.getAttribute("aria-describedby")).toBe(tooltip.id);
        touch(letters, "pointerout", { pointerType: "mouse" });
        act(() => vi.advanceTimersByTime(200));
        expect(screen.queryByRole("tooltip")).toBeNull();
      }
      expect(row.getAttribute(attribute)).toBe(before);
      expect(lookup).toHaveBeenCalledWith(
        `/api/definitions?language=en&word=${word}`,
        expect.objectContaining({ method: "GET" }),
      );
    } finally {
      vi.useRealTimers();
    }
  }
  const firstLetters = rows[0].querySelector(".result-letters")!;
  await define(firstLetters, firstLetters.textContent!, rows[0]);
  expect(result.queryByRole("region", { name: "Opponent reply details" })).toBeNull();

  const boardGhost = () => document.querySelector(".board-entry .ghost");
  const previewPlayer = () => document.querySelector(".board-entry .board-grid")
    ?.getAttribute("data-preview-player");
  touch(rows[1], "pointerover", { pointerType: phone ? "touch" : "mouse" });
  expect(!!boardGhost()).toBe(!phone);
  expect(previewPlayer()).toBe(phone ? null : "opponent");
  expect(rows[1].getAttribute("aria-expanded")).toBe("false");
  expect(result.queryByRole("region", { name: "Opponent reply details" })).toBeNull();
  touch(rows[1], "pointerout", { pointerType: phone ? "touch" : "mouse" });
  expect(boardGhost()).toBeNull();

  if (!phone) {
    expect(fireEvent.contextMenu(rows[0])).toBe(false);
    expect(rows[0].getAttribute("aria-expanded")).toBe("true");
    const pinnedGhost = boardGhost();
    expect(pinnedGhost).toBeTruthy();
    touch(rows[1], "pointerover", { pointerType: "mouse" });
    expect(boardGhost()).toBe(pinnedGhost);
    touch(rows[1], "pointerout", { pointerType: "mouse" });
    expect(boardGhost()).toBe(pinnedGhost);
    expect(fireEvent.contextMenu(rows[0])).toBe(false);
    expect(rows[0].getAttribute("aria-expanded")).toBe("false");
    expect(boardGhost()).toBeNull();
  }

  await user.click(rows[0]);
  const preview = within(result.getByRole("region", { name: "Opponent reply details" }));
  expect(preview.getByRole("heading", { name: "Optimal endgame line" })).toBeTruthy();
  expect(preview.queryByRole("button", { pressed: true })).toBeNull();
  expect(preview.getByText("Current board")).toBeTruthy();
  const firstTurn = preview.getByRole("table", { name: "Optimal endgame line" })
    .querySelector<HTMLButtonElement>("tbody button")!;
  await user.click(firstTurn);
  expect(previewPlayer()).toBe("opponent");
  expect(result.getByRole("region", { name: "Opponent reply details" })
    .querySelector('.board-grid[data-preview-player="opponent"] .ghost')).toBeTruthy();
  const stepLetters = firstTurn.querySelector('[role="img"][aria-label]')!;
  await define(stepLetters, stepLetters.getAttribute("aria-label")!, firstTurn);
  expect(firstTurn.getAttribute("aria-pressed")).toBe("true");
  expect(firstTurn.textContent).toContain("Opponent");
  expect(within(firstTurn).getByRole("img", { name: "Bingo" })).toBeTruthy();
  expect(firstTurn.closest("tr")!.querySelector(".optimal-reply-step-score small.value-bad")?.textContent)
    .toMatch(/^−\d+$/);
  expect(firstTurn.closest("tbody")?.firstElementChild).toBe(firstTurn.closest("tr"));
  const secondTurn = firstTurn.closest("tr")?.nextElementSibling?.querySelector("button");
  if (secondTurn) {
    await user.click(secondTurn);
    expect(secondTurn.getAttribute("aria-pressed")).toBe("true");
  }
  expect(document.querySelector(".board-entry .ghost")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  if (phone) await user.click(screen.getByText("Rack tools").closest("summary")!);
  const random = vi.spyOn(Math, "random").mockReturnValue(0);
  try {
    await user.click(screen.getByRole("button", { name: "Shuffle rack" }));
  } finally {
    random.mockRestore();
  }
  expect(current().rack).toBe("SDD");
  const rack = screen.getByRole("group", { name: "Your rack tiles" });
  const tray = phone ? new DOMRect(0, 0, 40, 120) : new DOMRect(0, 0, 120, 40);
  vi.spyOn(rack, "getBoundingClientRect").mockReturnValue(tray);
  for (let i = 0; i < 3; i++) {
    const tile = new DOMRect(phone ? 0 : i * 40, phone ? i * 40 : 0, 36, 36);
    vi.spyOn(rackTile(i + 1), "getBoundingClientRect").mockReturnValue(tile);
  }
  const first = rackTile(1);
  const point = (axis: number) => phone
    ? { pointerType: "touch", clientX: 18, clientY: axis }
    : { pointerType: "mouse", clientX: axis, clientY: 18 };
  touch(first, "pointerdown", point(18));
  touch(first, "pointermove", point(118));
  touch(first, "pointerup", point(118));
  expect(current().rack).toBe("DDS");
  expect(requests).toHaveLength(1);
  expect(result.getByRole("region", { name: "Opponent reply details" })).toBeTruthy();
  expect(result.getByRole("button", { name: /^Calculation timing,/ })).toBe(timing);
  await user.click(rows[0]);
  expect(result.queryByRole("region", { name: "Opponent reply details" })).toBeNull();
  expect(document.querySelector(".board-entry .ghost")).toBeNull();
  expect(current().board).toEqual(boardBefore);
  expect(current().rack).toBe("DDS");
  await user.click(result.getByRole("button", { name: "Close opponent endgame" }));
  expect(screen.getByRole("button", { name: "Solve endgame" })).toBeTruthy();
});

test("going out with score tracking off disables opponent endgame when the opponent still has a tile", async () => {
  const opening = { ...game(), rack: "CATS", trackScores: false, revision: 1 };
  opening.template.tileCounts = Object.fromEntries(
    TILE_SYMBOLS.map((symbol) => [symbol, Number("CATSZ".includes(symbol))]),
  );
  const [move] = solve(new Lexicon(["CATS"]), opening.board, opening.rack, opening.template);
  remote.games[0] = applyMove(opening, move, "you");
  const requests: OpponentEndgameRequest[] = [];
  vi.stubGlobal("Worker", class extends SolverWorker {
    postMessage(request: SolverRequest | OpponentEndgameRequest) {
      if (request.kind === "solve-opponent-endgame") requests.push(request);
      else super.postMessage(request);
    }
  });
  const user = await start();
  const endgame = await screen.findByRole("button", { name: "Solve endgame" });
  expect(endgame).toHaveProperty("disabled", true);
  expect(screen.getByText("Your rack is empty. There’s no opponent endgame to solve.")).toBeTruthy();
  await user.click(endgame);
  expect(requests).toHaveLength(0);
});

test("editing the position cancels the opponent worker and ignores its stale result", async () => {
  remote.games[0] = { ...playBeforeRefill(), rack: "DSD" };
  let pending: SolverWorker | undefined;
  class DeferredEndgameWorker extends SolverWorker {
    postMessage(request: SolverRequest | OpponentEndgameRequest) {
      if (request.kind === "solve-opponent-endgame") pending = this;
      else super.postMessage(request);
    }
  }
  vi.stubGlobal("Worker", DeferredEndgameWorker);
  const user = await start();
  await user.click(screen.getByRole("button", { name: "Solve endgame" }));
  expect(screen.getByText("Solving opponent endgame…")).toBeTruthy();
  const heading = screen.getByRole("heading", { name: "Opponent endgame" });
  expect(heading.previousElementSibling?.querySelector(".lucide-swords")).toBeTruthy();
  await user.click(rackTile(3));
  await user.keyboard("{Backspace}");
  expect(pending?.terminate).toHaveBeenCalledTimes(1);
  await act(async () => pending?.onmessage?.({ data: { result: { checked: 0, total: 1, lines: [], batches: [] } } }));
  expect(screen.queryByRole("region", { name: "Opponent endgame" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Solve endgame" })).toBeNull();
});

test("an archived game can solve an edited empty-bag position before and after Find moves", async () => {
  const archived = archivedBeforeEndgame();
  remote.games.push(archived);
  const requests: OpponentEndgameRequest[] = [];
  class ArchivedEndgameWorker extends SolverWorker {
    postMessage(request: SolverRequest | OpponentEndgameRequest) {
      if (request.kind !== "solve-opponent-endgame")
        return super.postMessage(request);
      requests.push(request);
      void parallelOpponentEndgame(
        new Lexicon(opponentEndgameWords), request, 1, () => undefined,
      ).then((result) => this.onmessage?.({ data: { result } }));
    }
  }
  vi.stubGlobal("Worker", ArchivedEndgameWorker);
  const user = await start();
  await user.click(navLink("Archived games"));
  await user.click(await screen.findByRole("button", { name: /^Archived endgame/ }));
  await screen.findByRole("heading", { name: "Archived endgame" });

  const solve = () => screen.queryByRole("button", { name: "Solve endgame" });
  expect(solve()).toBeNull();
  await user.click(rackTile(3));
  await user.keyboard("D");
  expect(solve()).toBeTruthy();
  await user.click(solve()!);

  const results = within(await screen.findByRole("region", { name: "Opponent endgame" }));
  expect(results.getByText("Opponent plays next")).toBeTruthy();
  const ranked = within(results.getByRole("list", { name: /sorted by swing for you/ }));
  await user.click(ranked.getAllByRole("button")[0]);
  expect(results.queryByRole("button", { pressed: true })).toBeNull();
  expect(results.getByText("Current board")).toBeTruthy();
  expect(requests[0]).toMatchObject({
    board: archived.board,
    rack: "DSD",
    opponentRack: "AOOT",
  });
  expect(store.getSnapshot().games[archived.id]).toMatchObject({
    archived: true,
    board: archived.board,
    rack: "DSD",
    archivedState: { rack: "DS" },
  });
  await user.click(results.getByRole("button", { name: "Close opponent endgame" }));

  await user.click(within(screen.getByRole("region", { name: "Possible moves" }))
    .getByRole("button", { name: "Find moves" }));
  await openMoveOptions(user);
  expect(solve()).toBeTruthy();
  await user.click(screen.getByText("Reply settings", { selector: "summary" }));
  const bag = screen.getByRole("spinbutton", { name: "Tiles in bag" });
  await user.type(bag, "1");
  await user.click(screen.getByRole("button", { name: "Update reply analysis" }));
  expect(solve()).toBeNull();
  await user.clear(bag);
  await user.type(screen.getByRole("spinbutton", { name: "Prior scoreless turns" }), "2");
  await user.click(screen.getByRole("button", { name: "Update reply analysis" }));
  await user.click(solve()!);
  expect(requests[1]).toMatchObject({ scorelessTurns: 2, opponentRack: "AOOT" });
  await screen.findByRole("region", { name: "Opponent endgame" });
  await user.click(screen.getByRole("button", { name: "Close opponent endgame" }));
  expect((await openMoveOptions(user)).getByRole("button", { name: "Analyze" })).toBeTruthy();
});

test("an active empty-bag game can solve with two partial racks and no refill history", async () => {
  const { board, template } = playBeforeRefill();
  remote.games[0] = {
    ...game(),
    board,
    template: { ...template, rackSize: 4 },
    rack: "DSD",
    revision: 1,
    scoring: emptyScoring(),
  };
  const requests: OpponentEndgameRequest[] = [];
  class PartialRackEndgameWorker extends SolverWorker {
    postMessage(request: SolverRequest | OpponentEndgameRequest) {
      if (request.kind !== "solve-opponent-endgame")
        return super.postMessage(request);
      requests.push(request);
      void parallelOpponentEndgame(
        new Lexicon(opponentEndgameWords), request, 1, () => undefined,
      ).then((result) => this.onmessage?.({ data: { result } }));
    }
  }
  vi.stubGlobal("Worker", PartialRackEndgameWorker);
  const user = await start();
  const solveEndgame = () => screen.getByRole("button", { name: "Solve endgame" });
  await user.click(await screen.findByRole("button", { name: "Solve endgame" }));

  const results = within(await screen.findByRole("region", { name: "Opponent endgame" }));
  expect(requests[0]).toMatchObject({ rack: "DSD", opponentRack: "AOT" });
  const list = results.getByRole("list", { name: /sorted by swing for you/ });
  const row = within(list).getAllByRole("button")[0];
  const swing = row.querySelector(".endgame-estimate")!;
  expect(swing.children).toHaveLength(3);
  expect(swing.lastElementChild?.textContent).toBe("1 ply");
  await user.click(row);
  expect(results.queryByRole("button", { pressed: true })).toBeNull();
  expect(results.getByText("Current board")).toBeTruthy();
  expect(current().board).toEqual(board);
  expect(current().rack).toBe("DSD");
  await user.click(results.getByRole("button", { name: "Close opponent endgame" }));

  await user.click(within(screen.getByRole("region", { name: "Possible moves" }))
    .getByRole("button", { name: "Find moves" }));
  expect(await screen.findByRole("button", { name: "All moves" })).toBeTruthy();
  const moveMenu = await openMoveOptions(user);
  expect(moveMenu.getByRole("button", { name: /^Shortlist/ })).toBeTruthy();
  expect(moveMenu.getByRole("button", { name: "Solve endgame" })).toBe(solveEndgame());
});


test("phone move review keeps Define visible and disabled until results close", async () => {
  const base = { ...game(), rack: "CATS" };
  const play = solve(new Lexicon(["CAT"]), base.board, base.rack, base.template)[0];
  remote.games[0] = { ...playTrackedMove(base, play), revision: 1 };
  const user = await start(390);
  const board = screen.getByRole("region", { name: "Game board" });
  const define = () => within(board).getByRole("button", { name: "Define" });
  expect(define()).toHaveProperty("disabled", false);

  const possible = within(screen.getByRole("region", { name: "Possible moves" }));
  await user.click(possible.getByRole("button", { name: "Find moves" }));
  const prompt = await within(board).findByText("Choose a move to preview");
  const review = within(prompt.parentElement!);
  const disabledDefine = review.getByRole("button", { name: "Define" });
  expect(disabledDefine).toHaveProperty("disabled", true);
  expect(disabledDefine.querySelector("svg")).toBeTruthy();

  await user.click(possible.getByRole("button", { name: "Close possible moves" }));
  expect(define()).toHaveProperty("disabled", false);
});

test.each([false, true])("closing Possible moves clears its preview and returns to Find moves (phone %s)", async (phone) => {
  const user = await start(phone ? 390 : 1200);
  await typeRack(user, "CATS");
  const possible = () => within(screen.getByRole("region", { name: "Possible moves" }));
  await user.click(possible().getByRole("button", { name: "Find moves" }));
  const move = (await possible().findAllByRole("button", { name: /^CATS, / }))[0];
  if (phone) {
    await user.pointer([{ keys: "[TouchA]", target: move }, { keys: "[/TouchA]" }]);
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  } else {
    fireEvent.contextMenu(move);
  }
  expect(document.querySelector(".board-entry .ghost")).toBeTruthy();

  const close = possible().getByRole("button", { name: "Close possible moves" });
  expect(close.parentElement?.lastElementChild).toBe(close);
  await user.click(close);
  const find = possible().getByRole("button", { name: "Find moves" });
  expect(document.activeElement).toBe(find);
  expect(possible().queryByRole("button", { name: "Close possible moves" })).toBeNull();
  expect(document.querySelector(".board-entry .ghost")).toBeNull();
  expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  expect(current().rack).toBe("CATS");
  expect(current().board.some(Boolean)).toBe(false);

  await user.click(find);
  expect(await possible().findByRole("button", { name: "Close possible moves" })).toBeTruthy();
  expect(await possible().findAllByRole("button", { name: /^CATS, / })).not.toHaveLength(0);
});


test.each([
  ["scrabble", "AEINRS", true],
  ["scrabble", "AEINRS?", false],
  ["lexulous", "AEINRS", true],
  ["lexulous", "AEINRST", false],
  ["lexulous", "AEINRST?", false],
] as const)("Optimal exchange eligibility follows %s bingo rules for %s", async (rules, rack, disabled) => {
  remote.games[0] = { ...game(), revision: 1, rack, template: PRESETS.find(t => t.rules === rules)! };
  const user = await start();
  await waitFor(() => expect(current().rack).toBe(rack));
  const button = screen.getByRole<HTMLButtonElement>("button", { name: "Optimal exchange" });
  expect(button.disabled).toBe(disabled);
  if (disabled) {
    expect(button.title).toContain("at least 7 playable rack tiles");
    await user.click(button);
    expect(screen.queryByRole("region", { name: "Optimal exchange" })).toBeNull();
  }
});

test("an undersized rack cannot start an Optimal exchange worker directly", () => {
  const worker = vi.fn();
  vi.stubGlobal("Worker", worker);
  render(<OptimalExchange game={{ ...game(), rack: "CAT" }} bag={90}
    onClose={() => {}} onUse={() => {}} />);
  expect(screen.getByText(/at least 7 playable rack tiles for a bingo/)).toBeTruthy();
  expect(worker).not.toHaveBeenCalled();
});
