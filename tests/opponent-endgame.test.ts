import assert from "node:assert/strict";
import { test } from "node:test";
import { endgameAfterRefill } from "../shared/endgame-refill";
import { Lexicon } from "../shared/lexicon";
import { undo } from "../shared/model";
import { exactEndgameRoot, opponentEndgameLine, replyEndgameLine } from "../shared/reply-analysis";
import { solve } from "../shared/solver";
import {
  createCandidateAnalyzer,
  type CandidateRequest,
  type CandidateResult,
} from "../src/candidate-analysis-jobs";
import { parallelEndgame, parallelOpponentEndgame } from "../src/parallel-opponent-endgame";
import {
  opponentEndgameWords,
  playBeforeRefill,
} from "./opponent-endgame-fixture";

test("the next turn is the opponent's only after a last draw following our play", () => {
  const played = playBeforeRefill();
  assert.equal(played.rack, "DS");
  assert.equal(endgameAfterRefill(played), undefined);
  const refilled = { ...played, rack: "DSD" };
  assert.deepEqual(endgameAfterRefill(refilled), {
    opponentRack: "AOT",
    scorelessTurns: 0,
  });
  assert.equal(endgameAfterRefill(undo(refilled)), undefined);
  assert.equal(endgameAfterRefill({ ...refilled, rack: "DDA" }), undefined);
  assert.equal(endgameAfterRefill({ ...refilled, past: [] }), undefined);
  const opponentEntry = { ...played.past[0], player: "opponent" as const };
  assert.equal(
    endgameAfterRefill({ ...refilled, past: [opponentEntry] }),
    undefined,
  );
  const manuallyEdited = { ...refilled, board: [...refilled.board] };
  manuallyEdited.board[0] = "O";
  manuallyEdited.past = [
    ...played.past,
    {
      board: refilled.board,
      rack: refilled.rack,
      at: "",
      label: "Entered board letters",
    },
  ];
  assert.equal(endgameAfterRefill(manuallyEdited), undefined);
});

test("the worker pool ranks five exact opponent lines against all plays and passing", async () => {
  const game = { ...playBeforeRefill(), rack: "SDD" };
  const position = { ...game, ...endgameAfterRefill(game)! };
  const lexicon = new Lexicon(opponentEndgameWords);
  const moves = solve(
    lexicon,
    game.board,
    position.opponentRack,
    game.template,
  );
  const roots = [...moves, null];
  const all = roots.map(
    (move) => opponentEndgameLine(lexicon, position, move, 1_000)!,
  );
  const expected = all
    .map(({ spread }) => spread)
    .sort((a, b) => a - b)
    .slice(0, 5);
  assert.ok(moves.length > 5);
  assert.ok(expected[0] < 0);

  let workers = 0;
  let stopped = 0;
  const makeWorker = () => {
    workers++;
    let analyze: ReturnType<typeof createCandidateAnalyzer>;
    const worker = {
      onmessage: undefined as
        | ((event: { data: CandidateResult }) => void)
        | undefined,
      postMessage(request: CandidateRequest) {
        if (request.dictionary)
          analyze = createCandidateAnalyzer(
            Lexicon.fromIndex(request.dictionary),
          );
        queueMicrotask(() =>
          worker.onmessage?.({ data: analyze(request.job) }),
        );
      },
      terminate() {
        stopped++;
      },
    };
    return worker as unknown as Worker;
  };
  const progress: number[] = [];
  const result = await parallelOpponentEndgame(
    lexicon,
    position,
    4,
    ({ checked }) => progress.push(checked),
    makeWorker,
  );
  assert.equal(workers, 4);
  assert.equal(stopped, 4);
  assert.equal(progress[0], 0);
  assert.equal(result.checked, roots.length);
  assert.equal(result.total, roots.length);
  assert.deepEqual(
    result.lines.map(({ spread }) => spread),
    expected,
  );
  for (const line of result.lines) {
    const index = roots.findIndex((move) => move?.id === line.line[0]?.id);
    assert.deepEqual(line, all[index]);
    assert.equal(line.spread, line.points.you - line.points.opponent);
  }

  const serial = await parallelOpponentEndgame(
    lexicon,
    position,
    1,
    () => undefined,
  );
  assert.deepEqual(serial.lines, result.lines);
  assert.equal(serial.checked, result.checked);
  assert.deepEqual(result.batches.map(({ checked }) => checked), [roots.length]);
  const exhausted = await parallelOpponentEndgame(
    lexicon,
    position,
    1,
    () => undefined,
    undefined,
    0,
  );
  assert.deepEqual(exhausted, { checked: 0, total: roots.length, lines: [], batches: [] });
});

