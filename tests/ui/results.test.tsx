import { useMoveListNavigation } from "../../src/useMoveListNavigation";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import {
  act,
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MoveTimingButton from "../../src/components/MoveTimingButton";
import OptimalReplyDetails from "../../src/components/OptimalReplyDetails";
import Results from "../../src/components/Results";
import { emptyBoard, type Game, type Move } from "../../shared/model";
import { TILE_SYMBOLS } from "../../shared/tile-pool";
import { PRESETS } from "../../shared/presets";
import type { DefenseResults, MoveDefense } from "../../shared/premium-defense";
import type {
  ReplyRequest,
  ReplyDistribution,
} from "../../shared/reply-analysis";
import { type BoardOddsResult, type RackOdds } from "../../shared/bingo-odds";
import {
  MoveResultIndex,
  type MoveResults,
  type MoveStyle,
  type RequiredSquares,
} from "../../shared/move-results";
import { PLAYER_PROFILES } from "../../shared/player-profiles";
import { moveRowHeight, type FetchMovePage } from "../../src/useMoveResults";
import { useReplyAnalysis } from "../../src/useReplyAnalysis";
import type { RankEndgame } from "../../src/useSolver";
import type {
  EndgamePrecomputeMessage,
  EndgamePrecomputeRequest,
} from "../../src/useEndgameLines";
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

test("timing bars use total elapsed time for both stages and exact solves", async () => {
  const timing = {
    total: 2000,
    solver: { moves: 200, indexing: 0 },
    exactLines: {
      elapsed: 1500,
      attempts: [
        { move: moves[0], elapsed: 500 },
        { move: moves[1], elapsed: 800, limit: "Search limit" },
      ],
    },
  };
  const user = userEvent.setup();
  const { rerender } = render(<MoveTimingButton timing={timing} />);
  await user.click(screen.getByRole("button", { name: "Calculation timing, 2.00 s" }));
  const dialog = screen.getByRole("dialog", { name: "Calculation timing" });
  const bars = () =>
    [...dialog.querySelectorAll("dd")].map((value) =>
      value.style.getPropertyValue("--timing-bar-width"),
    );
  expect(bars()).toEqual(["100%", "10%", "0%", "75%", "25%", "40%"]);

  rerender(<MoveTimingButton timing={{ ...timing, total: 0 }} />);
  expect(bars()).toEqual(Array(6).fill("0%"));

  rerender(<MoveTimingButton timing={{
    total: 2000,
    batches: [
      { checked: 500, elapsed: 500 },
      { checked: 1000, elapsed: 800 },
      { checked: 1200, elapsed: 200 },
    ],
  }} />);
  const stages = within(dialog);
  expect(stages.getByText("Options 1–500")).toBeTruthy();
  expect(stages.getByText("Options 501–1,000")).toBeTruthy();
  expect(stages.getByText("Options 1,001–1,200")).toBeTruthy();
  expect(stages.queryByText("Individual endgame solves")).toBeNull();
  expect(bars()).toEqual(["100%", "25%", "40%", "10%"]);
});

function setup(
  mobile = false,
  options: {
    compact?: boolean;
    hover?: boolean;
    moves?: Move[];
    size?: number;
    rackSize?: number;
    bingoBonus?: number;
    rackOdds?: RackOdds;
    boardOdds?: BoardOddsResult;
    analysisGame?: Game;
    replyEnabled?: boolean;
    defense?: DefenseResults;
    playingStyle?: MoveStyle;
    requiredSquares?: RequiredSquares;
    fetchPage?: FetchMovePage;
    rankEndgame?: (index: MoveResultIndex) => RankEndgame;
    onBoardOdds?: (moves: Move[], bagSize: number) => BoardOddsResult | void;
  } = {},
) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(any-hover: hover)" ? (options.hover ?? !mobile) : !mobile,
  }));
  const onPlay = vi.fn(),
    onPreview = vi.fn();
  const bingoRules = {
    ...PRESETS[0],
    rackSize: options.rackSize ?? 7,
    bingo: options.bingoBonus ?? 50,
  };
  const index = new MoveResultIndex(options.moves ?? moves, bingoRules);
  const rank = options.rankEndgame?.(index);
  const fetchPage =
    options.fetchPage ?? vi.fn(async (_id, query) => index.page(query));
  const fetchShortlist = vi.fn(async (_id, options) =>
    index.shortlist(options),
  );
  function Harness({ results }: { results: MoveResults }) {
    const [preview, setPreview] = useState<Move | null>(null);
    const [boardOdds, setBoardOdds] = useState(options.boardOdds);
    const navigation = useMoveListNavigation(results.searchId, options.playingStyle);
    const replyAnalysis = useReplyAnalysis(
      options.analysisGame,
      options.analysisGame?.id,
      results.head,
      options.replyEnabled ?? !!options.analysisGame,
      rank && { searchId: results.searchId, rank },
    );
    return (
      <Results
        results={results}
        navigation={navigation}
        playingStyle={options.playingStyle}
        requiredSquares={options.requiredSquares}
        fetchPage={fetchPage}
        fetchShortlist={fetchShortlist}
        busy=""
        error=""
        size={options.size ?? 15}
        bingoRules={bingoRules}
        rackOdds={options.rackOdds}
        boardOdds={boardOdds}
        analysisGame={options.analysisGame}
        replyAnalysis={replyAnalysis}
        replyEnabled={options.replyEnabled}
        defense={options.defense}
        preview={preview}
        phoneLayout={mobile}
        compact={options.compact}
        onPreview={(m) => {
          setPreview(m);
          onPreview(m);
        }}
        onPlay={onPlay}
        onSolve={() => {}}
        onCancelSearch={() => {}}
        onCloseResults={() => {}}
        onBoardOdds={
          options.onBoardOdds &&
          ((moves, bagSize) => {
            const result = options.onBoardOdds?.(moves, bagSize);
            if (result) setBoardOdds(result);
          })
        }
        onCancelBoardOdds={options.onBoardOdds ? () => {} : undefined}
        hasRack
      />
    );
  }
  let searchId = 0;
  const view = render(<Harness results={index.summary(searchId)} />);
  return {
    onPlay,
    onPreview,
    user: userEvent.setup(),
    rerun: () => view.rerender(<Harness results={index.summary(++searchId)} />),
  };
}
const rows = () => screen.getAllByRole("button", { name: /points,/ });
const displayedRank = (row: HTMLElement) => row.querySelector(".result-rank")?.textContent;

async function selectWordSort(
  user: ReturnType<typeof userEvent.setup>,
  sort: "word" | "word length",
) {
  await user.click(screen.getByLabelText("Sort by word or length"));
  await user.click(screen.getByRole("button", { name: `Sort by ${sort}` }));
}

test("the header omits the bingo count when no moves are bingos", () => {
  setup();
  expect(screen.queryByRole("img", { name: /bingos?/i })).toBeNull();
});

test("the header counts bingos outside the visible page and across placements", async () => {
  const nonBingos = Array.from({ length: 66 }, (_, i) => ({
    ...moves[1],
    id: `non-bingo-${i}`,
  }));
  const { user } = setup(true, {
    rackSize: 4,
    moves: [
      ...nonBingos,
      { ...moves[0], score: 9 },
      { ...moves[0], id: "d", col: 6, score: 8 },
    ],
  });
  const badge = screen.getByRole("img", { name: "2 bingos" });
  expect(badge.nextElementSibling?.textContent).toBe("68");
  expect(screen.queryByRole("button", { name: /^CATS,/ })).toBeNull();
  await user.type(screen.getByRole("textbox", { name: "Filter moves" }), "ZZZ");
  await screen.findByRole("heading", { name: "No matching words" });
  expect(screen.getByRole("img", { name: "2 bingos" })).toBe(badge);
});

test.each(PLAYER_PROFILES)("%s badges count all legal moves before and after ranking", async (playingStyle) => {
  const index = new MoveResultIndex(moves, { ...PRESETS[0], rackSize: 4 });
  let finishRanking: () => void;
  const ranked = new Promise<void>((resolve) => { finishRanking = resolve; });
  const fetchPage = vi.fn<FetchMovePage>(async (_id, query) => {
    await ranked;
    index.setProfile(query, [{
      move: moves[1],
      utility: {
        total: 10, points: 10, premium: 0, visibility: 1, appeal: 2, leave: 0, goingOut: 0,
      },
    }]);
    return index.page(query);
  });
  setup(false, { playingStyle, rackSize: 4, fetchPage });
  expect(screen.getByText("Loading move list…")).toBeTruthy();
  expect(screen.getByTitle("All legal moves").textContent).toBe("3");
  const badge = screen.getByRole("img", { name: "1 bingo" });
  expect(fetchPage).toHaveBeenCalledWith(0, expect.objectContaining({ profile: playingStyle }));

  await act(async () => finishRanking());
  expect(rows()).toHaveLength(1);
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^CAT,/);
  expect(screen.getByTitle("All legal moves").textContent).toBe("3");
  expect(screen.getByRole("img", { name: "1 bingo" })).toBe(badge);
});

