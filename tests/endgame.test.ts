import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EndgameSearchLimitError,
  rackPoints,
  solveEmptyBag,
  type EndgameLine,
} from "../shared/endgame";
import { Lexicon } from "../shared/lexicon";
import { placeTiles } from "../shared/move-analysis";
import {
  emptyBoard,
  type Board,
  type BoardTemplate,
  type Move,
} from "../shared/model";
import { PRESETS } from "../shared/presets";
import { SearchLimitError, solve, createSolverFactory } from "../shared/solver";

const template = PRESETS[0];
const board = emptyBoard(template.size);
const [candidate] = solve(new Lexicon(["AT"]), board, "ATBCDEF", template);

const smallTemplate = {
  ...template,
  size: 7,
  start: 24,
  premiums: Array<"">(49).fill(""),
};
const smallLexicon = new Lexicon([
  "AN",
  "AS",
  "AT",
  "CAT",
  "CATS",
  "NA",
  "SCAN",
]);
const searchSmall = (board: Board, rack: string) =>
  solve(smallLexicon, board, rack, smallTemplate, {}, { unsorted: true });
interface SmallPosition {
  board: Board;
  racks: [string, string];
  candidate: Move;
  priorScoreless: number;
  template?: BoardTemplate;
}

function smallPosition(
  rack: string,
  opponent: string,
  word: string,
  priorScoreless = 0,
  board = emptyBoard(7),
): SmallPosition {
  const candidate = searchSmall(board, rack).find(
    (move) => move.word === word && move.direction === "across",
  );
  assert.ok(candidate);
  return { board, racks: [rack, opponent], candidate, priorScoreless };
}

// Score every continuation in the first player's perspective, with no pruning
// or cached values. Track different orders of the same moves for the fixture.
function exhaustive(position: SmallPosition) {
  const template = position.template ?? smallTemplate;
  const points = (rack: string) => rackPoints(rack, template.rules);
  const search = (board: Board, rack: string) =>
    solve(smallLexicon, board, rack, template, {}, { unsorted: true });
  const lexulous = template.rules === "lexulous";
  const orders = new Map<string, string>();
  let transposition = false;
  function play(
    board: Board,
    racks: [string, string],
    player: 0 | 1,
    scoreless: number,
    move: Move | null,
    history: string[],
  ): number {
    const sign = player === 0 ? 1 : -1;
    const other = player === 0 ? 1 : 0;
    const score = sign * (move?.score ?? 0);
    if (move && !move.leave) return score + sign * 2 * points(racks[other]);
    if (move) {
      board = placeTiles(board, move);
      racks = [...racks];
      racks[player] = move.leave;
      history = [...history, move.id];
    }
    scoreless = (lexulous ? move : score) ? 0 : scoreless + 1;
    if (scoreless === (lexulous ? 2 : 6))
      return score + points(racks[1]) - points(racks[0]);

    const key = JSON.stringify([
      board,
      racks,
      other,
      scoreless,
      [...history].sort(),
    ]);
    const order = history.join("|");
    const previous = orders.get(key);
    if (previous === undefined) orders.set(key, order);
    else if (previous !== order) transposition = true;
    const replies = [...search(board, racks[other]), null].map((next) =>
      play(board, racks, other, scoreless, next, history),
    );
    return score + (other === 0 ? Math.max(...replies) : Math.min(...replies));
  }
  const spread = play(
    position.board,
    position.racks,
    0,
    position.priorScoreless,
    position.candidate,
    [],
  );
  return { spread, transposition };
}

