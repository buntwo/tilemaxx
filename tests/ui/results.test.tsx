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
    moves?: Move[];
    size?: number;
    rackSize?: number;
    bingoBonus?: number;
    rackOdds?: RackOdds;
    boardOdds?: BoardOddsResult;
    analysisGame?: Game;
    replyEnabled?: boolean;
    fetchPage?: FetchMovePage;
    onBoardOdds?: (moves: Move[], bagSize: number) => void;
  } = {},
) {
  vi.stubGlobal("matchMedia", () => ({ matches: !mobile }));
  const onPlay = vi.fn(),
    onPreview = vi.fn();
  const index = new MoveResultIndex(options.moves ?? moves);
  const results = index.summary(0);
  const fetchPage =
    options.fetchPage ?? vi.fn(async (_id, query) => index.page(query));
  const fetchShortlist = vi.fn(async (_id, options) =>
    index.shortlist(options),
  );
  function Harness() {
    const [preview, setPreview] = useState<Move | null>(null);
    return (
      <Results
        results={results}
        fetchPage={fetchPage}
        fetchShortlist={fetchShortlist}
        busy=""
        elapsed={4}
        error=""
        size={options.size ?? 15}
        rackSize={options.rackSize ?? 7}
        bingoBonus={options.bingoBonus ?? 50}
        rackOdds={options.rackOdds}
        boardOdds={options.boardOdds}
        analysisGame={options.analysisGame}
        replyEnabled={options.replyEnabled}
        preview={preview}
        onPreview={(m) => {
          setPreview(m);
          onPreview(m);
        }}
        onPlay={onPlay}
        onSolve={() => {}}
        onBoardOdds={options.onBoardOdds}
        onCancelBoardOdds={options.onBoardOdds ? () => {} : undefined}
        hasRack
      />
    );
  }
  render(<Harness />);
  return { onPlay, onPreview, user: userEvent.setup() };
}
const rows = () => screen.getAllByRole("button", { name: /points,/ });