test("a style still counts all legal moves covering the selected squares", async () => {
  const requiredSquares = { size: 15, indices: [115] };
  const index = new MoveResultIndex(moves, { ...PRESETS[0], rackSize: 4 });
  const fetchPage = vi.fn<FetchMovePage>(async (_id, query) => {
    if (query.profile) index.setProfile(query, []);
    return index.page(query);
  });
  const { user } = setup(true, { playingStyle: "casual", rackSize: 4, requiredSquares, fetchPage });
  await screen.findByRole("heading", { name: "No matching words" });
  const count = screen.getByTitle("Moves covering the selected squares");
  expect(count.textContent).toBe("1");
  expect(screen.getByRole("img", { name: "1 bingo" })).toBeTruthy();
  expect(fetchPage).toHaveBeenCalledWith(0, expect.objectContaining({
    profile: undefined, requiredSquares,
  }));

  await user.type(screen.getByRole("textbox", { name: "Filter moves" }), "ZZZ");
  await waitFor(() => expect(count.textContent).toBe("0"));
  expect(screen.queryByRole("img", { name: "1 bingo" })).toBeNull();
});

test("scrolling and filtering use worker pages and ignore out-of-order results", async () => {
  const longList = Array.from({ length: 200 }, (_, i) => ({
    ...moves[0],
    id: String(i),
    word: i === 199 ? "ZEBRA" : i === 190 ? "QUICK" : "CATS",
    score: 400 - i,
  }));
  const index = new MoveResultIndex(longList, PRESETS[0]);
  const pending: Array<() => void> = [];
  const fetchPage: FetchMovePage = (_id, query) =>
    new Promise((resolve) => pending.push(() => resolve(index.page(query))));
  setup(false, { moves: longList, fetchPage });
  expect(rows()).toHaveLength(30);
  const panel = screen.getByRole("region", { name: "Possible moves" });
  expect(rows().slice(0, 2).map(displayedRank)).toEqual(["1", "2"]);
  expect(panel.style.getPropertyValue("--result-rank-digits")).toBe("3");
  expect(pending).toHaveLength(0);
  const scroller = screen.getByLabelText("Suggested moves");
  fireEvent.click(screen.getByRole("button", { name: "Show all moves (100 more)" }));
  scroller.scrollTop = 200 * moveRowHeight;
  fireEvent.scroll(scroller);
  await waitFor(() => expect(pending).toHaveLength(1));
  await act(async () => pending[0]());
  expect(displayedRank(screen.getByRole("button", { name: /^ZEBRA,/ }))).toBe("200");

  const filter = screen.getByRole("textbox", { name: "Filter moves" });
  fireEvent.change(filter, { target: { value: "QUI" } });
  fireEvent.change(filter, { target: { value: "ZEB" } });
  await waitFor(() => expect(pending).toHaveLength(3));
  await act(async () => pending[2]());
  expect(rows()).toHaveLength(1);
  expect(displayedRank(screen.getByRole("button", { name: /^ZEBRA,/ }))).toBe("200");
  expect(panel.style.getPropertyValue("--result-rank-digits")).toBe("3");
  await act(async () => pending[1]());
  expect(rows()).toHaveLength(1);
  expect(screen.queryByRole("button", { name: /^QUICK,/ })).toBeNull();
});

test.each([
  { automatic: true, phone: false },
  { automatic: false, phone: false },
  { automatic: true, phone: true },
])("an on-demand histogram selects the move and follows changed ranks (automatic: $automatic, phone: $phone)", async ({ automatic, phone }) => {
  let worker: ReplyWorker | undefined;
  class ReplyWorker {
    onmessage?: (message: { data: unknown }) => void;
    terminate = vi.fn();
    request?: ReplyRequest;
    constructor() {
      worker = this;
    }
    postMessage(request: ReplyRequest) {
      this.request = request;
    }
  }
  vi.stubGlobal("Worker", ReplyWorker);
  const game: Game = {
    id: "test",
    name: "Test",
    profileId: "p",
    board: emptyBoard(15),
    rack: "CATS",
    template: PRESETS[0],
    dictionaryId: "test",
    past: [],
    future: [],
    revision: 0,
    updatedAt: "",
    archived: false,
  };
  const lower = 95;
  const longList = Array.from({ length: 200 }, (_, i) => ({
    ...moves[0],
    id: String(i),
    word: i === lower ? "ZEBRA" : "CATS",
    score: 400 - i,
  }));
  const index = new MoveResultIndex(longList, game.template);
  const pending: Array<{ offset: number; locateMoveId?: string; complete: () => void }> = [];
  const fetchPage: FetchMovePage = (_id, query) =>
    new Promise((resolve) => pending.push({
      offset: query.offset,
      locateMoveId: query.locateMoveId,
      complete: () => resolve(index.page(query)),
    }));
  const { user, onPlay, onPreview } = setup(phone, {
    moves: longList,
    analysisGame: game,
    fetchPage,
    defense: {
      [lower]: {
        depth: 1,
        opened: {
          square: 0,
          premium: "TW",
          after: { word: "QI", score: 33, tiles: [{ index: 0, letter: "Q" }] },
        },
      },
    },
  });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: !phone && query === "(any-hover: hover)",
  }));
  const summary = worker!.request!;
  const distribution: ReplyDistribution = {
    kind: "distribution",
    mean: 25,
    buckets: [0, 500, 0, 0, 0],
    difference: 0,
    outscored: 0,
    count: 500,
    exact: false,
    discordant: [0, 0, 0, 0, 0],
    reference: { mean: 25, buckets: [0, 500, 0, 0, 0] },
  };
  act(() => worker!.onmessage?.({
    data: {
      id: summary.id, kind: summary.kind, done: true,
      ...(automatic && { moveId: summary.reference.id, result: distribution }),
    },
  }));
  const scroller = screen.getByLabelText("Suggested moves");
  const followScroll = vi.fn();
  Object.defineProperties(scroller, {
    scrollTo: { value: followScroll },
    clientHeight: { value: 6 * moveRowHeight },
  });
  const scrollTop = (lower - 1) * moveRowHeight;
  scroller.scrollTop = scrollTop;
  fireEvent.scroll(scroller);
  await waitFor(() => expect(pending).toHaveLength(1));
  await act(async () => pending[0].complete());

  const chart = await screen.findByRole("button", { name: /^Check reply histogram for ZEBRA/ });
  const risk = screen.getByRole("button", { name: /^Reply risk for ZEBRA/ });
  expect(risk.parentElement).toBe(chart.parentElement);
  expect(risk.nextElementSibling).toBe(chart);
  expect(risk.dataset.risk).toBe("muted");
  expect(risk.querySelector(".result-defense-chance")?.textContent).toBe("7%");
  if (phone) await user.pointer({ keys: "[TouchA]", target: chart });
  else await user.click(chart);
  const selectedRow = () => screen.getByRole("button", { name: /^ZEBRA,/ });
  const replyDetails = () => screen.getByRole("region", { name: "Reply after ZEBRA" });
  expect(selectedRow().classList.contains("pinned")).toBe(true);
  expect(within(replyDetails()).getByRole("status").textContent).toBe("Checking reply histogram…");
  expect(onPreview).toHaveBeenLastCalledWith(null);
  expect(onPlay).not.toHaveBeenCalled();
  if (!phone) {
    await user.hover(screen.getAllByRole("button", { name: /^CATS,/ })[0]);
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(replyDetails()).toBeTruthy();
  }
  const manual = worker!.request!;
  expect(manual.kind).toBe("reply-histogram");
  act(() => worker!.onmessage?.({
    data: { id: manual.id, kind: manual.kind, result: distribution },
  }));
  expect(screen.getByLabelText("Suggested moves")).toBe(scroller);
  expect(scroller.scrollTop).toBe(scrollTop);
  expect(screen.queryByText("Loading move list…")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Reply risk for ZEBRA/ })).toBeNull();
  expect(replyDetails().querySelector(".reply-chart")).toBeTruthy();
  expect(followScroll).not.toHaveBeenCalled();
  if (!automatic) {
    expect(pending).toHaveLength(1);
    expect(selectedRow().querySelector(".reply-mini")).toBeTruthy();
    fireEvent.contextMenu(selectedRow());
    expect(selectedRow().classList.contains("pinned")).toBe(false);
    expect(selectedRow().classList.contains("active")).toBe(false);
    expect(screen.queryByRole("region", { name: "Reply after ZEBRA" })).toBeNull();
    expect(selectedRow().querySelector(".reply-mini")).toBeTruthy();
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(onPlay).not.toHaveBeenCalled();
    return;
  }
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(pending[1].offset).toBe(pending[0].offset);
  expect(pending[1].locateMoveId).toBe(String(lower));
  await act(async () => pending[1].complete());
  expect(screen.getByLabelText("Suggested moves")).toBe(scroller);
  expect(scroller.scrollTop).toBe(scrollTop);
  expect(followScroll).toHaveBeenCalledExactlyOnceWith({ top: 0, behavior: "smooth" });

  scroller.scrollTop = 0;
  fireEvent.scroll(scroller);
  await waitFor(() => expect(pending).toHaveLength(3));
  await act(async () => pending[2].complete());
  expect(selectedRow().querySelector(".reply-mini")).toBeTruthy();
  expect(selectedRow().classList.contains("pinned")).toBe(true);
  expect(replyDetails().querySelector(".reply-chart")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Reply risk for ZEBRA/ })).toBeNull();
  if (phone) {
    await user.pointer({ keys: "[TouchA]", target: selectedRow() });
    expect(onPlay).not.toHaveBeenCalled();
    expect(onPreview).toHaveBeenLastCalledWith(longList[lower]);
    await user.pointer({ keys: "[TouchA]", target: selectedRow() });
    expect(onPlay).toHaveBeenCalledExactlyOnceWith(longList[lower]);
  } else {
    await user.hover(screen.getAllByRole("button", { name: /^CATS,/ })[0]);
    expect(replyDetails().querySelector(".reply-chart")).toBeTruthy();
    await user.click(screen.getByRole("heading", { name: "Possible moves" }));
    expect(selectedRow().classList.contains("pinned")).toBe(false);
    expect(screen.queryByRole("region", { name: "Reply after ZEBRA" })).toBeNull();
  }
});