function replay(position: SmallPosition, result: EndgameLine) {
  const template = position.template ?? smallTemplate;
  const points = (rack: string) => rackPoints(rack, template.rules);
  const lexulous = template.rules === "lexulous";
  assert.equal(result.line[0], position.candidate);
  const racks = [...position.racks];
  let { board, priorScoreless: scoreless } = position;
  const scores = [0, 0];
  let ended = false;
  for (const [turn, move] of result.line.entries()) {
    assert.equal(ended, false, "Line continues after the game ended");
    const player = turn % 2;
    if (move) {
      const legal = solve(smallLexicon, board, racks[player], template).find(
        (option) => option.id === move.id,
      );
      assert.deepEqual(move, legal);
      scores[player] += move.score;
      racks[player] = move.leave;
      board = placeTiles(board, move);
      if (!move.leave) {
        const transfer = points(racks[1 - player]);
        scores[player] += transfer;
        scores[1 - player] -= transfer;
        ended = true;
      }
    }
    scoreless = (lexulous ? move : move?.score) ? 0 : scoreless + 1;
    if (!ended && scoreless === (lexulous ? 2 : 6)) {
      scores[0] -= points(racks[0]);
      scores[1] -= points(racks[1]);
      ended = true;
    }
  }
  assert.equal(ended, true, "Line stops before the game ended");
  assert.equal(scores[0] - scores[1], result.spread);
  assert.deepEqual(result.points, { you: scores[0], opponent: scores[1] });
}

test("pruned endgames agree with exhaustive play and return complete lines", () => {
  const blankBoard = emptyBoard(7);
  blankBoard[24] = "a";
  const fixtures = [
    {
      name: "opening play goes out",
      position: smallPosition("AT", "KQ", "AT"),
      spread: 32,
    },
    {
      name: "opponent goes out",
      position: smallPosition("ATZ", "N", "AT"),
      spread: -20,
    },
    {
      name: "pass before tied plays that go out",
      position: smallPosition("ATN", "ZZ", "AT"),
      spread: 44,
      tied: true,
    },
    {
      name: "six passes",
      position: smallPosition("ATQ", "ZZ", "AT"),
      spread: 12,
    },
    {
      name: "going out with a blank",
      position: smallPosition("AT?", "QZ", "AT"),
      spread: 44,
    },
    {
      name: "zero-point play is the sixth scoreless turn",
      position: smallPosition("?K", "Q", "AT", 5, blankBoard),
      spread: 5,
    },
    {
      name: "different move orders reach the same position",
      position: smallPosition("ATAA", "SCN", "AT"),
      spread: -11,
      transposition: true,
    },
  ];
  for (const { name, position, spread, tied, transposition } of fixtures) {
    const reference = exhaustive(position);
    assert.equal(reference.spread, spread, name);
    if (transposition) assert.equal(reference.transposition, true, name);

    const { board, candidate, racks, priorScoreless } = position;
    if (tied) {
      const continuations = searchSmall(
        placeTiles(board, candidate),
        candidate.leave,
      );
      assert.ok(
        continuations.filter((move) => !move.leave && move.score === 2).length >
          1,
      );
    }
    for (const reverse of [false, true]) {
      const result = solveEmptyBag(
        board,
        candidate,
        racks[1],
        smallTemplate,
        { scorelessTurns: priorScoreless },
        (board, rack) => {
          const moves = searchSmall(board, rack);
          return reverse ? moves.reverse() : moves;
        },
        placeTiles,
        { timeLimitMs: Infinity },
      );
      assert.equal(result.spread, reference.spread, name);
      replay(position, result);
    }
  }
});

test("Lexulous ordering and shared preparation preserve exact scores and complete lines", () => {
  const template = {
    ...PRESETS.find(({ rules }) => rules === "lexulous")!,
    size: 5,
    start: 12,
    premiums: Array<"">(25).fill(""),
  };
  const board = emptyBoard(5);
  board[12] = "a";
  const prepare = createSolverFactory(smallLexicon, template);
  for (const [rack, opponent] of [
    ["ATBCDEFG", "NHIJKLMO"], // Two eight-tile racks, with blocked leftovers.
    ["AT?", "CN"],
    ["?K", "Q"], // A zero-point placement must reset Lexulous's pass streak.
    ["ATN", "ZZ"],
  ]) {
    const candidates = solve(smallLexicon, board, rack, template).slice(0, 3);
    assert.ok(candidates.length);
    for (const candidate of candidates) {
      const position: SmallPosition = {
        board,
        candidate,
        racks: [rack, opponent],
        priorScoreless: 1,
        template,
      };
      const expected = exhaustive(position);
      for (const reverse of [false, true]) {
        const result = solveEmptyBag(
          board,
          candidate,
          opponent,
          template,
          { scorelessTurns: 1 },
          (board, rack) => {
            const moves = prepare(board).solve(rack, {}, { unsorted: true });
            return reverse ? moves.reverse() : moves;
          },
          placeTiles,
          { timeLimitMs: Infinity, positionLimit: Infinity },
        );
        assert.equal(result.spread, expected.spread);
        replay(position, result);
      }
    }
  }
});

