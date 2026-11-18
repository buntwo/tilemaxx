import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { emptyBoard, type Game, type TrackedMove } from "../../shared/model";
import type { OpponentPolicyResult } from "../../shared/opponent-policy";
import { shortlistConfidence } from "../../shared/shortlist-confidence";
import { PRESETS } from "../../shared/presets";
import TurnReview from "../../src/components/TurnReview";
import type { PracticeRequest } from "../../src/practice.worker";

type Batch = Extract<PracticeRequest, { kind: "opponent-policy-timeline" }>;
class TimelineWorker {
  static instances: TimelineWorker[] = [];
  onmessage?: (message: { data: unknown }) => void;
  postMessage = vi.fn<(job: PracticeRequest) => void>();
  terminate = vi.fn();
  constructor() {
    TimelineWorker.instances.push(this);
  }

  returnTurn(
    job: Batch,
    index: number,
    result: OpponentPolicyResult,
    completed = index + 1,
  ) {
    act(() => {
      this.onmessage?.({
        data: {
          progress: { completed, total: job.turns.length },
          update: { key: job.turns[index].key, result },
        },
      });
    });
  }
}

function setup(index: number | null = null) {
  TimelineWorker.instances = [];
  vi.stubGlobal("Worker", TimelineWorker);
  const template = PRESETS[0];
  const placement = (word: string, score: number): TrackedMove => ({
    word,
    score,
    player: "opponent",
    bingo: false,
    at: "2026-11-16",
    review: {
      board: emptyBoard(15),
      dictionaryId: "test",
      observerRack: "AEINRST",
      tiles: [...word].map((letter, index) => ({
        index: template.start + index,
        letter,
      })),
    },
  });
  const ownMove = placement("TO", 6);
  const game: Game = {
    id: "timeline",
    profileId: "p",
    name: "Timeline game",
    template,
    dictionaryId: "test",
    board: emptyBoard(15),
    rack: "",
    past: [],
    future: [],
    revision: 0,
    updatedAt: "",
    archived: false,
    trackedMoves: [
      placement("AT", 4),
      {
        ...ownMove,
        player: "you",
        review: { ...ownMove.review!, rack: "TOABCDE" },
      },
      placement("OX", 18),
      { ...placement("TEA", 6), review: undefined },
    ],
  };
  const review = (current = game) => (
    <TurnReview game={current} index={index} onClose={() => {}} />
  );
  return { game, review, ...render(review()) };
}

function start(label = "Analyze all opponent turns") {
  fireEvent.click(screen.getByRole("button", { name: label }));
  const worker = TimelineWorker.instances.at(-1)!;
  return { worker, job: worker.postMessage.mock.calls[0][0] as Batch };
}

function fit(random: number) {
  return {
    kind: "exact",
    probabilities: {
      topOne: 0.25,
      uniformTopFive: 0.1,
      weightedTopFive: 0.125,
    },
    compatibleRackChance: 0.5,
    conditionalProbabilities: {
      topOne: 0.5,
      uniformTopFive: 0.2,
      weightedTopFive: 0.25,
    },
    shortlist: { fit: 1, random },
    rack: { source: "board", rackSize: 7, unseen: 97 },
    samples: 0,
  } satisfies OpponentPolicyResult;
}

test("the timeline keeps the recorded turn order when a later job finishes first", () => {
  setup();
  const table = within(
    screen.getByRole("table", { name: "Opponent moves by turn" }),
  );
  const { worker, job } = start();
  worker.returnTurn(job, 1, fit(0.2), 1);
  expect(screen.getByText("Checked 1 of 2 turns in this batch.")).toBeTruthy();
  const rows = table.getAllByRole("row").slice(1);
  expect(
    rows.map((row) => within(row).getByRole("rowheader").textContent),
  ).toEqual(["1 · AT", "3 · OX", "4 · TEA"]);
  expect(within(rows[1]).getByText("High fit")).toBeTruthy();
  expect(within(rows[0]).queryByText("High fit")).toBeNull();
});