test("reply risk badges distinguish rare, likely low-impact, and likely costly replies", () => {
  const game: Game = {
    id: "risk-game",
    name: "Test",
    profileId: "p",
    board: emptyBoard(15),
    rack: "CATS",
    template: PRESETS[0],
    dictionaryId: "test",
    past: [],
    future: [],
    revision: 0,
    updatedAt: "",
    archived: false,
  };
  function opens(word: string, letter: string, score: number): MoveDefense {
    return {
      depth: 1,
      opened: {
        square: 0,
        premium: "TW",
        after: { word, score, tiles: [{ index: 0, letter }] },
      },
    };
  }
  setup(false, {
    analysisGame: game,
    replyEnabled: false,
    defense: {
      a: opens("QI", "Q", 60),
      b: opens("ET", "E", 27),
      c: opens("ET", "E", 50),
    },
  });
  const badges = screen.getAllByRole("button", { name: /^Reply risk for/ });
  expect(badges.map((badge) => badge.dataset.risk)).toEqual(["muted", "caution", "high"]);
  expect(badges[0].getAttribute("aria-label")).toContain("7.3% chance");
  expect(badges[1].querySelector(".result-defense-chance")?.textContent)
    .toBe(badges[2].querySelector(".result-defense-chance")?.textContent);
});

test("reply rows resolve individually and compare against the highest score after sorting", async () => {
  let worker: ReplyWorker | undefined;
  class ReplyWorker {
    onmessage?: (message: { data: unknown }) => void;
    terminate = vi.fn();
    request?: ReplyRequest;
    constructor() {
      worker = this;
    }
    postMessage(request: ReplyRequest) {
      this.request = request;
    }
  }
  vi.stubGlobal("Worker", ReplyWorker);
  const game: Game = {
    id: "test",
    name: "Test",
    profileId: "p",
    board: emptyBoard(15),
    rack: "CATS",
    template: PRESETS[0],
    dictionaryId: "test",
    past: [],
    future: [],
    revision: 0,
    updatedAt: "",
    archived: false,
  };
  const { user, onPlay } = setup(false, {
    analysisGame: game,
    compact: true,
    replyEnabled: true,
  });
  const request = worker!.request!;
  expect(request.reference.id).toBe("a");
  expect(
    screen.getAllByRole("img", { name: /^Checking replies after/ }),
  ).toHaveLength(3);
  const reply: ReplyDistribution = {
    kind: "distribution",
    mean: 31,
    buckets: [5, 200, 240, 25, 30],
    difference: -4,
    outscored: 420,
    count: 500,
    exact: false,
    discordant: [0, 130, 115, 45, 60],
    reference: { mean: 35, buckets: [5, 120, 240, 65, 70] },
    heatmap: {
      squares: [
        {
          square: 0,
          count: 30,
          examples: [
            {
              count: 30,
              play: {
                word: "ZA",
                score: 45,
                tiles: [{ index: 0, letter: "Z" }],
              },
            },
          ],
        },
      ],
      reference: [{ square: 1, count: 80 }],
    },
  };
  const pendingRow = screen.getByRole("button", { name: /^CAT,/ });
  await user.hover(pendingRow);
  expect(screen.queryByRole("region", { name: "Reply after CAT" })).toBeNull();
  act(() =>
    worker!.onmessage?.({
      data: {
        kind: "reply-summary",
        id: request.id,
        moveId: "b",
        result: { ...reply, heatmap: undefined },
      },
    }),
  );
  expect(
    screen.getAllByRole("img", { name: /^Checking replies after/ }),
  ).toHaveLength(2);
  await user.unhover(pendingRow);
  expect(screen.getByRole("region", { name: "Reply after CAT" })).toBeTruthy();
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^CATS,/);
  expect(within(pendingRow).getByText("Adj. 14")).toBeTruthy();

  act(() => {
    worker!.onmessage?.({
      data: {
        kind: "reply-summary", id: request.id, moveId: "a",
        result: { ...reply, difference: 0 },
      },
    });
    worker!.onmessage?.({
      data: {
        kind: "reply-summary", id: request.id, moveId: "c",
        result: { ...reply, difference: -20.4 },
      },
    });
  });
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^CATS,/);
  act(() => {
    worker!.onmessage?.({
      data: { kind: "reply-summary", id: request.id, done: true },
    });
  });
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^AT,/);
  expect(within(rows()[0]).getByText("Adj. 24.4")).toBeTruthy();
  expect(rows().map(displayedRank)).toEqual(["3", "1", "2"]);

  const pointsMenu = () => screen.getByLabelText("Sort by points or reply-adjusted points");
  expect(pointsMenu().textContent).toBe("ADJ. PTS");
  const chevron = () => pointsMenu().querySelector("svg");
  expect(chevron()?.classList.contains("lucide-chevron-down")).toBe(true);
  const details = () => pointsMenu().closest("details")!;
  async function pickWithoutButtonFocus(label: string) {
    await user.click(pointsMenu());
    act(() => pointsMenu().focus());
    expect(document.activeElement).toBe(pointsMenu());
    const option = screen.getByRole("button", { name: label });
    const menu = details();
    fireEvent.pointerDown(option);
    act(() => pointsMenu().blur());
    expect(menu.open).toBe(true);
    fireEvent.click(option);
    expect(menu.open).toBe(false);
  }
  await pickWithoutButtonFocus("Sort by points");
  expect(pointsMenu().textContent).toBe("PTS");
  expect(chevron()?.classList.contains("lucide-chevron-down")).toBe(true);
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^CATS,/);
  await pickWithoutButtonFocus("Sort by points");
  await waitFor(() => expect(rows()[0]?.getAttribute("aria-label")).toMatch(/^AT,/));
  expect(chevron()?.classList.contains("lucide-chevron-up")).toBe(true);
  expect(pointsMenu().getAttribute("aria-description")).toBe("Sorted ascending");

  await pickWithoutButtonFocus("Sort by reply-adjusted points");
  expect(pointsMenu().textContent).toBe("ADJ. PTS");
  expect(chevron()?.classList.contains("lucide-chevron-down")).toBe(true);
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^AT,/);
  await pickWithoutButtonFocus("Sort by reply-adjusted points");
  expect(chevron()?.classList.contains("lucide-chevron-up")).toBe(true);
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^CAT,/);

  await user.click(pointsMenu());
  fireEvent.pointerDown(document.body);
  expect(details().open).toBe(false);
  await user.click(pointsMenu());
  const keyboardOption = screen.getByRole("button", { name: "Sort by points" });
  act(() => keyboardOption.focus());
  await user.keyboard("{Escape}");
  expect(details().open).toBe(false);
  expect(document.activeElement).toBe(pointsMenu());

  await selectWordSort(user, "word");
  const row = rows().find((element) =>
    element.getAttribute("aria-label")?.startsWith("CAT,"),
  )!;
  expect(row.querySelector(".result-score-delta")?.textContent).toBe("−10");
  const mini = row.querySelector(".reply-mini")!;
  const enter = new MouseEvent("pointerover", { bubbles: true });
  Object.defineProperty(enter, "pointerType", { value: "mouse" });
  fireEvent(mini, enter);
  expect(screen.queryByRole("dialog")).toBeNull();
  const inline = screen.getByRole("region", { name: "Reply after CAT" });
  const mean = within(inline).getByText("31.0");
  expect(mean.parentElement?.textContent).toBe("35.0 → 31.0 pts");
  expect(mean.classList.contains("value-good")).toBe(true);
  const highReply = within(inline).getByText("11.0%");
  expect(highReply.parentElement?.textContent).toBe("27.0% → 11.0%");
  expect(highReply.classList.contains("value-good")).toBe(true);
  expect(within(inline).getByText("84.0%").parentElement?.textContent).toBe("Chance they outscore this play 84.0%");
  await user.click(screen.getByRole("button", { name: /^Score breakdown for CAT at/ }));
  const scoreBreakdown = screen.getByRole("tooltip");
  expect(within(scoreBreakdown).getByText("10 pts − (−4.0 Δ Reply) = 14 reply-adjusted pts")).toBeTruthy();
  await user.keyboard("{Escape}");
  expect(within(inline).getByText("Reference · After CATS")).toBeTruthy();
  expect(worker!.request?.kind).toBe("reply-summary");
  await user.click(within(inline).getByRole("button", { name: "Heatmap" }));
  const dialog = screen.getByRole("dialog");
  const heatmapRequest = worker!.request!;
  expect(heatmapRequest).toMatchObject({
    kind: "reply-detail",
    candidate: { id: "b" },
    reference: { id: "a" },
    samples: 500,
    captureHeatmap: true,
  });
  expect(within(dialog).getByRole("status").textContent).toContain(
    "Checking heatmap",
  );
  act(() =>
    worker!.onmessage?.({
      data: { kind: "reply-detail", id: heatmapRequest.id, result: reply },
    }),
  );
  await user.click(within(dialog).getByRole("button", { name: /ZA.*45 pts/ }));
  expect(
    dialog.querySelector('.board-grid[data-preview-player="opponent"] [data-cell="0"].ghost'),
  ).toBeTruthy();
  await user.click(
    within(dialog).getByRole("button", { name: "Change vs. CATS" }),
  );
  await user.click(within(dialog).getByRole("button", { name: /^B1$/ }));
  const hotspot = within(dialog).getByText("0%");
  expect(hotspot.parentElement?.textContent).toBe("16% → 0% of checked racks");
  expect(hotspot.classList.contains("value-good")).toBe(true);
  await user.click(
    within(dialog).getByRole("button", { name: "Close dialog" }),
  );
  await user.click(
    within(inline).getByRole("button", { name: "Refine to 5,000 racks" }),
  );
  const refinement = worker!.request!;
  expect(refinement).toMatchObject({
    kind: "reply-detail",
    reference: { id: "a" },
    samples: 5_000,
    captureHeatmap: true,
  });
  const refining = (count: number) =>
    within(inline).getByRole("button", { name: `Refining replies… ${count}/5000` });
  expect(refining(0)).toHaveProperty("disabled", true);
  act(() => worker!.onmessage?.({
    data: { kind: "reply-detail", id: refinement.id, racksChecked: 124 },
  }));
  expect(refining(124)).toBeTruthy();
  act(() => worker!.onmessage?.({
    data: { kind: "reply-detail", id: heatmapRequest.id, racksChecked: 200 },
  }));
  expect(refining(124)).toBeTruthy();
  act(() => worker!.onmessage?.({
    data: { kind: "reply-detail", id: refinement.id, racksChecked: 3_650 },
  }));
  expect(refining(3650)).toBeTruthy();
  expect(within(inline).getByText("31.0").parentElement?.textContent).toBe("35.0 → 31.0 pts");
  act(() => worker!.onmessage?.({
    data: {
      kind: "reply-detail",
      id: refinement.id,
      result: {
        ...reply,
        count: 5_000,
        buckets: reply.buckets.map((count) => count * 10),
        outscored: reply.outscored * 10,
        discordant: reply.discordant.map((count) => count * 10),
        reference: { ...reply.reference, buckets: reply.reference.buckets.map((count) => count * 10) },
      },
    },
  }));
  expect(within(inline).queryByRole("button", { name: /Refining replies/ })).toBeNull();
  expect(within(inline).getByText("5,000 sampled racks")).toBeTruthy();
  expect(onPlay).not.toHaveBeenCalled();
  await user.click(mini);
  expect(onPlay).toHaveBeenCalledExactlyOnceWith(moves[1]);
});