test("scrolling and filtering use worker pages and ignore out-of-order results", async () => {
  const longList = Array.from({ length: 200 }, (_, i) => ({
    ...moves[0],
    id: String(i),
    word: i === 199 ? "ZEBRA" : i === 190 ? "QUICK" : "CATS",
    score: 400 - i,
  }));
  const index = new MoveResultIndex(longList);
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
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Sort moves" }),
    "word",
  );
  const row = rows().find((element) =>
    element.getAttribute("aria-label")?.startsWith("CAT,"),
  )!;
  expect(row.querySelector(".result-score-delta")?.textContent).toBe("−10");
  await user.click(
    screen.getByRole("button", { name: /^Reply analysis for CAT at/ }),
  );
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
});

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
  const game: Game = {
    id: "endgame",
    name: "Endgame",
    profileId: "p",
    board: emptyBoard(15),
    rack: "CATS",
    template: {
      ...PRESETS[0],
      tileCounts: Object.fromEntries(
        TILE_SYMBOLS.map((letter) => [
          letter,
          Number("CATSZ".includes(letter)),
        ]),
      ),
    },
    dictionaryId: "test",
    past: [],
    future: [],
    revision: 0,
    updatedAt: "",
    archived: false,
  };
  const { user } = setup(false, { analysisGame: game, replyEnabled: true });
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
test("rack odds sort every move and board odds rank checked moves separately", async () => {
  const { user } = setup(true, {
    rackOdds: { byLeave: { Z: 0.05, AS: 0.6 }, exact: true, bagSize: 55 },
    boardOdds: {
      byMove: {
        a: { chance: 0.8, exact: false },
        c: { chance: 0, exact: true },
      },
      checked: 2,
      total: 2,
      bagSize: 55,
    },
  });
  expect(rows()[0].getAttribute("aria-label")).toContain(
    "bingo draw 5%, bingo after your play ≈80%",
  );
  const sort = screen.getByRole("combobox", { name: "Sort moves" });
  await user.selectOptions(sort, "bingo-draw");
  expect(
    rows().map((row) => row.getAttribute("aria-label")?.split(",")[0]),
  ).toEqual(["CAT", "AT", "CATS"]);
  await user.selectOptions(sort, "board-bingo");
  expect(
    rows().map((row) => row.getAttribute("aria-label")?.split(",")[0]),
  ).toEqual(["CATS", "AT", "CAT"]);
  const afterPlay = screen.getByRole("button", {
    name: "Sort by bingo odds after play",
  });
  await user.click(afterPlay);
  expect(
    rows().map((row) => row.getAttribute("aria-label")?.split(",")[0]),
  ).toEqual(["AT", "CATS", "CAT"]);
});
test("sort by word, length, tiles, leave and blanks; filter without losing original results", async () => {
  const { user } = setup();
  const sort = screen.getByRole("combobox", { name: "Sort moves" });
  await user.click(screen.getByRole("button", { name: "Sort by word" }));
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^AT,/);
  expect(sort).toHaveProperty("value", "word");
  await user.click(screen.getByRole("button", { name: "Sort by word" }));
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^CATS,/);
  await user.click(screen.getByRole("button", { name: "Sort by points" }));
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^CATS,/);
  await user.click(screen.getByRole("button", { name: "Sort by points" }));
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^AT,/);
  await user.click(screen.getByRole("button", { name: "Sort by points" }));
  expect(rows()[0].getAttribute("aria-label")).toMatch(/^CATS,/);
  for (const by of ["length", "tiles", "score"]) {
    await user.selectOptions(sort, by);
    expect(rows()[0].getAttribute("aria-label")).toMatch(/^CATS,/);
  }
  for (const by of ["leave", "blanks"]) {
    await user.selectOptions(sort, by);
    expect(rows()[0].getAttribute("aria-label")).toMatch(/^CAT,/);
  }
  await user.type(
    screen.getByRole("textbox", { name: "Filter moves" }),
    "CATS",
  );
  expect(rows()).toHaveLength(1);
  await user.clear(screen.getByRole("textbox", { name: "Filter moves" }));
  expect(rows()).toHaveLength(3);
});
test("desktop hover previews and one click plays", async () => {
  const { user, onPlay, onPreview } = setup();
  // Define a pointer event because jsdom only provides MouseEvent.
  const enter = new MouseEvent("pointerover", { bubbles: true });
  Object.defineProperty(enter, "pointerType", { value: "mouse" });
  fireEvent(rows()[0], enter);
  expect(onPreview).toHaveBeenCalledWith(moves[0]);
  expect(onPlay).not.toHaveBeenCalled();
  await user.click(rows()[0]);
  expect(onPlay).toHaveBeenCalledOnce();
});
test("phone first tap previews, a different tap switches preview, second tap plays", async () => {
  const { user, onPlay, onPreview } = setup(true);
  await user.click(rows()[0]);
  expect(onPlay).not.toHaveBeenCalled();
  expect(onPreview).toHaveBeenLastCalledWith(moves[0]);
  await user.click(rows()[1]);
  expect(onPlay).not.toHaveBeenCalled();
  await user.click(rows()[1]);
  expect(onPlay).toHaveBeenCalledExactlyOnceWith(moves[1]);
});

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

test("shortlist bingo check includes alternatives outside the top 20", async () => {
  const alternative = { ...moves[2], id: "alternate", score: 17, leave: "S" };
  const many = [
    moves[0],
    ...Array.from({ length: 21 }, (_, i) => ({
      ...moves[0],
      id: `duplicate${i}`,
    })),
    alternative,
  ];
  const onBoardOdds = vi.fn();
  const { user } = setup(false, {
    moves: many,
    analysisGame: {
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
    },
    replyEnabled: false,
    rackOdds: { byLeave: { Z: 0.01, S: 0.2 }, exact: true, bagSize: 89 },
    onBoardOdds,
  });
  await user.click(await screen.findByRole("button", { name: "Shortlist 2" }));
  await user.type(
    screen.getByRole("textbox", { name: "Filter moves" }),
    "CATS",
  );
  await user.click(
    screen.getByRole("button", { name: "Check bingo after your play" }),
  );
  expect(onBoardOdds).toHaveBeenCalledExactlyOnceWith(
    [moves[0], alternative],
    89,
  );
});
