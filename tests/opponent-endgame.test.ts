import assert from "node:assert/strict";
import { test } from "node:test";
import { endgameAfterRefill } from "../shared/endgame-refill";
import { Lexicon } from "../shared/lexicon";
import { undo } from "../shared/model";
import { opponentEndgameLine } from "../shared/reply-analysis";
import { solve } from "../shared/solver";
import {
  createCandidateAnalyzer,
  type CandidateRequest,
  type CandidateResult,
} from "../src/candidate-analysis-jobs";
import { parallelOpponentEndgame } from "../src/parallel-opponent-endgame";
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
  assert.deepEqual(serial, result);
  const exhausted = await parallelOpponentEndgame(
    lexicon,
    position,
    1,
    () => undefined,
    undefined,
    0,
  );
  assert.deepEqual(exhausted, { checked: 0, total: roots.length, lines: [] });
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