const endgame: Game = {
  id: "endgame",
  name: "Endgame",
  profileId: "p",
  board: emptyBoard(15),
  rack: "CATS",
  template: {
    ...PRESETS[0],
    tileCounts: Object.fromEntries(
      TILE_SYMBOLS.map((letter) => [letter, Number("CATSZ".includes(letter))]),
    ),
  },
  dictionaryId: "test",
  past: [],
  future: [],
  revision: 0,
  updatedAt: "",
  archived: false,
};

test.each(["scrabble", "crossplay"] as const)(
  "%s shows a zero-point rack adjustment only when its rules transfer rack points",
  (rules) => {
    const move = { ...moves[0], leave: "" };
    render(<OptimalReplyDetails
      game={{ ...endgame, template: { ...endgame.template, rules } }}
      opponentRack="?"
      line={{ line: [move], points: { you: move.score, opponent: 0 }, spread: move.score }}
    />);
    const adjustment = screen.queryByText("Rack adjustment");
    if (rules === "scrabble")
      expect(adjustment?.closest("tr")?.classList.contains("optimal-reply-adjustment-row")).toBe(true);
    else expect(adjustment).toBeNull();
  },
);

test("empty-bag replies start automatically and can be overridden", async () => {
  const requests: ReplyRequest[] = [];
  const terminate = vi.fn();
  vi.stubGlobal(
    "Worker",
    class {
      terminate = terminate;
      postMessage(request: ReplyRequest) {
        requests.push(request);
      }
    },
  );
  const { user } = setup(false, { analysisGame: endgame, replyEnabled: true });
  expect(requests.map(({ bagSize }) => bagSize)).toEqual([0]);
  expect(screen.getByRole("heading", { name: "Possible moves - Endgame" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Bag is empty" })).toBeNull();
  await user.click(screen.getByText("Reply settings"));
  await user.type(
    screen.getByRole("spinbutton", { name: "Tiles in bag" }),
    "1",
  );
  await user.click(
    screen.getByRole("button", { name: "Update reply analysis" }),
  );
  expect(requests.map(({ bagSize }) => bagSize)).toEqual([0, 1]);
  expect(terminate).toHaveBeenCalledOnce();
  expect(screen.getByRole("heading", { name: "Possible moves" })).toBeTruthy();
});

test("reply details color the lead, reply and final result from your side", async () => {
  let worker: ReplyWorker | undefined;
  class ReplyWorker {
    request?: ReplyRequest;
    onmessage?: (message: { data: unknown }) => void;
    terminate() {}
    postMessage(request: ReplyRequest) {
      worker = this;
      this.request = request;
    }
  }
  vi.stubGlobal("Worker", ReplyWorker);
  const { user } = setup(true, {
    analysisGame: {
      ...endgame,
      trackScores: true,
      scoring: {
        you: { points: 120, moves: 1, best: 120, bingos: 0 },
        opponent: { points: 100, moves: 1, best: 100, bingos: 0 },
      },
    },
  });
  act(() =>
    worker!.onmessage?.({
      data: {
        kind: "reply-summary",
        id: worker!.request!.id,
        moveId: "a",
        result: {
          kind: "empty-bag",
          rack: "Z",
          highest: null,
          reply: {
            ...moves[2],
            id: "za",
            word: "ZA",
            score: 45,
            tiles: [{ index: 111, letter: "Z" }],
          },
          ends: "opponent",
          yourAdjustment: -5,
          opponentAdjustment: 5,
          difference: 12,
        },
      },
    }),
  );
  await user.click(rows()[0]);
  const details = within(screen.getByRole("region", { name: "Reply after CATS" }));
  expect(details.getByText("140–100").classList.contains("value-good")).toBe(true);
  for (const text of ["45 pts", "+12 pts", "−5", "+5", "135–150"]) {
    expect(details.getByText(text).classList.contains("value-bad")).toBe(true);
  }
});

test("a completed reply line replaces the immediate warning and replays each turn", async () => {
  const requests: ReplyRequest[] = [];
  let worker: ReplyWorker | undefined;
  class ReplyWorker {
    onmessage?: (message: { data: unknown }) => void;
    terminate() {}
    postMessage(request: ReplyRequest) {
      worker = this;
      requests.push(request);
    }
  }
  vi.stubGlobal("Worker", ReplyWorker);
  const { user } = setup(true, {
    analysisGame: {
      ...endgame,
      rack: "CATT?",
      template: {
        ...endgame.template,
        tileCounts: { ...endgame.template.tileCounts, S: 0, T: 4, "?": 2 },
      },
      trackScores: true,
      scoring: {
        you: { points: 100, moves: 1, best: 100, bingos: 0 },
        opponent: { points: 116, moves: 1, best: 116, bingos: 0 },
      },
    },
  });
  const reply = {
    ...moves[2],
    id: "za",
    word: "ZA",
    score: 25,
    row: 6,
    direction: "down",
    tiles: [{ index: 97, letter: "Z" }],
    leave: "TT?",
  };
  const finish = {
    ...moves[2],
    id: "ta",
    word: "TA",
    score: 21,
    col: 6,
    tiles: [{ index: 111, letter: "T" }],
    leave: "",
  };
  act(() =>
    worker!.onmessage?.({
      data: {
        kind: "reply-summary",
        id: requests[0].id,
        moveId: "a",
        result: {
          kind: "empty-bag",
          rack: "TTZ?",
          highest: reply,
          reply,
          ends: null,
          yourAdjustment: 0,
          opponentAdjustment: 0,
          difference: 0,
        },
      },
    }),
  );
  await user.click(rows()[0]);
  const details = within(screen.getByRole("region", { name: "Reply after CATS" }));
  expect(details.getByText("They can take the lead by 21")).toBeTruthy();
  expect(screen.queryByText(/\b(?:ply|plies)\b/)).toBeNull();
  await user.click(details.getByRole("button", { name: "Calculate optimal endgame line" }));
  expect(requests.at(-1)?.kind).toBe("reply-line");
  act(() =>
    worker!.onmessage?.({
      data: {
        kind: "reply-line",
        id: requests.at(-1)!.id,
        line: {
          spread: 20,
          points: { you: 43, opponent: 23 },
          line: [{ ...moves[0], leave: "T" }, reply, null, null, finish],
        },
      },
    }),
  );
  expect(details.queryByText(/They can take the lead|Strongest immediate reply/)).toBeNull();
  expect((await screen.findByText("5 plies (3)")).getAttribute("title")).toBe(
    "5 plies · 3 plays · 2 passes",
  );
  expect(details.getByText("5 plies · 3 plays · 2 passes")).toBeTruthy();
  expect(details.getByText("Optimal final score")).toBeTruthy();
  const final = details.getByText("Optimal final score").parentElement!;
  expect(final.querySelector("strong")?.textContent).toBe("143–139");
  expect(final.querySelector("small.value-good")?.textContent).toBe("+4");
  expect(final.textContent).not.toMatch(/You|Opponent|Win by|Lose by/);
  const openingTurn = details.getByRole("button", { name: /^CATS You/ });
  const playerLeave = within(openingTurn.closest("tr")!).getByRole("img", { name: "Leave: T" });
  expect(playerLeave.textContent).toBe("T");
  expect(playerLeave.querySelector(".mini-tiles.opponent")).toBeNull();
  expect(openingTurn.querySelector(".result-letter.played:not(.assigned-blank)")?.textContent).toBe("C");
  expect(openingTurn.querySelector(".result-letter.assigned-blank")?.textContent).toBe("S");
  const replyTurn = details.getByRole("button", { name: /^ZA Opponent/ });
  const replyScore = replyTurn.closest("tr")!.querySelector(".optimal-reply-step-score")!;
  expect(replyScore.querySelector("strong")?.textContent).toBe("120–141");
  expect(replyScore.querySelector("small.value-bad")?.textContent).toBe("−21");
  expect(replyTurn.querySelector(".result-letter.played")?.textContent).toBe("Z");
  expect(replyTurn.querySelector(".result-letter.existing")?.textContent).toBe("A");
  expect(details.queryByRole("button", { pressed: true })).toBeNull();
  expect(details.getByText("Current board")).toBeTruthy();
  await user.click(replyTurn);
  expect(replyTurn.getAttribute("aria-pressed")).toBe("true");
  const leave = within(replyTurn.closest("tr")!).getByRole("img", { name: "Leave: T, T, blank" });
  const tiles = [...leave.querySelectorAll(".mini-tiles.opponent > span")];
  expect(tiles.map((tile) => tile.textContent)).toEqual(["T", "T", ""]);
  expect(tiles[2].classList.contains("blank")).toBe(true);
  expect(details.getByRole("button", { name: /^H7: Z/ }).classList.contains("ghost")).toBe(true);
  expect(details.getByRole("button", { name: /^H7: Z/ })
    .closest('.board-grid[data-preview-player="opponent"]')).toBeTruthy();

  const pass = details.getByRole("button", { name: /^Pass You/ });
  expect(within(pass.closest("tr")!).getByRole("img", { name: "Leave: T" })).toBeTruthy();
  const opponentPass = details.getByRole("button", { name: /^Pass Opponent/ });
  expect(within(opponentPass.closest("tr")!).getByRole("img", { name: "Leave: T, T, blank" })).toBeTruthy();
  await user.click(pass);
  expect(details.getByText("Board after your pass")).toBeTruthy();
  expect(details.getByRole("button", { name: /^H7: Z/ }).classList.contains("ghost")).toBe(false);
  const lastPlay = details.getByRole("button", { name: /^TA You/ });
  expect(within(lastPlay.closest("tr")!).getByRole("img", { name: "Goes out" }).textContent).toBe("(Goes out)");
  expect(lastPlay.closest("tr")!.querySelector(".optimal-reply-step-score small")?.textContent).toBe("0");
  await user.click(lastPlay);
  expect(details.getByText("Board after TA")).toBeTruthy();
  expect(details.getByRole("button", { name: /^G8: T/ }).classList.contains("ghost")).toBe(true);
  expect(details.getByRole("button", { name: /^G8: T/ })
    .closest('.board-grid[data-preview-player="you"]')).toBeTruthy();
  const adjustment = details.getByRole("button", { name: "Final score" });
  expect(adjustment.closest("tr")?.classList.contains("optimal-reply-adjustment-row")).toBe(true);
  expect(within(adjustment).queryByRole("img")).toBeNull();
  await user.click(adjustment);
  expect(details.getByText("Final board")).toBeTruthy();
  expect(adjustment.closest("tr")!.querySelector(".optimal-reply-step-score strong")?.textContent).toBe("143–139");
  expect(adjustment.closest("tr")!.querySelector(".optimal-reply-step-score .value-good")?.textContent).toBe("+4");

  await user.click(rows()[1]);
  await user.click(rows()[0]);
  expect(screen.getByText("Optimal final score")).toBeTruthy();
  expect(requests.filter(({ kind }) => kind === "reply-line")).toHaveLength(1);
});

test("empty-bag rows wait for estimates unless the user skips to points", async () => {
  vi.stubGlobal(
    "Worker",
    class {
      terminate() {}
      postMessage() {}
    },
  );
  const pending: { signal: AbortSignal; publish: () => void }[] = [];
  const { user, rerun } = setup(false, {
    analysisGame: endgame,
    rankEndgame: (index) => (_search, _game, _turns, signal) =>
      new Promise((resolve) =>
        pending.push({
          signal,
          publish: () =>
            resolve(
              index.setEndgame(
                pending.length,
                new Map([
                  [
                    "a",
                    {
                      spread: -41,
                      exact: false,
                      reply: { word: "QI", score: 40, goesOut: true },
                    },
                  ],
                  ["b", { spread: 5, exact: true }],
                ]),
              ),
            ),
        }),
      ),
  });
  const skip = () =>
    screen.getByRole("button", { name: "Skip endgame analysis" });
  expect(screen.getByText("Estimating endgames…")).toBeTruthy();
  expect(screen.queryAllByRole("button", { name: /points,/ })).toHaveLength(0);
  await act(async () => pending[0].publish());
  const swing = await screen.findByRole("button", {
    name: "Sort by estimated endgame swing",
  });
  expect(swing.getAttribute("aria-pressed")).toBe("true");
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^CAT,/);
  expect(screen.getByText("QI out")).toBeTruthy();
  const winningSwing = screen.getByTitle("Exact endgame swing +5");
  expect(screen.queryByText(/^Adj\./)).toBeNull();
  expect(winningSwing.querySelector(".value-good")?.textContent).toBe("+5");
  const losingSwing = screen.getByTitle(/^Estimated endgame swing −41/);
  expect(losingSwing.querySelector("strong.value-bad")?.textContent).toBe(
    "≈−41",
  );
  expect(screen.getByText("Estimated 2 of 3 moves")).toBeTruthy();
  rerun();
  expect(screen.queryAllByRole("button", { name: /points,/ })).toHaveLength(0);
  await user.click(skip());
  expect(pending[1].signal.aborted).toBe(true);
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^CATS,/);
  await act(async () => pending[1].publish());
  expect(
    screen.queryByRole("button", { name: "Sort by estimated endgame swing" }),
  ).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Sort by points" })
      .getAttribute("aria-pressed"),
  ).toBe("true");

  rerun();
  expect(skip()).toBeTruthy();
  await act(async () => pending[2].publish());
  expect(
    (
      await screen.findByRole("button", {
        name: "Sort by estimated endgame swing",
      })
    ).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^CAT,/);
});