test("the timeline streams in order, keeps finished turns after cancellation and opens their saved detail", () => {
  setup();
  const table = within(
    screen.getByRole("table", { name: "Opponent moves by turn" }),
  );
  expect(table.getAllByRole("rowheader").map((row) => row.textContent)).toEqual(
    ["1 · AT", "3 · OX", "4 · TEA"],
  );
  expect(table.getByText("No saved placement")).toBeTruthy();
  const { worker, job } = start();
  expect(job.kind).toBe("opponent-policy-timeline");
  expect(job.turns.map(({ input }) => input.word)).toEqual(["AT", "OX"]);
  worker.returnTurn(job, 0, fit(0.2));
  expect(screen.getByText("Checked 1 of 2 turns in this batch.")).toBeTruthy();
  expect(table.getByText("High fit")).toBeTruthy();

  fireEvent.click(table.getByRole("button", { name: "3 · OX" }));
  expect(screen.getByText("Queued in timeline analysis.")).toBeTruthy();
  expect(worker.terminate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Back to game review" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Cancel timeline analysis" }),
  );
  expect(worker.terminate).toHaveBeenCalledOnce();
  worker.returnTurn(job, 1, fit(0.2));

  const { worker: resumed, job: remaining } = start("Analyze remaining turns");
  expect(remaining.turns.map(({ input }) => input.word)).toEqual(["OX"]);
  resumed.returnTurn(remaining, 0, fit(1));
  act(() =>
    resumed.onmessage?.({ data: { result: { reachedTimeLimit: false } } }),
  );
  expect(screen.getByText("1 high-fit turn · 2 checked")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "1 · AT" }));
  const detail = within(
    screen.getByRole("region", { name: "Opponent policy fit" }),
  );
  const raw = detail.getByText("Raw policy estimates").closest("details")!;
  expect(raw.open).toBe(false);
  const primary = detail.getAllByText("Uniform top 5")[0].parentElement!;
  expect(within(primary).getByText("20%")).toBeTruthy();
  fireEvent.click(detail.getByText("Raw policy estimates"));
  expect(raw.open).toBe(true);
  expect(within(raw).getByText("10%")).toBeTruthy();
  expect(
    within(raw).getByText(/chance of holding the played tiles is 50%/),
  ).toBeTruthy();
  expect(detail.getByText("Board-only prior.", { exact: false })).toBeTruthy();
  expect(
    detail.queryByRole("button", { name: "Analyze policy fit" }),
  ).toBeNull();
});

test("review uses the current word list and cancels stale policy jobs when it changes", () => {
  const { game, review, rerender } = setup();
  const moves = [...game.trackedMoves!];
  moves[2] = {
    ...moves[2],
    review: { ...moves[2].review!, dictionaryId: "historical-2" },
  };
  const mixed = { ...game, trackedMoves: moves, dictionaryId: "current" };
  rerender(review(mixed));
  const { worker, job } = start();
  expect(job.turns.map(({ dictionaryId }) => dictionaryId)).toEqual([
    "current",
    "current",
  ]);
  worker.returnTurn(job, 0, fit(0.2));
  rerender(review({ ...mixed, dictionaryId: "other" }));
  expect(worker.terminate).toHaveBeenCalledOnce();
  worker.returnTurn(job, 1, fit(0.2));
  expect(screen.queryByText("High fit")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "3 · OX" }));
  fireEvent.click(screen.getByRole("button", { name: "Analyze policy fit" }));
  const [request] = TimelineWorker.instances.at(-1)!.postMessage.mock.calls[0];
  expect(request).toMatchObject({
    kind: "opponent-policy",
    dictionaryId: "other",
    input: { word: "OX" },
  });
});

test("changing a recorded policy input cancels the batch and drops stale results", () => {
  const { game, review, rerender } = setup();
  const { worker, job } = start();
  worker.returnTurn(job, 0, fit(0.2));
  const moves = game.trackedMoves!.map((move) =>
    move.review
      ? { ...move, review: { ...move.review, observerRack: "AEINRSTZ" } }
      : move,
  );
  rerender(review({ ...game, trackedMoves: moves }));
  expect(worker.terminate).toHaveBeenCalledOnce();
  worker.returnTurn(job, 1, fit(0.2));
  expect(screen.queryByText("High fit")).toBeNull();
  expect(start().job.turns.map(({ dictionaryId }) => dictionaryId)).toEqual([
    "test",
    "test",
  ]);
});

test("a limited standalone policy search can retry once with a larger budget", () => {
  setup(0);
  const first = screen.getByRole("button", { name: "Analyze policy fit" });
  const limited = { ...fit(0.2), kind: "sampled", limited: true, samples: 64 } as const;
  fireEvent.click(first);
  const initial = TimelineWorker.instances.at(-1)!;
  expect(initial.postMessage.mock.calls[0][0]).toMatchObject({ refine: false });
  act(() => initial.onmessage?.({ data: { result: limited } }));

  fireEvent.click(screen.getByRole("button", { name: "Retry with more time" }));
  const retry = TimelineWorker.instances.at(-1)!;
  expect(retry.postMessage.mock.calls[0][0]).toMatchObject({ refine: true });
  act(() =>
    retry.onmessage?.({
      data: { result: { kind: "unavailable", reason: "Search limit", limited: true } },
    }),
  );
  expect(screen.getByText(/64 completed rack samples/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Retry with more time" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Back to game review" }));
  fireEvent.click(screen.getByRole("button", { name: "1 · AT" }));
  expect(screen.queryByRole("button", { name: "Retry with more time" })).toBeNull();
});