test("endgame stops at the variant's pass or scoreless limit", () => {
  const zero = { ...candidate, score: 0, leave: "K" };
  for (const { rules, prior, passes } of [
    { rules: "wwf", prior: 2, passes: 0 },
    { rules: "wordfeud", prior: 2, passes: 3 },
    { rules: "lexulous", prior: 1, passes: 2 },
  ] as const) {
    const line = solveEmptyBag(
      board,
      zero,
      "Q",
      { ...template, rules },
      { scorelessTurns: prior },
      () => [],
      placeTiles,
      { timeLimitMs: Infinity },
    );
    assert.deepEqual(line.line, [zero, ...Array(passes).fill(null)], rules);
    assert.deepEqual(line.points, {
      you: -rackPoints("K", rules),
      opponent: -rackPoints("Q", rules),
    });
    assert.equal(line.spread, line.points.you - line.points.opponent);
  }
});

test("endgame reports the overall deadline, positions visited, and elapsed time", (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  assert.throws(
    () =>
      solveEmptyBag(
        board,
        candidate,
        "TINGLOS",
        template,
        { scorelessTurns: 0 },
        () => {
          now = 500;
          throw new SearchLimitError("time");
        },
        placeTiles,
        { timeLimitMs: 500 },
      ),
    {
      message:
        "Endgame search reached its 500 ms time limit after visiting 1 position (500 ms elapsed).",
    },
  );
});

test("endgame applies both the default and an increased position cap", (t) => {
  t.mock.method(performance, "now", () => 0);
  for (const positionLimit of [undefined, 3_000]) {
    let generated = 0;
    const expected = positionLimit ?? 1_500;
    assert.throws(
      () =>
        solveEmptyBag(
          board,
          candidate,
          "TINGLOS",
          template,
          { scorelessTurns: 0 },
          (position, rack) => {
            generated++;
            const index = position.indexOf("");
            return [..."ABCDE"].map((letter) => ({
              ...candidate,
              tiles: [{ index, letter }],
              leave: rack.slice(1),
            }));
          },
          placeTiles,
          { timeLimitMs: 500, positionLimit },
        ),
      (error) =>
        error instanceof EndgameSearchLimitError &&
        error.message.includes(
          `its position limit after visiting ${expected.toLocaleString()} positions`,
        ),
    );
    assert.equal(generated, expected);
  }
});

test("endgame identifies a single-position move-generation limit", (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  assert.throws(
    () =>
      solveEmptyBag(
        board,
        candidate,
        "TINGLOS",
        template,
        { scorelessTurns: 0 },
        () => {
          now = 2_000;
          throw new SearchLimitError("time");
        },
        placeTiles,
        { timeLimitMs: 2_500 },
      ),
    /2,000 ms move-generation limit at a single position after visiting 1 position/,
  );
});

test("endgame identifies the move generator's node and move caps", (t) => {
  t.mock.method(performance, "now", () => 0);
  for (const [reason, limit] of [
    ["nodes", "2,000,000-node limit"],
    ["moves", "150,000-move limit"],
  ] as const) {
    assert.throws(
      () =>
        solveEmptyBag(
          board,
          candidate,
          "TINGLOS",
          template,
          { scorelessTurns: 0 },
          () => {
            throw new SearchLimitError(reason);
          },
          placeTiles,
          { timeLimitMs: 2_500 },
        ),
      {
        name: "Error",
        message: `Endgame search reached the move generator’s ${limit} at a single position after visiting 1 position (0 ms elapsed).`,
      },
    );
  }
});