test("endgame rows rank exact swings first and mark the boundary as more lines finish", async () => {
  let background: EndgameWorker | undefined;
  class EndgameWorker {
    id = 0;
    onmessage?: (event: { data: EndgamePrecomputeMessage }) => void;
    terminate() {}
    postMessage(request: ReplyRequest | EndgamePrecomputeRequest) {
      if (request.kind === "precompute-endgames") {
        background = this;
        this.id = request.id;
      }
    }
  }
  vi.stubGlobal("Worker", EndgameWorker);
  const onBoardOdds = vi.fn();
  let index: MoveResultIndex;
  let publishUpdatedPage: (() => void) | undefined;
  const { user } = setup(false, {
    analysisGame: {
      ...endgame,
      trackScores: true,
      scoring: {
        you: { points: 105, moves: 4, best: 25, bingos: 0 },
        opponent: { points: 100, moves: 4, best: 25, bingos: 0 },
      },
    },
    rackOdds: { byLeave: { Z: 0 }, exact: true, bagSize: 0 },
    boardOdds: {
      byMove: { a: { chance: 0, exact: true } },
      checked: 1,
      total: 1,
      bagSize: 0,
    },
    onBoardOdds,
    rankEndgame: (resultIndex) => {
      index = resultIndex;
      return async () =>
        index.setEndgame(1, new Map([
          ["a", { spread: -41, exact: false }],
          ["b", { spread: 5, exact: true }],
          ["c", { spread: 12, exact: false }],
        ]));
    },
    fetchPage: async (_id, query) => {
      if (query.exactEndgameSpreads && !query.reversed)
        return new Promise((resolve) => {
          publishUpdatedPage = () => resolve(index.page(query));
        });
      return index.page(query);
    },
  });
  await screen.findByText("Win by 10");
  const results = rows();
  const divider = () => screen.getByRole("separator", { name: "End of exact swings" });
  expect(divider().parentElement).toBe(results[1].parentElement);
  for (const [row, outcome, tone] of [
    [results[0], "Win by 10", "value-good"],
    [results[1], "Win by 17", "value-good"],
    [results[2], "Lose by 36", "value-bad"],
  ] as const) {
    expect(row.querySelector(".endgame-estimate small")?.textContent).toBe(outcome);
    expect(row.querySelector(".endgame-estimate small")?.classList.contains(tone)).toBe(true);
    expect(row.getAttribute("aria-label")).not.toMatch(/bingo draw|bingo after/);
    expect(row.querySelector(".result-leave")?.textContent).toBe(row === results[2] ? "Z" : "AS");
  }
  expect(screen.getByRole("button", { name: "Sort by rack leave" })).toBeTruthy();
  expect(screen.queryByLabelText("Sort by leave or bingo odds")).toBeNull();

  act(() => {
    background!.onmessage!({
      data: {
        id: background!.id,
        moveId: "a",
        elapsed: 5,
        line: { spread: 10, points: { you: 20, opponent: 10 }, line: [moves[0]] },
      },
    });
    background!.onmessage!({ data: { id: background!.id, moveId: "c", limit: "Time limit reached.", elapsed: 10 } });
  });
  expect(rows()).toEqual(results);
  await act(async () => publishUpdatedPage!());
  expect(rows()).toEqual([results[2], results[0], results[1]]);
  expect(divider().parentElement?.previousElementSibling).toBe(results[0].parentElement);
  const updated = within(results[2]).getByTitle("Exact endgame swing +10");
  expect(updated.querySelector("strong")?.textContent).toBe("+10");
  expect(within(updated).getByText("1 ply")).toBeTruthy();
  expect(within(results[1]).queryByText(/\b(?:ply|plies)\b/)).toBeNull();
  expect(within(updated).getByText("Win by 15").classList.contains("value-good")).toBe(true);
  expect(within(results[1]).getByTitle("Estimated endgame swing +12").querySelector("strong")?.textContent).toBe("≈+12");
  const words = () => rows().map((row) => row.getAttribute("aria-label")?.split(",")[0]);
  await user.click(screen.getByRole("button", { name: "Sort by estimated endgame swing" }));
  await waitFor(() => expect(words()).toEqual(["CAT", "CATS", "AT"]));
  expect(divider().parentElement?.previousElementSibling).toBe(rows()[1].parentElement);

  await user.click(screen.getByText("Options"));
  expect(screen.getByText("Reply settings")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Check bingo after your play" })).toBeNull();
  expect(onBoardOdds).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Sort by points" }));
  await waitFor(() => expect(words()).toEqual(["CATS", "CAT", "AT"]));
  expect(screen.queryByRole("separator", { name: "End of exact swings" })).toBeNull();
});

test("rack odds sort every move and board odds rank checked moves separately", async () => {
  const { user } = setup(true, {
    analysisGame: bingoCheckGame,
    replyEnabled: false,
    rackOdds: { byLeave: { Z: 0.05, AS: 0.6 }, exact: true, bagSize: 89 },
    boardOdds: {
      byMove: {
        a: { chance: 0.8, exact: false },
        c: { chance: 0, exact: true },
      },
      checked: 2,
      total: 2,
      bagSize: 89,
    },
  });
  expect(rows()[0].getAttribute("aria-label")).toContain(
    "bingo draw 5%, bingo after your play ≈80%",
  );
  const chooseLeaveSort = async (name: string) => {
    await user.click(screen.getByLabelText("Sort by leave or bingo odds"));
    await user.click(screen.getByRole("button", { name }));
  };
  await chooseLeaveSort("Sort by bingo draw odds");
  expect(
    rows().map((row) => row.getAttribute("aria-label")?.split(",")[0]),
  ).toEqual(["CAT", "AT", "CATS"]);
  await chooseLeaveSort("Sort by bingo odds after play");
  expect(
    rows().map((row) => row.getAttribute("aria-label")?.split(",")[0]),
  ).toEqual(["CATS", "AT", "CAT"]);
  await chooseLeaveSort("Sort by bingo odds after play");
  expect(
    rows().map((row) => row.getAttribute("aria-label")?.split(",")[0]),
  ).toEqual(["AT", "CATS", "CAT"]);
});
test("column headings sort moves and filters preserve the original results", async () => {
  const { user } = setup();
  expect(screen.queryByRole("combobox", { name: "Sort moves" })).toBeNull();
  await selectWordSort(user, "word");
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^AT,/);
  await selectWordSort(user, "word");
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^CATS,/);
  await user.click(screen.getByRole("button", { name: "Sort by points" }));
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^CATS,/);
  await user.click(screen.getByRole("button", { name: "Sort by points" }));
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^AT,/);
  await user.click(screen.getByRole("button", { name: "Sort by points" }));
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^CATS,/);
  await user.click(screen.getByRole("button", { name: "Sort by rack leave" }));
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^CAT,/);
  await user.type(
    screen.getByRole("textbox", { name: "Filter moves" }),
    "CATS",
  );
  expect(rows()).toHaveLength(1);
  await user.clear(screen.getByRole("textbox", { name: "Filter moves" }));
  expect(rows()).toHaveLength(3);
});

