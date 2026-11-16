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

  returnTurn(job: Batch, index: number, result: OpponentPolicyResult) {
    act(() => {
      this.onmessage?.({
        data: {
          progress: { completed: index + 1, total: job.turns.length },
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

test("changing the word list cancels a batch and discards its stale results", () => {
  const { game, review, rerender } = setup();
  const { worker, job } = start();
  worker.returnTurn(job, 0, fit(0.2));
  rerender(review({ ...game, dictionaryId: "other" }));
  expect(worker.terminate).toHaveBeenCalledOnce();
  worker.returnTurn(job, 1, fit(0.2));
  expect(screen.queryByText("High fit")).toBeNull();
  const next = start();
  expect(next.job.dictionaryId).toBe("other");
  expect(next.job.turns).toHaveLength(2);
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
