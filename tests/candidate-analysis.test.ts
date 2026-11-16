import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkBoardBingo,
  prepareBoardBingo,
  RackBingoIndex,
} from "../shared/bingo-odds";
import { optimizeExchange } from "../shared/optimal-exchange";
import { analyzeOpponentPolicy } from "../shared/opponent-policy";
import { randomGenerator } from "../shared/move-analysis";
import { parallelOptimalExchange } from "../src/parallel-exchange";
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
  createCandidateAnalyzer,
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
  private analyze?: ReturnType<typeof createCandidateAnalyzer>;

  postMessage(request: CandidateRequest) {
    const sent = structuredClone(request);
    this.requests.push(sent);
    if (sent.dictionary)
      this.analyze = createCandidateAnalyzer(
        Lexicon.fromIndex(sent.dictionary),
      );
  }

  finish() {
    assert.ok(this.analyze);
    const result = this.analyze(this.requests.at(-1)!.job);
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
    (move): Extract<CandidateJob, { kind: "histogram" }> => ({
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
  function sentMove(worker: TestWorker, index: number) {
    const job = worker.requests[index].job;
    assert.equal(job.kind, "histogram");
    return job.move.id;
  }
  assert.equal(sentMove(workers[0], 0), moves[0].id);
  assert.equal(sentMove(workers[1], 0), moves[1].id);
  workers[1].finish();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(sentMove(workers[1], 1), moves[2].id);
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
    (move): Extract<CandidateJob, { kind: "endgame" }> => ({
      kind: "endgame",
      position: board,
      move,
    }),
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
  const jobs: Extract<CandidateJob, { kind: "histogram" }>[] = choices
    .slice(0, 2)
    .map((move) => ({
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

class ComputingWorker extends TestWorker {
  postMessage(request: CandidateRequest) {
    super.postMessage(request);
    queueMicrotask(() => this.finish());
  }
}

const makeComputingWorker = () => new ComputingWorker() as unknown as Worker;

test("parallel board bingo jobs match serial odds with common draws", async () => {
  const moves = choices.slice(0, 4);
  const bagSize = unseenTiles(position, template).total - template.rackSize;
  const expected = checkBoardBingo(
    lexicon,
    position,
    template,
    moves,
    bagSize,
    undefined,
    randomGenerator(100),
  );
  const drawsFor = prepareBoardBingo(
    position,
    template,
    moves.length,
    bagSize,
    randomGenerator(100),
  );
  const actual = Object.create(null);
  await runCandidateJobs(
    lexicon,
    moves.map((move) => ({
      kind: "board-bingo",
      board: position.board,
      template,
      move,
      draws: drawsFor(move),
      deadline: Infinity,
      wavesRemaining: 1,
    })),
    (job, result) => {
      assert.equal(result.kind, "board-bingo");
      actual[job.move.id] = result.odds;
    },
    2,
    makeComputingWorker,
  );
  assert.deepEqual(actual, expected.byMove);
});

test("Optimal Exchange uses the same screening draws and finalists across reusable workers", async () => {
  const words = ["ATT", "TAT", "TA", "AT", "VAT", "TAV"];
  const lexicon = new Lexicon(words);
  const request = {
    board: emptyBoard(15),
    rack: "AVV",
    bag: 7,
    template: {
      ...template,
      rackSize: 3,
      tileCounts: Object.fromEntries(
        Object.keys(template.tileCounts!).map((tile) => [
          tile,
          tile === "A"
            ? 1
            : tile === "V"
              ? 2
              : tile === "T"
                ? 5
                : tile === "E"
                  ? 5
                  : 0,
        ]),
      ),
    },
  };
  const expected = optimizeExchange(
    lexicon,
    new RackBingoIndex(words),
    request,
  );
  const workers: ComputingWorker[] = [];
  const progress: number[] = [];
  const result = await parallelOptimalExchange(
    lexicon,
    new RackBingoIndex(words),
    request,
    (completed) => progress.push(completed),
    2,
    () => {
      const worker = new ComputingWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    },
  );
  assert.deepEqual(result, expected);
  assert.equal(result.refinementDraws, 1200);
  assert.deepEqual(
    progress,
    [...progress].sort((a, b) => a - b),
  );
  assert.equal(workers.length, 2);
  assert.ok(
    workers.every(
      (worker) =>
        worker.stopped &&
        worker.requests.length > 1 &&
        worker.requests.filter(({ dictionary }) => dictionary).length === 1,
    ),
  );
});

test("policy turn jobs return the serial result and skip work after the batch deadline", async () => {
  const moves = choices.slice(0, 2);
  const inputs = moves.map((move) => ({
    position: { board: position.board, tiles: move.tiles },
    template,
    word: move.word,
  }));
  const completed = new Map();
  await runCandidateJobs(
    lexicon,
    inputs.map((input, i) => ({
      kind: "policy-turn",
      key: String(i),
      input,
      deadline: i === 0 ? Infinity : performance.timeOrigin,
    })),
    (job, result) => {
      assert.equal(result.kind, "policy-turn");
      completed.set(job.key, result.policy);
    },
    2,
    makeComputingWorker,
  );
  assert.deepEqual(
    completed.get("0"),
    analyzeOpponentPolicy(lexicon, inputs[0], { maxMs: 1250 }),
  );
  assert.ok(completed.has("1"));
  assert.equal(completed.get("1"), undefined);
});