test.each([false, true])("word length counts board letters and breaks ties by score (phone=%s)", async (phone) => {
  const { user } = setup(phone, {
    moves: [
      moves[0],
      { ...moves[1], word: "HEATS", col: 6, tiles: [{ index: 111, letter: "H" }] },
      { ...moves[2], word: "SEATS", col: 6, tiles: [{ index: 111, letter: "S" }] },
    ],
  });
  const order = () => rows().map((row) => row.getAttribute("aria-label")?.split(",")[0]);
  const heading = () => screen.getByLabelText("Sort by word or length");

  expect(order()).toEqual(["CATS", "HEATS", "SEATS"]);
  await selectWordSort(user, "word length");
  expect(order()).toEqual(["HEATS", "SEATS", "CATS"]);
  expect(heading().textContent).toBe("LENGTH");
  expect(heading().getAttribute("aria-description")).toBe("Sorted descending");

  await selectWordSort(user, "word length");
  expect(order()).toEqual(["CATS", "HEATS", "SEATS"]);
  expect(heading().getAttribute("aria-description")).toBe("Sorted ascending");
});

test.each(["wide", "narrow"])(
  "%s layouts preview on mouse hover and play on one click",
  async (layout) => {
    const { user, onPlay, onPreview } = setup(layout === "narrow", {
      hover: true,
    });
    const first = rows()[0];
    await user.hover(first);
    expect(onPreview).toHaveBeenLastCalledWith(moves[0]);
    expect(onPlay).not.toHaveBeenCalled();
    await user.unhover(first);
    expect(onPreview).toHaveBeenLastCalledWith(null);
    await user.click(first);
    expect(onPlay).toHaveBeenCalledExactlyOnceWith(moves[0]);
  },
);

test.each(["right-click", "P"])("%s toggles a move pin", async (input) => {
  const { user, onPlay, onPreview } = setup();
  const [first, second] = rows();
  const toggle = () =>
    input === "P"
      ? fireEvent.keyDown(first, { key: "p" })
      : fireEvent.contextMenu(first);

  await user.hover(first);
  expect(first.classList.contains("pinned")).toBe(false);
  toggle();
  expect(first.classList.contains("pinned")).toBe(true);
  await user.hover(second);
  expect(onPreview).toHaveBeenLastCalledWith(moves[0]);

  await user.hover(first);
  toggle();
  expect(first.classList.contains("pinned")).toBe(false);
  expect(first.classList.contains("active")).toBe(true);
  await user.hover(second);
  expect(onPreview).toHaveBeenLastCalledWith(moves[1]);
  await user.unhover(second);
  expect(onPreview).toHaveBeenLastCalledWith(null);
  expect(onPlay).not.toHaveBeenCalled();
});

