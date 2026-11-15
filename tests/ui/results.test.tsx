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
import Results from "../../src/components/Results";
import { emptyBoard, type Game, type Move } from "../../shared/model";
import { TILE_SYMBOLS } from "../../shared/tile-pool";
import { PRESETS } from "../../shared/presets";
import type {
  ReplyRequest,
  ReplyDistribution,
} from "../../shared/reply-analysis";
import { type BoardOddsResult, type RackOdds } from "../../shared/bingo-odds";
import { MoveResultIndex } from "../../shared/move-results";
import { moveRowHeight, type FetchMovePage } from "../../src/useMoveResults";
import { useReplyAnalysis } from "../../src/useReplyAnalysis";
import type { RankEndgame } from "../../src/useSolver";
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
function setup(
  mobile = false,
  options: {
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
  const results = index.summary(0);
  const rank = options.rankEndgame?.(index);
  const fetchPage =
    options.fetchPage ?? vi.fn(async (_id, query) => index.page(query));
  const fetchShortlist = vi.fn(async (_id, options) =>
    index.shortlist(options),
  );
  function Harness() {
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
        elapsed={4}
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
  render(<Harness />);
  return { onPlay, onPreview, user: userEvent.setup() };
}
const rows = () => screen.getAllByRole("button", { name: /points,/ });

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
  expect(pending).toHaveLength(0);
  const scroller = screen.getByLabelText("Suggested moves");
  scroller.scrollTop = 200 * moveRowHeight;
  fireEvent.scroll(scroller);
  await waitFor(() => expect(pending).toHaveLength(1));
  await act(async () => pending[0]());
  expect(screen.getByRole("button", { name: /^ZEBRA,/ })).toBeTruthy();

  const filter = screen.getByRole("textbox", { name: "Filter moves" });
  fireEvent.change(filter, { target: { value: "QUI" } });
  fireEvent.change(filter, { target: { value: "ZEB" } });
  await waitFor(() => expect(pending).toHaveLength(3));
  await act(async () => pending[2]());
  expect(rows()).toHaveLength(1);
  expect(screen.getByRole("button", { name: /^ZEBRA,/ })).toBeTruthy();
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
  expect(within(inline).getByText("35.0 → 31.0 pts")).toBeTruthy();
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
  expect(within(dialog).getByText("16% → 0% of checked racks")).toBeTruthy();
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
  expect(within(inline).getByText("35.0 → 31.0 pts")).toBeTruthy();
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
  expect(screen.getByText("Bag assumed empty")).toBeTruthy();
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
  expect(screen.queryByText("Bag assumed empty")).toBeNull();
});

test("empty-bag estimates rank moves automatically and ignore a canceled ranking", async () => {
  vi.stubGlobal(
    "Worker",
    class {
      terminate() {}
      postMessage() {}
    },
  );
  const pending: { signal: AbortSignal; publish: () => void }[] = [];
  const { user } = setup(false, {
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
  expect(screen.getByText("Estimating endgames…")).toBeTruthy();
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^CATS,/);
  await user.click(screen.getByText("Reply settings"));
  const setBag = async (value: string) => {
    fireEvent.change(screen.getByRole("spinbutton", { name: "Tiles in bag" }), {
      target: { value },
    });
    await user.click(
      screen.getByRole("button", { name: "Update reply analysis" }),
    );
  };
  await setBag("1");
  expect(pending[0].signal.aborted).toBe(true);
  await act(async () => pending[0].publish());
  expect(
    screen.queryByRole("button", { name: "Sort by estimated endgame swing" }),
  ).toBeNull();

  await setBag("0");
  await act(async () => pending[1].publish());
  const swing = await screen.findByRole("button", {
    name: "Sort by estimated endgame swing",
  });
  expect(swing.getAttribute("aria-pressed")).toBe("true");
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^CAT,/);
  expect(screen.getByText("QI out")).toBeTruthy();
  expect(screen.getByTitle("Exact endgame swing +5").textContent).toBe("+5");
  expect(
    screen.getByTitle(/^Estimated endgame swing −41/).textContent,
  ).toContain("≈−41");
  expect(screen.getByText("Estimated 2 of 3 moves")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Sort by points" }));
  await waitFor(() =>
    expect(rows()[0].getAttribute("aria-label")).toMatch(/^CATS,/),
  );
  expect(screen.getByText("QI out")).toBeTruthy();
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