test("the same worker pool ranks our openings and skips completed exact roots", async () => {
  const game = { ...playBeforeRefill(), rack: "DSD" };
  const lexicon = new Lexicon(opponentEndgameWords);
  const position = { ...game, ...endgameAfterRefill(game)!, firstPlayer: "you" as const, bagSize: 0 };
  const moves = solve(lexicon, position.board, position.rack, position.template);
  assert.ok(moves.length > 5);
  const exact = moves.map((move) => replyEndgameLine(lexicon, position, move, 1_000));
  const pass = exactEndgameRoot(lexicon, position, null, 1_000)!;
  const expected = [...exact, pass].map(({ spread }) => spread).sort((a, b) => b - a).slice(0, 5);
  const cachedLines = exact.slice(0, 3);
  const queued: (string | undefined)[] = [];
  const createWorker = () => {
    const analyze = createCandidateAnalyzer(lexicon);
    const worker = {
      onmessage: undefined as ((event: { data: CandidateResult }) => void) | undefined,
      postMessage({ job }: CandidateRequest) {
        assert.equal(job.kind, "opponent-endgame");
        queued.push(job.move?.id);
        queueMicrotask(() => worker.onmessage?.({ data: analyze(job) }));
      },
      terminate() {},
    };
    return worker as unknown as Worker;
  };

  const result = await parallelEndgame(lexicon, { ...position, cachedLines }, 2, () => {}, createWorker);
  assert.equal(result.total, moves.length + 1);
  assert.equal(result.checked, result.total);
  assert.equal(queued.length, result.total - cachedLines.length);
  assert.ok(queued.includes(undefined));
  for (const line of cachedLines) assert.ok(!queued.includes(line.line[0]?.id));
  assert.deepEqual(result.lines.map(({ spread }) => spread), expected);
  for (const line of result.lines)
    assert.equal(line.spread, line.points.you - line.points.opponent);

  const serial = await parallelEndgame(lexicon, position, 1, () => {});
  assert.deepEqual(result.lines.map((line) => line.line[0]?.id), serial.lines.map((line) => line.line[0]?.id));
  assert.deepEqual(result.lines.map(({ spread, points }) => [spread, points]), serial.lines.map(({ spread, points }) => [spread, points]));
});

test("our exact solver observes the Crossplay final-turn setting", async () => {
  const game = playBeforeRefill();
  const lexicon = new Lexicon(opponentEndgameWords);
  const position = {
    ...game, template: { ...game.template, rules: "crossplay" as const },
    rack: "DSD", opponentRack: "AOT", scorelessTurns: 0,
    firstPlayer: "you" as const, opponentHasFinalTurn: false,
  };
  const result = await parallelEndgame(lexicon, position, 1, () => {});
  assert.equal(result.checked, result.total);
  assert.ok(result.lines.length);
  for (const line of result.lines) {
    assert.equal(line.line.length, 1);
    assert.deepEqual(line.points, { you: line.line[0]?.score ?? 0, opponent: 0 });
  }
});

test("opponent timing groups every 500 completed options and the last partial batch", async () => {
  const letters = [..."ABCDEFG"];
  const lexicon = new Lexicon(letters.flatMap((a) =>
    letters.flatMap((b) => b === a ? [] :
      letters.flatMap((c) => c === a || c === b ? [] : [a + b + c])),
  ));
  const game = playBeforeRefill();
  const position = {
    ...game,
    board: game.board.map(() => ""),
    rack: "H",
    opponentRack: letters.join(""),
    template: { ...game.template, rackSize: 7 },
    scorelessTurns: 0,
  };
  const makeWorker = () => {
    const worker = {
      onmessage: undefined as ((event: { data: CandidateResult }) => void) | undefined,
      postMessage() {
        queueMicrotask(() => worker.onmessage?.({ data: { kind: "opponent-endgame" } }));
      },
      terminate() {},
    };
    return worker as unknown as Worker;
  };
  const result = await parallelOpponentEndgame(
    lexicon, position, 2, () => undefined, makeWorker,
  );
  assert.equal(result.checked, result.total);
  assert.ok(result.checked > 500 && result.checked % 500 > 0);
  const fullBatches = Array.from({ length: Math.floor(result.checked / 500) }, (_, i) => (i + 1) * 500);
  assert.deepEqual(result.batches.map(({ checked }) => checked), [...fullBatches, result.checked]);
  assert.ok(result.batches.every(({ elapsed }) => elapsed >= 0));
});

test("a cutoff preserves exact ties and a forced pass uses the opponent rack", async () => {
  const game = { ...playBeforeRefill(), rack: "SDD" };
  const position = { ...game, ...endgameAfterRefill(game)! };
  const lexicon = new Lexicon(opponentEndgameWords);
  const move = solve(
    lexicon,
    game.board,
    position.opponentRack,
    game.template,
  ).find(({ leave }) => leave)!;
  const exact = opponentEndgameLine(lexicon, position, move, 1_000)!;
  assert.deepEqual(
    opponentEndgameLine(lexicon, position, move, 1_000, -exact.spread),
    exact,
  );
  assert.equal(
    opponentEndgameLine(lexicon, position, move, 1_000, -exact.spread + 1),
    undefined,
  );

  const noWords = await parallelOpponentEndgame(
    new Lexicon(["ZZ"]),
    position,
    1,
    () => undefined,
  );
  assert.equal(noWords.checked, 1);
  assert.equal(noWords.lines.length, 1);
  assert.deepEqual(noWords.lines[0].line, new Array(6).fill(null));
  assert.deepEqual(noWords.lines[0].points, { you: -5, opponent: -3 });
});