test("the definition lookup starts after half a second over the letters and follows the word anchor", async () => {
  const fetchDefinition = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    available: true,
    entries: [[{ spelling: "cats", headword: "cat", partOfSpeech: "noun", glosses: ["Domestic felines."] }]],
  })));
  vi.stubGlobal("fetch", fetchDefinition);
  const { onPreview, onPlay } = setup();
  const [row] = rows();
  const letters = row.querySelector(".result-letters")!;
  vi.spyOn(letters, "getBoundingClientRect").mockReturnValue(new DOMRect(95, 140, 44, 18));
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue(new DOMRect(50, 125, 300, 50));
  function point(target: Element, type: string, pointerType = "mouse") {
    const event = new MouseEvent(type, { bubbles: true, buttons: 0 });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    fireEvent(target, event);
  }
  vi.useFakeTimers();
  try {
    point(row, "pointerover");
    act(() => vi.advanceTimersByTime(500));
    expect(onPreview).toHaveBeenLastCalledWith(moves[0]);
    expect(fetchDefinition).not.toHaveBeenCalled();
    point(letters, "pointerover", "touch");
    act(() => vi.advanceTimersByTime(500));
    expect(fetchDefinition).not.toHaveBeenCalled();
    point(letters, "pointerover");
    act(() => vi.advanceTimersByTime(499));
    expect(fetchDefinition).not.toHaveBeenCalled();
    point(letters, "pointerout");
    act(() => vi.advanceTimersByTime(500));
    expect(fetchDefinition).not.toHaveBeenCalled();
    point(letters, "pointerover");
    await act(() => vi.advanceTimersByTimeAsync(500));
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("Domestic felines.");
    expect(tip.style.left).toBe("147px");
    expect(row.getAttribute("aria-describedby")).toBe(tip.id);
    expect(fetchDefinition).toHaveBeenCalledExactlyOnceWith(
      "/api/definitions?language=en&word=CATS",
      expect.objectContaining({ method: "GET" }),
    );
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(onPlay).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test.each(["pointerup", "touchend"])("a phone word hold opens immediately and unlocks on %s", async (release) => {
  const fetchDefinition = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    available: true,
    entries: [[{ spelling: "cats", headword: "cat", partOfSpeech: "noun", glosses: ["Domestic felines."] }]],
  })));
  vi.stubGlobal("fetch", fetchDefinition);
  const { onPreview, onPlay } = setup(true);
  const [row] = rows();
  const letters = row.querySelector(".result-letters")!;
  const touch = (target: Element, type: string, clientX = 20) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX });
    Object.assign(event, { pointerType: "touch", pointerId: 1, isPrimary: true });
    fireEvent(target, event);
  };
  vi.useFakeTimers();
  try {
    touch(row, "pointerdown");
    act(() => vi.advanceTimersByTime(500));
    touch(row, "pointerup");
    expect(fetchDefinition).not.toHaveBeenCalled();

    touch(letters, "pointerdown");
    touch(letters, "pointermove", 35);
    act(() => vi.advanceTimersByTime(500));
    touch(letters, "pointercancel");
    expect(fetchDefinition).not.toHaveBeenCalled();

    touch(letters, "pointerdown");
    touch(letters, "pointerup");
    fireEvent.click(letters, { detail: 1 });
    expect(onPreview).toHaveBeenLastCalledWith(moves[0]);
    expect(row.classList.contains("pinned")).toBe(true);

    touch(letters, "pointerdown");
    act(() => vi.advanceTimersByTime(449));
    expect(fetchDefinition).not.toHaveBeenCalled();
    expect(fireEvent.contextMenu(letters)).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(1));
    const sheet = screen.getByRole("dialog", { name: "CATS" });
    const definition = within(sheet).getByText("Domestic felines.");
    const close = within(sheet).getByRole("button", { name: "Close dialog" });
    expect(definition.closest("[inert]")).toBeTruthy();
    expect(close).toHaveProperty("disabled", true);
    if (release === "touchend") {
      touch(sheet, "pointercancel");
      act(() => vi.advanceTimersByTime(32));
      expect(definition.closest("[inert]")).toBeTruthy();
      fireEvent.touchEnd(letters, { touches: [] });
    } else {
      touch(sheet, "pointerup");
    }
    expect(fireEvent.click(sheet, { detail: 1 })).toBe(false);
    expect(screen.getByRole("dialog", { name: "CATS" })).toBe(sheet);
    expect(onPlay).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(32));
    expect(definition.closest("[inert]")).toBeNull();
    expect(close).toHaveProperty("disabled", false);
    expect(document.activeElement).toBe(within(sheet).getByRole("heading", { name: "CATS" }));
    touch(close, "pointerdown");
    touch(close, "pointerup");
    fireEvent.click(close, { detail: 1 });
    expect(screen.queryByRole("dialog", { name: "CATS" })).toBeNull();
    expect(row.classList.contains("pinned")).toBe(true);
    touch(letters, "pointerdown");
    touch(letters, "pointerup");
    fireEvent.click(letters, { detail: 1 });
    expect(onPlay).toHaveBeenCalledExactlyOnceWith(moves[0]);
  } finally {
    vi.useRealTimers();
  }
});

test("a desktop click outside a pinned move clears its preview", async () => {
  const { user, onPlay, onPreview } = setup();
  const [first, second] = rows();
  fireEvent.contextMenu(first);
  expect(first.classList.contains("pinned")).toBe(true);

  const outside = screen.getByRole("heading", { name: "Possible moves" });
  await user.click(outside);
  expect(onPreview).toHaveBeenLastCalledWith(null);
  expect(first.classList.contains("pinned")).toBe(false);
  expect(first.classList.contains("active")).toBe(false);
  expect(onPlay).not.toHaveBeenCalled();

  await user.hover(second);
  expect(onPreview).toHaveBeenLastCalledWith(moves[1]);
});

test.each([false, true])(
  "touch previews on the first tap and plays on the second with hover support %s",
  async (hover) => {
    const { user, onPlay, onPreview } = setup(true, { hover });
    const [first, second] = rows();
    await user.pointer({ keys: "[TouchA]", target: first });
    expect(onPlay).not.toHaveBeenCalled();
    expect(onPreview).toHaveBeenLastCalledWith(moves[0]);
    await user.pointer({ keys: "[TouchA]", target: second });
    expect(onPlay).not.toHaveBeenCalled();
    expect(onPreview).toHaveBeenLastCalledWith(moves[1]);
    await user.pointer({ keys: "[TouchA]", target: second });
    expect(onPlay).toHaveBeenCalledExactlyOnceWith(moves[1]);
  },
);

test.each(["across", "down"] as const)(
  "%s results distinguish board letters from new tiles and mark full-rack bingos",
  (direction) => {
    const size = 21;
    const start = 5 * size + 4;
    const word = "TRAINERS";
    const tiles = [...word].flatMap((letter, i) =>
      i === 3
        ? []
        : [
            {
              index: start + i * (direction === "across" ? 1 : size),
              letter: i === 0 ? letter.toLowerCase() : letter,
            },
          ],
    );
    setup(false, {
      size,
      moves: [
        { ...moves[0], word, row: 5, col: 4, direction, tiles, leave: "" },
      ],
    });
    const row = rows()[0];
    expect(row.querySelector(".bingo-badge")?.textContent).toBe("BINGO");
    expect(row.getAttribute("aria-label")).toContain(
      "bingo, 50-point bonus included",
    );
    expect(
      [...row.querySelectorAll(".result-letter.played")]
        .map((el) => el.textContent)
        .join(""),
    ).toBe("TRANERS");
    expect(row.querySelector(".result-letter.existing")?.textContent).toBe("I");
    expect(row.querySelector(".assigned-blank")?.textContent).toBe("T");
  },
);

test("bingo uses tiles placed and the template rack size, not word length or an empty leave", () => {
  setup(false, {
    rackSize: 4,
    bingoBonus: 25,
    moves: [
      { ...moves[0], leave: "" },
      { ...moves[0], id: "partial", tiles: moves[0].tiles.slice(1), leave: "" },
    ],
  });
  expect(rows()[0].getAttribute("aria-label")).toContain(
    "bingo, 25-point bonus included",
  );
  expect(rows()[1].querySelector(".bingo-badge")).toBeNull();
  expect(rows()[1].classList.contains("bingo")).toBe(false);
  expect(screen.getByRole("img", { name: "1 bingo" })).toBeTruthy();
});

test("bingo remains identified during a phone preview and plays the same move", async () => {
  const { user, onPlay } = setup(true, { rackSize: 4, bingoBonus: 35 });
  await user.click(rows()[0]);
  expect(rows()[0].getAttribute("aria-label")).toContain(
    "bingo, 35-point bonus included",
  );
  expect(rows()[0].classList.contains("active")).toBe(true);
  expect(onPlay).not.toHaveBeenCalled();
  await user.click(rows()[0]);
  expect(onPlay).toHaveBeenCalledExactlyOnceWith(moves[0]);
});