test("sampled turns stay borderline until the bounds support a highlight", () => {
  setup();
  const { worker, job } = start();
  const samples = 512;
  const shortlist = { fit: 0.82, random: 0.1 };
  worker.returnTurn(job, 0, {
    ...fit(shortlist.random),
    kind: "sampled",
    samples,
    shortlist,
    confidence: shortlistConfidence(shortlist, samples),
    limited: true,
  });
  const table = within(
    screen.getByRole("table", { name: "Opponent moves by turn" }),
  );
  expect(table.getAllByRole("columnheader").at(-1)?.textContent).toBe("Random");
  expect(table.getByText("≈82%")).toBeTruthy();
  expect(table.getByText("Borderline")).toBeTruthy();
  expect(table.queryByText("High fit")).toBeNull();

  fireEvent.click(table.getByRole("button", { name: "1 · AT" }));
  const detail = within(
    screen.getByRole("region", { name: "Opponent policy fit" }),
  );
  expect(
    detail.getByText(/95% sampling ranges at 512 rack samples/),
  ).toBeTruthy();
  expect(
    detail.getByRole("button", { name: "Retry with more time" }),
  ).toBeTruthy();
});

test("the two perspectives use the same analysis and keep their turns and results separate", () => {
  setup();
  const opponent = start();
  expect(opponent.job.turns[0].input.position.observerRack).toBe("AEINRST");
  opponent.worker.returnTurn(opponent.job, 0, fit(0.2));

  fireEvent.click(screen.getByRole("button", { name: "Your plays" }));
  const ownTable = within(
    screen.getByRole("table", { name: "Your moves by turn" }),
  );
  expect(
    ownTable.getAllByRole("rowheader").map((row) => row.textContent),
  ).toEqual(["2 · TO"]);
  expect(
    screen.queryByRole("table", { name: "Opponent moves by turn" }),
  ).toBeNull();
  expect(screen.queryByText("High fit")).toBeNull();
  expect(opponent.worker.terminate).not.toHaveBeenCalled();

  const own = start("Analyze all your turns");
  expect(own.job.kind).toBe(opponent.job.kind);
  expect(own.job.turns).toHaveLength(1);
  const [{ input }] = own.job.turns;
  expect(input.word).toBe("TO");
  expect(Object.keys(input.position).sort()).toEqual(["board", "tiles"]);
  own.worker.returnTurn(own.job, 0, fit(0.2));

  fireEvent.click(ownTable.getByRole("button", { name: "2 · TO" }));
  const detail = within(
    screen.getByRole("region", { name: "Your policy fit" }),
  );
  expect(
    detail.getByText(/The opponent’s rack at this turn is unknown/),
  ).toBeTruthy();
  expect(detail.getAllByText("Score-weighted top 5")).toHaveLength(2);
  expect(detail.queryByText("TOABCDE")).toBeNull();
  expect(screen.getByText("TOABCDE")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Back to game review" }));
  expect(
    screen
      .getByRole("button", { name: "Your plays" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Opponent plays" }));
  expect(
    screen.queryByRole("table", { name: "Your moves by turn" }),
  ).toBeNull();
  expect(
    screen.getByRole("table", { name: "Opponent moves by turn" }),
  ).toBeTruthy();
  expect(screen.getByText("High fit")).toBeTruthy();
  expect(screen.getByText("Checked 1 of 2 turns in this batch.")).toBeTruthy();
});

test("reviewing one of your moves directly uses the opponent’s view and returns to your timeline", () => {
  setup(1);
  const detail = within(
    screen.getByRole("region", { name: "Your policy fit" }),
  );
  fireEvent.click(detail.getByRole("button", { name: "Analyze policy fit" }));
  const worker = TimelineWorker.instances.at(-1)!;
  const [request] = worker.postMessage.mock.calls[0];
  expect(request.kind).toBe("opponent-policy");
  if (request.kind !== "opponent-policy")
    throw new Error("Expected a policy job");
  expect(Object.keys(request.input.position).sort()).toEqual([
    "board",
    "tiles",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Back to game review" }));
  expect(
    screen.getByRole("table", { name: "Your moves by turn" }),
  ).toBeTruthy();
});


test("move alternatives and missed opportunities use the current list and discard stale analysis", () => {
  const { game, review, rerender } = setup(1);
  rerender(review({ ...game, dictionaryId: "current" }));
  fireEvent.click(screen.getByRole("button", { name: "Find alternatives" }));
  const worker = TimelineWorker.instances.at(-1)!;
  expect(worker.postMessage.mock.calls[0][0]).toMatchObject({
    kind: "turn", turns: [{ position: { dictionaryId: "current" } }],
  });
  rerender(review({ ...game, dictionaryId: "another" }));
  expect(worker.terminate).toHaveBeenCalledOnce();
  act(() => worker.onmessage?.({ data: { result: [] } }));
  expect(screen.queryByText("No alternatives found in the selected word list.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Back to game review" }));
  fireEvent.click(screen.getByRole("button", { name: "Find missed opportunities" }));
  expect(TimelineWorker.instances.at(-1)!.postMessage.mock.calls[0][0]).toMatchObject({
    kind: "game", turns: [{ position: { dictionaryId: "another" } }],
  });
});
