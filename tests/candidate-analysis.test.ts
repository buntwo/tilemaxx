import assert from "node:assert/strict";
import { test } from "node:test";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard } from "../shared/model";
import { PRESETS } from "../shared/presets";
import {
  compareReplyBoards,
  prepareReplyAnalysis,
  replyEndgameLine,
  sampleReplyRacks,
} from "../shared/reply-analysis";
import { solve } from "../shared/solver";
import { unseenTiles } from "../shared/tile-pool";
import {
  analyzeCandidate,
  type CandidateJob,
  type CandidateRequest,
  type CandidateResult,
} from "../src/candidate-analysis-jobs";
import { runCandidateJobs } from "../src/candidate-analysis-pool";
import { computeWorkerLimit } from "../src/compute-workers";

const lexicon = new Lexicon(["AT", "CAT", "CATS", "IT", "QI", "SAT", "TA"]);
const template = PRESETS[0];
const position = {
  template,
  board: emptyBoard(template.size),
  rack: "CAT",
  scorelessTurns: 0,
};
const choices = solve(lexicon, position.board, position.rack, template);

class TestWorker {
  onmessage?: (event: { data: CandidateResult }) => void;
  onerror?: (error: Error) => void;
  requests: CandidateRequest[] = [];
  stopped = false;
  private lexicon?: Lexicon;

  postMessage(request: CandidateRequest) {
    const sent = structuredClone(request);
    this.requests.push(sent);
    if (sent.dictionary) this.lexicon = Lexicon.fromIndex(sent.dictionary);
  }

  finish() {
    assert.ok(this.lexicon);
    const result = analyzeCandidate(this.lexicon, this.requests.at(-1)!.job);
    this.onmessage?.({ data: structuredClone(result) });
  }

  terminate() {
    this.stopped = true;
  }
}

test("histogram workers pull candidates independently and match serial paired results", async () => {
  const bagSize = unseenTiles(position, template).total - template.rackSize;
  const board = { ...position, bagSize };
  const samples = sampleReplyRacks(board, 500);
  const moves = choices.slice(0, 3);
  assert.equal(moves.length, 3);
  const jobs = moves.map(
    (move): CandidateJob => ({
      kind: "histogram",
      position: board,
      move,
      samples,
    }),
  );
  const workers: TestWorker[] = [];
  const completed: string[] = [];
  const histograms = new Map<
    string,
    Extract<CandidateResult, { kind: "histogram" }>["board"]
  >();
  const running = runCandidateJobs(
    lexicon,
    jobs,
    ({ move }, result) => {
      assert.equal(result.kind, "histogram");
      completed.push(move.id);
      histograms.set(move.id, result.board);
    },
    2,
    () => {
      const worker = new TestWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    },
  );

  assert.equal(workers.length, 2);
  assert.equal(workers[0].requests[0].job.move.id, moves[0].id);
  assert.equal(workers[1].requests[0].job.move.id, moves[1].id);
  workers[1].finish();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(workers[1].requests[1].job.move.id, moves[2].id);
  assert.equal(workers[1].requests[1].dictionary, undefined);
  workers[1].finish();
  workers[0].finish();
  await running;

  assert.deepEqual(completed, [moves[1].id, moves[2].id, moves[0].id]);
  const baseline = histograms.get(moves[0].id)!;
  const serial = prepareReplyAnalysis(
    lexicon,
    board,
    moves[0],
    500,
    () => Infinity,
  );
  for (const move of moves)
    assert.deepEqual(
      compareReplyBoards(histograms.get(move.id)!, baseline, samples),
      serial(move),
    );
  assert.ok(workers.every((worker) => worker.stopped));
});

test("endgame jobs preserve the exact line when a worker cannot start", async () => {
  const twoMoves = choices.filter(({ leave }) => leave).slice(0, 2);
  assert.equal(twoMoves.length, 2);
  const available = { ...position, bagSize: 0 };
  const tileCounts = Object.fromEntries(
    Object.entries(template.tileCounts!).map(([letter]) => [
      letter,
      [...(position.rack + "IT")].filter((tile) => tile === letter).length,
    ]),
  );
  const board = { ...available, template: { ...template, tileCounts } };
  const jobs = twoMoves.map(
    (move): CandidateJob => ({ kind: "endgame", position: board, move }),
  );
  const completed: string[] = [];
  await runCandidateJobs(
    lexicon,
    jobs,
    ({ move }, result) => {
      assert.equal(result.kind, "endgame");
      assert.ok(result.line.line.length > 1);
      assert.deepEqual(
        result.line,
        replyEndgameLine(lexicon, board, move, 5000, Infinity),
      );
      completed.push(move.id);
    },
    2,
    () => {
      throw new Error("Nested workers unavailable");
    },
  );
  assert.deepEqual(
    completed,
    twoMoves.map(({ id }) => id),
  );
});

test("automatic worker limits follow the browser hint up to four and can be set to one", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 6, 12].map((hint) => computeWorkerLimit(false, hint)),
    [1, 2, 3, 4, 4, 4],
  );
  assert.equal(computeWorkerLimit(true, 12), 1);
});

test("the one-worker limit executes a batch without starting nested workers", async () => {
  const bagSize = unseenTiles(position, template).total - template.rackSize;
  const board = { ...position, bagSize };
  const samples = sampleReplyRacks(board, 500);
  const jobs: CandidateJob[] = choices.slice(0, 2).map((move) => ({
    kind: "histogram",
    position: board,
    move,
    samples,
  }));
  const completed: string[] = [];
  let started = 0;
  await runCandidateJobs(
    lexicon,
    jobs,
    ({ move }, result) => {
      assert.equal(result.kind, "histogram");
      completed.push(move.id);
    },
    computeWorkerLimit(true, 8),
    () => {
      started++;
      throw new Error("Unexpected nested worker");
    },
  );
  assert.equal(started, 0);
  assert.deepEqual(
    completed,
    jobs.map(({ move }) => move.id),
  );
});