const bingoCheckGame: Game = {
  id: "g",
  name: "Test",
  profileId: "p",
  board: emptyBoard(15),
  rack: "CATS",
  template: PRESETS[0],
  dictionaryId: "test",
  past: [],
  future: [],
  revision: 0,
  updatedAt: "",
  archived: false,
};

test("bingo check follows the displayed sort, reverse order and filter, up to 20 rows", async () => {
  const high = Array.from({ length: 21 }, (_, i) => ({
    ...moves[0],
    id: `high${i}`,
    score: 40 - i,
  }));
  const onBoardOdds = vi.fn();
  const { user } = setup(false, {
    moves: [...high, moves[2]],
    analysisGame: bingoCheckGame,
    replyEnabled: false,
    onBoardOdds,
  });
  const check = () =>
    screen.getByRole("button", { name: "Check bingo after your play" });
  await user.click(screen.getByText("Options", { selector: "summary" }));
  await selectWordSort(user, "word");
  await waitFor(() =>
    expect(rows()[0].getAttribute("aria-label")).toMatch(/^AT,/),
  );
  await user.click(check());
  expect(onBoardOdds).toHaveBeenLastCalledWith(
    [moves[2], ...high.slice(0, 19)],
    89,
  );
  await selectWordSort(user, "word");
  await waitFor(() =>
    expect(rows()[0].getAttribute("aria-label")).toMatch(/^CATS,/),
  );
  await user.click(check());
  expect(onBoardOdds).toHaveBeenLastCalledWith(high.slice(0, 20), 89);
  await selectWordSort(user, "word");
  await user.type(
    screen.getByRole("textbox", { name: "Filter moves" }),
    "CATS",
  );
  await waitFor(() => expect(rows()).toHaveLength(21));
  await user.click(check());
  expect(onBoardOdds).toHaveBeenLastCalledWith(high.slice(0, 20), 89);
});

test("shortlist bingo check keeps the lower-scoring recommendation and respects the filter", async () => {
  const alternative = { ...moves[2], id: "alternate", score: 17, leave: "X" };
  const many = [
    moves[0],
    ...Array.from({ length: 21 }, (_, i) => ({
      ...moves[0],
      id: `duplicate${i}`,
    })),
    alternative,
  ];
  const onBoardOdds = vi.fn(() => ({
    byMove: {
      a: { chance: 0.3, exact: false, samples: 200 },
      alternate: { chance: 0.25, exact: false, samples: 200 },
    },
    checked: 2,
    total: 2,
    bagSize: 89,
  }));
  const { user } = setup(false, {
    moves: many,
    analysisGame: bingoCheckGame,
    replyEnabled: false,
    rackOdds: { byLeave: { Z: 0.01, X: 0.2 }, exact: true, bagSize: 89 },
    onBoardOdds,
  });
  onBoardOdds.mockClear();
  await user.click(await screen.findByRole("button", { name: "Shortlist 2" }));
  await user.click(screen.getByText("Options", { selector: "summary" }));
  const check = screen.getByRole("button", {
    name: "Check bingo after your play",
  });
  expect(rows()[1].getAttribute("aria-label")).toContain("Better bingo odds");
  await user.click(check);
  expect(onBoardOdds).toHaveBeenCalledExactlyOnceWith(
    [moves[0], alternative],
    89,
  );
  expect(rows()[1].getAttribute("aria-label")).toContain(
    "bingo after your play ≈25%",
  );
  expect(rows()[1].getAttribute("aria-label")).toContain("Better bingo odds");
  await user.type(
    screen.getByRole("textbox", { name: "Filter moves" }),
    "CATS",
  );
  await user.click(check);
  expect(onBoardOdds).toHaveBeenLastCalledWith([moves[0]], 89);
});

test("a fresh move search opens All moves even after viewing the Shortlist", async () => {
  const { user, rerun } = setup(false, {
    analysisGame: bingoCheckGame,
    replyEnabled: false,
  });
  const shortlist = () => screen.getByRole("button", { name: /^Shortlist/ });
  const allMoves = () => screen.getByRole("button", { name: "All moves" });
  await user.click(shortlist());
  expect(shortlist().getAttribute("aria-pressed")).toBe("true");
  await user.click(shortlist());
  expect(allMoves().getAttribute("aria-pressed")).toBe("true");
  await user.click(allMoves());
  expect(allMoves().getAttribute("aria-pressed")).toBe("true");
  await user.click(shortlist());
  rerun();
  expect(allMoves().getAttribute("aria-pressed")).toBe("true");
  expect(shortlist().getAttribute("aria-pressed")).toBe("false");
  await waitFor(() => expect(rows()).toHaveLength(moves.length));
});

test("endgame table labels its columns, opening margin, opponent and final adjustment", async () => {
  const user = userEvent.setup();
  const score = { points: 100, moves: 0, best: 0, bingos: 0 };
  const opening = { ...moves[0], leave: "T" };
  const reply = { ...moves[1], id: "reply", leave: "" };
  render(<OptimalReplyDetails
    game={{ ...endgame, scoring: { you: score, opponent: { ...score, points: 110 } } }}
    opponentRack="CAT"
    line={{ line: [opening, reply], points: { you: 18, opponent: 12 }, spread: 6 }}
  />);
  const table = screen.getByRole("table", { name: "Optimal endgame line" });
  expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent))
    .toEqual(["Move", "Leave", "Pts", "Score"]);
  const before = within(table).getByText("Before CATS").closest("tr")!;
  expect(before.querySelector(".optimal-reply-score strong")?.textContent).toBe("100–110");
  expect(before.querySelector(".value-bad")?.textContent).toBe("−10");
  const opponent = within(table).getByRole("button", { name: /^CAT Opponent/ }).closest("tr")!;
  expect(opponent.classList.contains("optimal-reply-opponent-row")).toBe(true);
  expect(within(opponent).getByRole("img", { name: "Goes out" }).textContent).toBe("(Goes out)");
  const final = within(table).getByRole("button", { name: "Final score" }).closest("tr")!;
  expect(final.cells[0].textContent).toBe("Final score");
  expect(final.cells[1].colSpan).toBe(2);
  expect(final.cells[1].textContent).toBe("Rack adjustmentYou −2 · Opp. +2");
  expect(final.cells[2].querySelector("strong")?.textContent).toBe("118–122");
  await user.click(within(opponent).getByRole("img", { name: "Goes out" }));
  expect(within(opponent).getByRole("button").getAttribute("aria-pressed")).toBe("true");
  within(opponent).getByRole("button").focus();
  await user.keyboard("{Tab}{Enter}");
  expect(within(final).getByRole("button").getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText("Final board")).toBeTruthy();
});

test("endgame table includes a final row without adjustments and does not call a pass going out", () => {
  render(<OptimalReplyDetails game={endgame} opponentRack="Z"
    line={{ line: [null, null], points: { you: 0, opponent: 0 }, spread: 0 }} />);
  const table = screen.getByRole("table", { name: "Optimal endgame line" });
  expect(within(table).getByRole("button", { name: "Final score" })).toBeTruthy();
  expect(within(table).queryByText("Rack adjustment")).toBeNull();
  expect(within(table).queryByRole("img", { name: "Goes out" })).toBeNull();
});

test.each(["mouse", "touch"])("endgame selection starts empty, toggles and dismisses outside (%s)", async (pointerType) => {
  const user = userEvent.setup();
  const line = { line: [moves[0], { ...moves[1], leave: "" }], points: { you: 20, opponent: 10 }, spread: 10 };
  const { container, rerender } = render(
    <OptimalReplyDetails game={endgame} opponentRack="CAT" line={line} />,
  );
  const table = screen.getByRole("table", { name: "Optimal endgame line" });
  const first = within(table).getByRole("button", { name: /^CATS You/ });
  const second = within(table).getByRole("button", { name: /^CAT Opponent/ });
  const expectClear = () => {
    expect(within(table).queryByRole("button", { pressed: true })).toBeNull();
    expect(screen.getByText("Current board")).toBeTruthy();
    expect(container.querySelector(".ghost")).toBeNull();
  };
  expectClear();
  fireEvent.pointerDown(first, { pointerType });
  await user.click(first);
  expect(first.getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector(".ghost")).toBeTruthy();
  fireEvent.pointerDown(first, { pointerType });
  await user.click(first);
  expectClear();
  await user.click(second);
  fireEvent.pointerDown(screen.getByRole("heading", { name: "Optimal endgame line" }), { pointerType });
  expectClear();
  await user.click(first);
  fireEvent.pointerDown(document.body, { pointerType });
  expectClear();
  await user.click(first);
  await user.keyboard("{Escape}");
  expectClear();
  await user.click(second);
  rerender(<OptimalReplyDetails game={endgame} opponentRack="CAT" line={{ ...line }} />);
  expectClear();
});
