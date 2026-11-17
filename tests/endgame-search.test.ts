import assert from "node:assert/strict";
import { test } from "node:test";
import { Lexicon } from "../shared/lexicon";
import {
  emptyBoard,
  type Board,
  type BoardTemplate,
  type Move,
} from "../shared/model";
import { PRESETS } from "../shared/presets";
import { createSolverFactory, solve } from "../shared/solver";
import { pruneEndgameDictionary } from "../shared/endgame-dictionary";
import { createEndgameSession } from "../shared/endgame-session";
import {
  endgameStreaks,
  rackPoints,
  solveEmptyBag,
  type EndgameLine,
} from "../shared/endgame";

const words = [
  "AA",
  "AB",
  "AC",
  "BA",
  "BB",
  "BC",
  "CA",
  "CB",
  "CC",
  "ABA",
  "ACA",
  "BAB",
  "BAC",
  "CAB",
  "CAC",
  "ABC",
  "BCA",
  "CABS",
];
const lexicon = new Lexicon(words);
function small(preset: BoardTemplate): BoardTemplate {
  return { ...preset, size: 5, start: 12, premiums: Array(25).fill("") };
}
function replay(
  board: Board,
  racks: string[],
  template: BoardTemplate,
  line: EndgameLine,
  prior = 0,
) {
  const scores = [0, 0];
  let ended = false,
    streak = prior;
  for (const [i, move] of line.line.entries()) {
    assert.ok(!ended, "continuation after game end");
    const player = i % 2;
    if (move) {
      assert.deepEqual(
        move,
        solve(lexicon, board, racks[player], template).find(
          (m) => m.id === move.id,
        ),
      );
      scores[player] += move.score;
      racks[player] = move.leave;
      board = [...board];
      for (const t of move.tiles) board[t.index] = t.letter;
      if (!move.leave) {
        const transfer = rackPoints(racks[1 - player], template.rules);
        scores[player] += transfer;
        scores[1 - player] -= transfer;
        ended = true;
      }
    }
    const rule = endgameStreaks[template.rules]!;
    streak = (rule.passesOnly ? move : move?.score) ? 0 : streak + 1;
    if (!ended && streak >= rule.limit) {
      scores[0] -= rackPoints(racks[0], template.rules);
      scores[1] -= rackPoints(racks[1], template.rules);
      ended = true;
    }
  }
  assert.ok(ended, "incomplete optimal line");
  assert.equal(scores[0] - scores[1], line.spread);
  assert.deepEqual(line.points, { you: scores[0], opponent: scores[1] });
}

test("indexed word enumeration survives a worker index transfer", () => {
  assert.deepEqual(
    [...Lexicon.fromIndex(lexicon).words()].sort(),
    [...words].sort(),
  );
});

test("incremental preparation and single-tile paths match full generation across branches and rules", () => {
  let seed = 77;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (const preset of PRESETS) {
    const template = small(preset);
    template.premiums[7] = "TW";
    template.premiums[13] = "DL";
    const prepare = createSolverFactory(lexicon, template, true),
      root = emptyBoard(5);
    root[12] = "a";
    let board = root;
    const ancestors = [root];
    for (let i = 0; i < 25; i++) {
      for (const rack of ["A", "B", "?", "ABC", "AB?BC"]) {
        const expected = solve(
          lexicon,
          board,
          rack,
          template,
          {},
          { unsorted: true },
        );
        assert.deepEqual(
          prepare(board).solve(rack, {}, { unsorted: true }),
          expected,
        );
        if (rack.length === 1)
          assert.deepEqual(prepare.singleMoves(board, rack), expected);
      }
      const choices = solve(lexicon, board, "AB?BC", template);
      if (choices.length) {
        const before = [...board];
        ancestors.push(board);
        board = prepare.place(
          board,
          choices[Math.floor(random() * choices.length)],
        );
        assert.deepEqual(ancestors.at(-1), before);
      }
      if (!choices.length || i % 4 === 3)
        board = ancestors[Math.floor(random() * ancestors.length)];
    }
  }
});

test("dictionary pruning preserves words enabled by future placements and respects its deadline", () => {
  const b = emptyBoard(5);
  b[12] = "A";
  const dictionary = new Lexicon(["AT", "CABS", "XY"]);
  const filtered = pruneEndgameDictionary(dictionary, b, 5, "TCBS", Infinity);
  assert.ok(filtered.has("CABS"));
  assert.ok(filtered.has("AT"));
  assert.equal(filtered.has("XY"), false);
  assert.equal(pruneEndgameDictionary(dictionary, b, 5, "TCBS", 0), dictionary);
  assert.deepEqual(
    [
      ...pruneEndgameDictionary(lexicon, b, 5, "ABC?BC", Infinity).words(),
    ].sort(),
    [
      ...pruneEndgameDictionary(
        Lexicon.fromIndex(lexicon),
        b,
        5,
        "ABC?BC",
        Infinity,
      ).words(),
    ].sort(),
  );
});

