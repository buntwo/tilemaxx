import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { emptyBoard, type Game, type TrackedMove } from "../../shared/model";
import type { OpponentPolicyResult } from "../../shared/opponent-policy";
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

function setup() {
  TimelineWorker.instances = [];
  vi.stubGlobal("Worker", TimelineWorker);
  const template = PRESETS[0];
  const opponentMove = (word: string, score: number): TrackedMove => ({
    word,
    score,
    player: "opponent",
    bingo: false,
    at: "2026-11-16",
    review: {
      board: emptyBoard(15),
      dictionaryId: "test",
      tiles: [...word].map((letter, index) => ({
        index: template.start + index,
        letter,
      })),
    },
  });
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
      opponentMove("AT", 4),
      { player: "you", word: "TO", score: 6, bingo: false, at: "2026-11-16" },
      opponentMove("OX", 18),
      { ...opponentMove("TEA", 6), review: undefined },
    ],
  };
  const review = (current = game) => (
    <TurnReview game={current} index={null} onClose={() => {}} />
  );
  return { game, review, ...render(review()) };
}

function start(label = "Analyze all opponent turns") {
  fireEvent.click(screen.getByRole("button", { name: label }));
  const worker = TimelineWorker.instances.at(-1)!;
  return { worker, job: worker.postMessage.mock.calls[0][0] as Batch };
}

function fit(random: number): OpponentPolicyResult {
  return {
    kind: "exact",
    probabilities: { topOne: 0.5, uniformTopFive: 0.2, weightedTopFive: 0.25 },
    shortlist: { fit: 1, random },
    rack: { source: "board", rackSize: 7, unseen: 97 },
    samples: 0,
    sampleTarget: 0,
  };
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
  expect(detail.getByText("Uniform top 5")).toBeTruthy();
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
