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
import Results from "../../src/components/Results";
import { emptyBoard, type Game, type Move } from "../../shared/model";
import { TILE_SYMBOLS } from "../../shared/tile-pool";
import { PRESETS } from "../../shared/presets";
import type {
  ReplyRequest,
  ReplyDistribution,
} from "../../shared/reply-analysis";
import { type BoardOddsResult, type RackOdds } from "../../shared/bingo-odds";
import { MoveResultIndex, type MoveResults } from "../../shared/move-results";
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
  const { rerender } = render(<MoveTimingButton size={15} timing={timing} />);
  await user.click(screen.getByRole("button", { name: "Calculation timing, 2.00 s" }));
  const dialog = screen.getByRole("dialog", { name: "Calculation timing" });
  const bars = () =>
    [...dialog.querySelectorAll("dd")].map((value) =>
      value.style.getPropertyValue("--timing-bar-width"),
    );
  expect(bars()).toEqual(["100%", "10%", "0%", "75%", "25%", "40%"]);

  rerender(<MoveTimingButton size={15} timing={{ ...timing, total: 0 }} />);
  expect(bars()).toEqual(Array(6).fill("0%"));
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

  await user.click(screen.getByRole("button", { name: "Sort by word" }));
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
    dialog.querySelector('[data-cell="0"]')?.classList.contains("ghost"),
  ).toBe(true);
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
  expect(worker!.request).toMatchObject({
    kind: "reply-detail",
    reference: { id: "a" },
    samples: 5_000,
    captureHeatmap: true,
  });
  expect(within(inline).getByText("31.0").parentElement?.textContent).toBe("35.0 → 31.0 pts");
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
    tiles: [{ index: 97, letter: "Z" }],
    leave: "TT?",
  };
  const finish = {
    ...moves[2],
    id: "ta",
    word: "TA",
    score: 21,
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
  expect(details.getByText("143")).toBeTruthy();
  expect(details.getByText("139")).toBeTruthy();
  const openingTurn = details.getByRole("button", { name: /^CATS You/ });
  expect(within(openingTurn).getByRole("img", { name: "Leave: T" }).textContent).toBe("T");
  const replyTurn = details.getByRole("button", { name: /ZA .* Behind by 21/ });
  expect(replyTurn.getAttribute("aria-pressed")).toBe("true");
  const leave = within(replyTurn).getByRole("img", { name: "Leave: T, T, blank" });
  const tiles = [...leave.querySelectorAll(".mini-tiles > span")];
  expect(tiles.map((tile) => tile.textContent)).toEqual(["T", "T", ""]);
  expect(tiles[2].classList.contains("blank")).toBe(true);
  expect(details.getByRole("button", { name: /^H7: Z/ }).classList.contains("ghost")).toBe(true);

  const pass = details.getByRole("button", { name: /^Pass You/ });
  expect(within(pass).getByRole("img", { name: "Leave: T" })).toBeTruthy();
  const opponentPass = details.getByRole("button", { name: /^Pass Opponent/ });
  expect(within(opponentPass).getByRole("img", { name: "Leave: T, T, blank" })).toBeTruthy();
  await user.click(pass);
  expect(details.getByText("Board after your pass")).toBeTruthy();
  expect(details.getByRole("button", { name: /^H7: Z/ }).classList.contains("ghost")).toBe(false);
  const lastPlay = details.getByRole("button", { name: /^TA You/ });
  expect(within(lastPlay).getByRole("img", { name: "Empty rack" }).textContent).toBe("—");
  await user.click(lastPlay);
  expect(details.getByText("Board after TA")).toBeTruthy();
  expect(details.getByRole("button", { name: /^G8: T/ }).classList.contains("ghost")).toBe(true);
  const adjustment = details.getByRole("button", { name: /^Rack adjustment/ });
  expect(within(adjustment).queryByRole("img")).toBeNull();
  await user.click(adjustment);
  expect(details.getByText("Final board")).toBeTruthy();
  expect(details.getByText("143–139")).toBeTruthy();

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
    onmessage?: (event: { data: EndgamePrecomputeMessage }) => void;
    terminate() {}
    postMessage(request: ReplyRequest | EndgamePrecomputeRequest) {
      if (request.kind === "precompute-endgames") background = this;
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
        moveId: "a",
        elapsed: 5,
        line: { spread: 10, points: { you: 20, opponent: 10 }, line: [moves[0]] },
      },
    });
    background!.onmessage!({ data: { moveId: "c", limit: "Time limit reached.", elapsed: 10 } });
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
  await user.click(screen.getByRole("button", { name: "Sort by word" }));
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^AT,/);
  await user.click(screen.getByRole("button", { name: "Sort by word" }));
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
  const sort = () => screen.getByRole("button", { name: "Sort by word" });
  await user.click(screen.getByText("Options", { selector: "summary" }));
  await user.click(sort());
  await waitFor(() =>
    expect(rows()[0].getAttribute("aria-label")).toMatch(/^AT,/),
  );
  await user.click(check());
  expect(onBoardOdds).toHaveBeenLastCalledWith(
    [moves[2], ...high.slice(0, 19)],
    89,
  );
  await user.click(sort());
  await waitFor(() =>
    expect(rows()[0].getAttribute("aria-label")).toMatch(/^CATS,/),
  );
  await user.click(check());
  expect(onBoardOdds).toHaveBeenLastCalledWith(high.slice(0, 20), 89);
  await user.click(sort());
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