test("pruned dictionaries preserve every legal continuation on random consumable-rack games", () => {
  let seed = 117;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (const preset of PRESETS) {
    const template = small(preset),
      root = emptyBoard(5);
    root[12] = "A";
    const filtered = pruneEndgameDictionary(
      lexicon,
      root,
      5,
      "ABC?ABC",
      Infinity,
    );
    for (let trial = 0; trial < 12; trial++) {
      let board = root;
      const racks = ["ABC?", "ABC"];
      for (let turn = 0; turn < 8; turn++) {
        const player = turn % 2,
          expected = solve(lexicon, board, racks[player], template);
        assert.deepEqual(
          solve(filtered, board, racks[player], template),
          expected,
        );
        if (!expected.length) continue;
        const move = expected[Math.floor(random() * expected.length)];
        racks[player] = move.leave;
        if (!move.leave) break;
        board = [...board];
        for (const t of move.tiles) board[t.index] = t.letter;
      }
    }
  }
});

test("session bounds, shallow ordering and reconstructed lines agree with the reference on every scoring ruleset", () => {
  for (const preset of PRESETS.filter((p) => p.rules !== "crossplay")) {
    const template = small(preset),
      root = emptyBoard(5);
    root[12] = "a";
    for (const prior of [0, endgameStreaks[template.rules]!.limit - 1]) {
      for (const [rack, opponent] of [
        ["ABC", "ABC"],
        ["AAB", "BC"],
        ["BC?", "AA"],
        ["?", "BC"],
      ]) {
        const prepare = createSolverFactory(lexicon, template, true);
        const search = (board: Board, rack: string) =>
          rack.length === 1
            ? prepare.singleMoves(board, rack)
            : prepare(board).solve(rack, {}, { unsorted: true });
        const session = createEndgameSession(template, search, prepare.place);
        for (const candidate of solve(lexicon, root, rack, template).slice(
          0,
          3,
        )) {
          const expected = solveEmptyBag(
            root,
            candidate,
            opponent,
            template,
            { scorelessTurns: prior },
            search,
            prepare.place,
            { timeLimitMs: Infinity, positionLimit: Infinity },
          );
          const result = session.run(
            root,
            candidate,
            opponent,
            prior,
            Infinity,
          );
          assert.ok(result.line);
          assert.equal(result.line.spread, expected.spread);
          replay(root, [rack, opponent], template, result.line, prior);
          assert.deepEqual(
            session.run(root, candidate, opponent, prior, Infinity).line,
            result.line,
          );
        }
      }
    }
  }
});

test("interrupted sessions retain completed branches without exposing a horizon estimate as an exact line", () => {
  const template = small(PRESETS.find((p) => p.rules === "lexulous")!),
    root = emptyBoard(5);
  root[12] = "A";
  const candidate = solve(lexicon, root, "ABC?", template).find(
    (m) => m.leave.length >= 2,
  )!;
  assert.ok(candidate);
  const prepare = createSolverFactory(lexicon, template, true),
    search = (board: Board, rack: string) =>
      prepare(board).solve(rack, {}, { unsorted: true });
  const session = createEndgameSession(template, search, prepare.place);
  const interrupted = session.run(root, candidate, "ABCZ", 0, Infinity, 80);
  assert.equal(interrupted.line, undefined);
  assert.equal(interrupted.limited, true);
  assert.ok(session.cachedPositions > 0);
  const hits = session.stats.hits;
  const resumed = session.run(root, candidate, "ABCZ", 0, Infinity);
  assert.ok(resumed.line);
  assert.ok(session.stats.hits > hits);
  replay(root, ["ABC?", "ABCZ"], template, resumed.line);
  const expected = solveEmptyBag(
    root,
    candidate,
    "ABCZ",
    template,
    { scorelessTurns: 0 },
    search,
    prepare.place,
    { timeLimitMs: Infinity, positionLimit: Infinity },
  );
  assert.equal(resumed.line.spread, expected.spread);
});

test("bounded table eviction preserves exact values and timeout checks retain the session", () => {
  const template = small(PRESETS.find((p) => p.rules === "lexulous")!),
    root = emptyBoard(5);
  root[12] = "A";
  const candidate = solve(lexicon, root, "ABC", template).find((m) => m.leave)!;
  const prepare = createSolverFactory(lexicon, template, true),
    search = (board: Board, rack: string) => prepare(board).solve(rack);
  const session = createEndgameSession(template, search, prepare.place, 4);
  assert.equal(session.run(root, candidate, "BC", 0, 0).limited, true);
  const actual = session.run(root, candidate, "BC", 0, Infinity);
  assert.ok(actual.line);
  assert.ok(session.cachedPositions <= 4);
  assert.ok(session.stats.evictions > 0);
  replay(root, ["ABC", "BC"], template, actual.line);
  const reference = solveEmptyBag(
    root,
    candidate,
    "BC",
    template,
    { scorelessTurns: 0 },
    search,
    prepare.place,
    { timeLimitMs: Infinity, positionLimit: Infinity },
  );
  assert.equal(actual.line.spread, reference.spread);
});
