import { test } from "node:test";
import assert from "node:assert/strict";
import { Lexicon, parseWords } from "../shared/lexicon";
import {
  BIG_REPLY_SCORE,
  inspectBoard,
  prepareSolver,
  createSolverFactory,
  solve,
  solvePosition,
  solvePositionWithBaseline,
} from "../shared/solver";
import { PRESETS } from "../shared/presets";
import { scorePlacement } from "../shared/game-scoring";
import {
  emptyBoard,
  type BoardTemplate,
  type Game,
  applyMove,
  undo,
  redo,
  tileScore,
} from "../shared/model";

const lex = (words: string) =>
  new Lexicon(parseWords(words.split(" ").join("\n")));

test("solver factories match independent board preparation across every preset", () => {
  const dictionary = lex("AT CAT CATS ACT RAT ART TAR READING READINGS");
  for (const template of PRESETS) {
    const prepare = createSolverFactory(dictionary, template);
    const board = emptyBoard(template.size);
    for (const tile of ["", "a", "A", "Z"]) {
      board[template.start] = tile;
      for (const rack of ["CATS?", "READING", "READINGS"].filter(
        (rack) => rack.length <= template.rackSize,
      )) {
        const expected = prepareSolver(dictionary, board, template);
        const actual = prepare(board);
        assert.deepEqual(actual.solve(rack), expected.solve(rack));
        assert.deepEqual(actual.summarize(rack), expected.summarize(rack));
        assert.equal(actual.bestScore(rack), expected.bestScore(rack));
      }
    }
  }
});

test("solver factories capture the layout and do not retain mutable board inputs", () => {
  const dictionary = lex("AT READING READINGS");
  const template = structuredClone(
    PRESETS.find((t) => t.rules === "lexulous")!,
  );
  const original = structuredClone(template);
  const prepare = createSolverFactory(dictionary, template);
  const board = emptyBoard(template.size);
  const compiled = prepare(board);
  const expected = compiled.solve("READINGS");
  assert.ok(expected.length);
  board[template.start] = "Z";
  template.premiums.fill("QW");
  template.start = 0;
  template.rules = "wwf";
  template.bingo = 100;
  template.additionalBonuses = { 7: 90 };
  assert.deepEqual(compiled.solve("READINGS"), expected);
  assert.deepEqual(
    prepare(emptyBoard(template.size)).solve("READINGS"),
    expected,
  );
  assert.deepEqual(
    prepare(board).solve("AT"),
    solve(dictionary, board, "AT", original),
  );
  assert.deepEqual(
    createSolverFactory(
      dictionary,
      template,
    )(emptyBoard(template.size)).solve("READINGS"),
    solve(dictionary, emptyBoard(template.size), "READINGS", template),
  );
  assert.throws(() => prepare(emptyBoard(5)), /board size/);
});

test("cross-check reuse includes impossible words and is isolated by dictionary", (t) => {
  const dictionary = lex("AT CAT");
  const cross = t.mock.method(dictionary, "crossMask");
  const prepare = createSolverFactory(dictionary, PRESETS[0]);
  const board = emptyBoard(15);
  for (const tile of ["A", "Z"]) {
    board[112] = tile;
    const expected = prepare(board).solve("AT");
    const calls = cross.mock.callCount();
    assert.ok(calls > 0);
    assert.deepEqual(prepare([...board]).solve("AT"), expected);
    assert.equal(cross.mock.callCount(), calls);
  }
  const other = lex("ZA");
  assert.deepEqual(prepare(board).solve("A"), []);
  assert.ok(createSolverFactory(other, PRESETS[0])(board).solve("A").length);
});

test("cross-check eviction recomputes old entries without changing legal moves", (t) => {
  const dictionary = lex("AAAAA AAAAB");
  const cross = t.mock.method(dictionary, "crossMask");
  const template = {
    ...PRESETS[0],
    size: 5,
    start: 12,
    premiums: Array<"">(25).fill(""),
  };
  const prepare = createSolverFactory(dictionary, template);
  const board = emptyBoard(5);
  board.splice(0, 4, "A", "A", "A", "A");
  const expected = prepare(board).solve("AB");
  assert.ok(expected.length);
  for (let i = 1; i <= 4_096; i++) {
    let code = i;
    const next = [...board];
    for (let cell = 0; cell < 4; cell++) {
      next[cell] = String.fromCharCode(65 + (code % 26));
      code = Math.floor(code / 26);
    }
    prepare(next);
  }
  const calls = cross.mock.callCount();
  assert.deepEqual(prepare(board).solve("AB"), expected);
  assert.ok(cross.mock.callCount() > calls);
});

test("required tiles filter moves by newly placed physical copies, including a blank", () => {
  const template = PRESETS[0];
  const board = emptyBoard(template.size);
  board[template.start] = "A";
  const dictionary = lex("AT CAT TACT AA AAT AAA AAAT AAAA CAAA");
  const position = { board, rack: "AAA?TC", excludedRackSlots: [0] };
  const all = solvePosition(dictionary, position, template);
  const required = solvePosition(
    dictionary,
    { ...position, requiredRackSlots: [1, 2, 3] },
    template,
  );
  const exact = all.filter(({ tiles }) =>
    tiles.filter(({ letter }) => letter === "A").length === 2 &&
    tiles.some(({ letter }) => letter === letter.toLowerCase()),
  );
  assert.ok(exact.length > 0 && exact.length < all.length);
  assert.deepEqual(required, exact);
  assert.ok(required.every(({ leave }) => leave.includes("A")));

  const noMatches = solvePosition(
    lex("AT"),
    { ...position, requiredRackSlots: [1, 2, 3] },
    template,
    { maxMoves: 0 },
  );
  assert.deepEqual(noMatches, []);
});

test("points baseline uses the full rack for required and excluded tiles", () => {
  const template = PRESETS[0];
  const position = { board: emptyBoard(template.size), rack: "CATSDOG" };
  const dictionary = lex("CAT CATS DOG");
  const unmarked = solvePositionWithBaseline(dictionary, position, template);
  assert.equal(unmarked.topScore, unmarked.moves[0].score);
  assert.equal(unmarked.moves[0].word, "CATS");

  for (const marks of [
    { requiredRackSlots: [4] },
    { excludedRackSlots: [3] },
    { requiredRackSlots: [4], excludedRackSlots: [3] },
  ]) {
    const marked = { ...position, ...marks };
    const result = solvePositionWithBaseline(dictionary, marked, template);
    assert.deepEqual(result.moves, solvePosition(dictionary, marked, template));
    assert.ok(result.moves[0].score < unmarked.topScore!);
    assert.equal(result.topScore, unmarked.topScore);
  }
});

test("a bounded full-rack search can leave the points baseline unavailable", () => {
  const template = PRESETS[0];
  const position = {
    board: emptyBoard(template.size),
    rack: "CATS",
    excludedRackSlots: [3],
  };
  const result = solvePositionWithBaseline(
    lex("CAT CATS"), position, template, { maxMoves: 6 },
  );
  assert.equal(result.moves.length, 6);
  assert.equal(result.topScore, null);
});

test("variant boards apply their own premiums, letter values, and opening bonuses", () => {
  for (const [id, layout, corner, start, word, faceScore] of [
    ["wordfeud", [24, 20, 12, 8], "TL", "", "JUG", 15],
    ["crossplay", [20, 20, 8, 8], "TL", "", "VOW", 17],
    ["lexulous", [24, 8, 17, 8], "TW", "DW", "QUA", 14],
  ] as const) {
    const template = PRESETS.find((preset) => preset.id === id)!;
    assert.equal(template.premiums[0], corner);
    assert.equal(template.premiums[template.start], start);
    assert.deepEqual(
      ["DL", "TL", "DW", "TW"].map(
        (premium) =>
          template.premiums.filter((cell) => cell === premium).length,
      ),
      layout,
    );
    const base = emptyBoard(15);
    const move = solve(lex(word), base, word, template).find(
      (move) => move.row === 7 && move.col === 7 && move.direction === "across",
    )!;
    const board = [...base];
    for (const { index, letter } of move.tiles) board[index] = letter;
    const score = faceScore * (start === "DW" ? 2 : 1);
    assert.equal(move.score, score);
    assert.equal(scorePlacement(base, board, template)?.score, score);
  }
});

test("Lexulous finds and scores seven- and eight-tile bingos", () => {
  const template = PRESETS.find(({ id }) => id === "lexulous")!;
  const base = emptyBoard(15);
  const solver = prepareSolver(lex("PAINTER PAINTERS"), base, template);
  assert.ok(solver.solve("PAINTER", {}, { bingoOnly: true }).length);
  assert.equal(solver.summarize("PAINTER").bingo, true);
  const moves = solver.solve("PAINTERS");
  for (const [word, bonus] of [
    ["PAINTER", 40],
    ["PAINTERS", 50],
  ] as const) {
    const move = moves.find((move) => move.word === word)!;
    const board = [...base];
    for (const { index, letter } of move.tiles) board[index] = letter;
    const breakdown = scorePlacement(base, board, template)!;
    assert.equal(breakdown.bonus, bonus);
    assert.equal(breakdown.bingo, true);
    assert.equal(breakdown.score, move.score);
  }
});

test("custom bonuses apply once to exact counts of newly placed tiles", () => {
  const template = {
    ...PRESETS[0],
    rackSize: 5,
    bingo: 30,
    additionalBonuses: { 1: 5, 3: 20 },
  };
  const base = emptyBoard(template.size);
  base[template.start] = "A";
  const solver = prepareSolver(lex("AT TATE LATER"), base, template);
  const moves = solver.solve("TTELR");
  for (const [word, tiles, bonus] of [
    ["AT", 1, 5],
    ["TATE", 3, 20],
    ["LATER", 4, 0],
  ] as const) {
    const move = moves.find((move) => move.word === word)!;
    const board = [...base];
    for (const { index, letter } of move.tiles) board[index] = letter;
    const breakdown = scorePlacement(base, board, template)!;
    assert.equal(move.tiles.length, tiles);
    assert.equal(breakdown.bonus, bonus);
    assert.equal(breakdown.bingo, bonus > 0);
    assert.equal(breakdown.score, move.score);
  }
  const gap = prepareSolver(lex("LATER"), base, template);
  assert.equal(gap.summarize("TELR").bingo, false);
  assert.deepEqual(gap.solve("TELR", {}, { bingoOnly: true }), []);
});

test("legacy Lexulous snapshots retain their bonus and an explicit empty table removes it", () => {
  const preset = PRESETS.find(({ id }) => id === "lexulous")!;
  const board = emptyBoard(preset.size);
  const dictionary = lex("PAINTER");
  const solveWith = (template: BoardTemplate) =>
    prepareSolver(dictionary, board, template).solve("PAINTER")[0].score;
  assert.equal(
    solveWith({ ...preset, additionalBonuses: undefined }),
    solveWith(preset),
  );
  assert.equal(
    solveWith({ ...preset, additionalBonuses: {} }),
    solveWith(preset) - 40,
  );
});
test("opening moves cover the center, apply DW and do not invent letters", () => {
  const t = PRESETS[0],
    moves = solve(lex("CAT AT ACT TAC DOG"), emptyBoard(15), "CAT", t);
  assert.equal(moves.length, 22); // three 3-letter words × 6, AT × 4
  assert.ok(moves.every((m) => m.tiles.some((t) => t.index === 112)));
  assert.equal(moves.find((m) => m.word === "CAT")!.score, 10);
  assert.ok(moves.every((m) => m.word !== "DOG"));
});
test("blanks stay zero, all blank assignments are considered, and the rack is consumed correctly", () => {
  const t = {
      ...PRESETS[0],
      premiums: PRESETS[0].premiums.map(() => "" as const),
    },
    board = emptyBoard(15);
  const moves = solve(lex("AA AB"), board, "A?", t);
  const aa = moves.filter(
    (m) =>
      m.word === "AA" && m.row === 7 && m.col === 7 && m.direction === "across",
  );
  assert.equal(aa.length, 2);
  assert.ok(aa.every((m) => m.score === 1 && m.blanks === 1 && m.leave === ""));
  assert.equal(solve(lex("ZZ"), board, "??", t)[0].score, 0);
});
test("cross words score with premiums on new tiles only, old blanks remain zero", () => {
  const t: BoardTemplate = {
    id: "test",
    name: "Test",
    size: 5,
    start: 12,
    premiums: Array(25).fill(""),
    rackSize: 7,
    bingo: 50,
    rules: "scrabble",
  };
  const board = emptyBoard(5);
  board[6] = "C";
  board[7] = "A";
  board[8] = "T";
  t.premiums[11] = "DL";
  const move = solve(lex("CAT AT CA AA TT"), board, "AT", t).find(
    (m) =>
      m.row === 2 && m.col === 1 && m.word === "AT" && m.direction === "across",
  );
  assert.ok(move);
  assert.equal(move.score, 10); // AT=3, CA=5, AT=2
  board[6] = "c";
  assert.equal(
    solve(lex("CAT AT CA AA TT"), board, "AT", t).find((m) => m.id === move.id)!
      .score,
    7,
  );
  assert.ok(
    !solve(lex("CAT AT"), board, "AT", t).some((m) => m.id === move.id),
  );
});
test("seven-tile bonuses and WWF center rules differ", () => {
  const dict = lex("RETAINS");
  assert.equal(
    solve(dict, emptyBoard(15), "RETAINS", PRESETS[0]).find(
      (m) => m.row === 7 && m.col === 7,
    )!.score,
    66,
  ); // double letter at L8 + center DW
  const wwf = solve(dict, emptyBoard(15), "RETAINS", PRESETS[1]).find(
    (m) => m.row === 7 && m.col === 7,
  )!;
  assert.equal(wwf.score, 53); // N=2, a DL and a DW along this placement
});
test("layout facts: standard premiums, WWF neutral start, Super quadruple squares", () => {
  const counts = (t: BoardTemplate, p: string) =>
    t.premiums.filter((x) => x === p).length;
  assert.deepEqual(
    ["TW", "DW", "TL", "DL"].map((p) => counts(PRESETS[0], p)),
    [8, 17, 12, 24],
  );
  assert.equal(PRESETS[1].premiums[112], "");
  assert.equal(PRESETS[1].bingo, 35);
  assert.equal(PRESETS[2].size, 21);
  assert.equal(counts(PRESETS[2], "QW"), 4);
  assert.equal(counts(PRESETS[2], "QL"), 8);
});
test("play, undo, and redo preserve blank identity and both board and rack", () => {
  const game: Game = {
    id: "g",
    profileId: "p",
    name: "test",
    board: emptyBoard(15),
    rack: "C?T",
    template: PRESETS[0],
    dictionaryId: "test",
    past: [],
    future: [],
    revision: 0,
    updatedAt: "",
    archived: false,
  };
  const move = solve(lex("CAT"), game.board, game.rack, game.template)[0],
    played = applyMove(game, move);
  assert.equal(played.rack, "");
  assert.equal(
    played.board.filter((c) => c && c === c.toLowerCase()).length,
    1,
  );
  const restored = undo(played);
  assert.deepEqual(restored.board, game.board);
  assert.equal(restored.rack, "C?T");
  assert.deepEqual(redo(restored).board, played.board);
});
test("board warnings identify disconnected tiles and invalid words", () => {
  const b = emptyBoard(15);
  b[0] = "Z";
  b[112] = "C";
  b[113] = "A";
  b[114] = "T";
  const warnings = inspectBoard(lex("AT"), b, PRESETS[0]);
  assert.ok(warnings.some((x) => x.includes("disconnected")));
  assert.ok(warnings.some((x) => x.includes("CAT")));
});
test("dictionary parser strips quotes, normalizes, deduplicates, rejects headers", () => {
  assert.deepEqual(parseWords('"cat"\r\nAT\nCAT\n123\nA\nDOG definition'), [
    "AT",
    "CAT",
    "DOG",
  ]);
  const l = lex("AT CAT CATS");
  assert.ok(l.has("cats"));
  assert.ok(!l.has("CA"));
  assert.ok(!l.has("ATX"));
});

// Independent exhaustive oracle over a small alphabet, not a second trie traversal.
function brute(
  words: string[],
  board: string[],
  rack: string,
  t: BoardTemplate,
) {
  const out = new Map<string, number>(),
    n = t.size,
    dict = new Set(words),
    isEmpty = !board.some(Boolean);
  for (const word of words)
    for (const down of [false, true])
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++) {
          const step = down ? n : 1,
            first = r * n + c;
          if ((down ? r : c) + word.length > n) continue;
          if ((down ? r : c) > 0 && board[first - step]) continue;
          const end = first + step * word.length;
          if ((down ? r : c) + word.length < n && board[end]) continue;
          const news: { index: number; char: string }[] = [];
          let okay = true;
          for (let k = 0; k < word.length; k++) {
            const i = first + k * step;
            if (board[i]) {
              if (board[i].toUpperCase() !== word[k]) okay = false;
            } else news.push({ index: i, char: word[k] });
          }
          if (!okay || !news.length || news.length > rack.length) continue;
          if (isEmpty && !news.some((x) => x.index === t.start)) continue;
          if (
            !isEmpty &&
            !news.some(({ index: i }) => {
              const rr = Math.floor(i / n),
                cc = i % n;
              return (
                (rr && board[i - n]) ||
                (rr < n - 1 && board[i + n]) ||
                (cc && board[i - 1]) ||
                (cc < n - 1 && board[i + 1])
              );
            })
          )
            continue;
          function assign(
            k: number,
            left: string,
            placed: { index: number; letter: string }[],
          ) {
            if (k < news.length) {
              const { index, char } = news[k];
              for (const blank of [false, true]) {
                const used = blank ? "?" : char,
                  p = left.indexOf(used);
                if (p >= 0)
                  assign(k + 1, left.slice(0, p) + left.slice(p + 1), [
                    ...placed,
                    { index, letter: blank ? char.toLowerCase() : char },
                  ]);
              }
              return;
            }
            const all = [...board];
            for (const p of placed) all[p.index] = p.letter;
            let score = 0;
            const newSet = new Set(placed.map((p) => p.index));
            function scoreWord(indices: number[]) {
              let total = 0,
                mult = 1;
              for (const i of indices) {
                const fresh = newSet.has(i),
                  bonus = t.premiums[i],
                  lm = fresh
                    ? ({ DL: 2, TL: 3, QL: 4 } as Record<string, number>)[
                        bonus
                      ] || 1
                    : 1;
                total += tileScore(all[i], t.rules) * lm;
                if (fresh)
                  mult *=
                    ({ DW: 2, TW: 3, QW: 4 } as Record<string, number>)[
                      bonus
                    ] || 1;
              }
              return total * mult;
            }
            score += scoreWord(
              Array.from({ length: word.length }, (_, k) => first + k * step),
            );
            for (const p of placed) {
              const crossStep = down ? 1 : n,
                pos = down ? p.index % n : Math.floor(p.index / n);
              let before = pos,
                after = pos;
              while (
                before > 0 &&
                all[p.index - (pos - before + 1) * crossStep]
              )
                before--;
              while (
                after < n - 1 &&
                all[p.index + (after - pos + 1) * crossStep]
              )
                after++;
              if (after > before) {
                const indices = Array.from(
                  { length: after - before + 1 },
                  (_, k) => p.index + (before + k - pos) * crossStep,
                );
                const cross = indices.map((i) => all[i].toUpperCase()).join("");
                if (!dict.has(cross)) return;
                score += scoreWord(indices);
              }
            }
            if (placed.length === t.rackSize) score += t.bingo;
            out.set(
              placed
                .map((p) => `${p.index}:${p.letter}`)
                .sort()
                .join(","),
              score,
            );
          }
          assign(0, rack, []);
        }
  return out;
}
test("legal placements, best scores, and tied strong replies match exhaustive enumeration", () => {
  let seed = 301;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const candidates: string[] = [];
  for (const a of "ABC")
    for (const b of "ABC") {
      candidates.push(a + b);
      for (const c of "ABC") candidates.push(a + b + c);
    }
  for (let trial = 0; trial < 30; trial++) {
    const words = candidates.filter(() => random() > 0.3),
      dict = new Lexicon(words),
      t: BoardTemplate = {
        id: "test",
        name: "Test",
        size: 5,
        start: 12,
        rackSize: 3,
        bingo: 15,
        rules: trial % 2 ? "wwf" : "scrabble",
        premiums: Array.from(
          { length: 25 },
          () =>
            ["", "DL", "DW", "TL", "TW", "QL", "QW"][
              Math.floor(random() * 7)
            ] as BoardTemplate["premiums"][number],
        ),
      },
      b = emptyBoard(5);
    if (trial % 3) {
      const base = words.find((w) => w.length === 3)!;
      for (let k = 0; k < 3; k++)
        b[11 + k] = random() > 0.2 ? base[k] : base[k].toLowerCase();
    }
    const rack = Array.from(
      { length: 3 },
      () => "ABC?"[Math.floor(random() * 4)],
    ).join("");
    const expected = brute(words, b, rack, t),
      actual = new Map(solve(dict, b, rack, t).map((m) => [m.id, m.score]));
    assert.deepEqual(actual, expected, `Trial ${trial}, rack ${rack}`);
    const prepared = prepareSolver(dict, b, t);
    const bingo = [...expected.keys()].some(
      (id) => id.split(",").length === t.rackSize,
    );
    const score = Math.max(0, ...expected.values());
    assert.deepEqual(prepared.summarize(rack), {
      score,
      bingo,
    });
    assert.equal(prepared.bestScore(rack), score, `Trial ${trial}, rack ${rack}`);
    const reply = prepared.summarizeReply(rack);
    assert.equal(reply.score, score);
    assert.deepEqual(
      new Map(reply.bigReplies.map(({ score, tiles }) => [
        tiles.map(({ index, letter }) => `${index}:${letter}`).sort().join(","),
        score,
      ])),
      new Map([...expected].filter(([, points]) =>
        points === score && score >= BIG_REPLY_SCORE
      )),
    );
    assert.equal(
      prepared.solve(rack, {}, { bingoOnly: true }).length,
      Number(bingo),
    );
  }
});

test("starting with high score ceilings finds the exact blank-heavy reply within a small node budget", () => {
  const words = Array.from({ length: 4 ** 6 }, (_, index) =>
    index.toString(4).padStart(6, "0").replace(/[0-3]/g, (digit) => "ABCD"[+digit]),
  );
  const template: BoardTemplate = {
    ...PRESETS[0],
    additionalBonuses: { 5: 60 },
  };
  const board = emptyBoard(15);
  board[template.start] = "A";
  const solver = prepareSolver(new Lexicon(words), board, template);
  const rack = "???????";
  const score = solver.summarize(rack).score;
  assert.equal(score, 61);
  const limits = { maxNodes: 200 };
  assert.throws(() => solver.summarize(rack, limits), {
    name: "SearchLimitError",
    reason: "nodes",
  });
  assert.equal(solver.bestScore(rack, limits), score);
  for (const nextRack of ["B??????", "C??????", "??", rack]) {
    assert.equal(solver.bestScore(nextRack), solver.summarize(nextRack).score);
  }
  assert.equal(solver.bestScore(rack, limits), score);
});

test("blank-heavy searches stop at work, result and time budgets instead of returning partial moves", () => {
  const dict = lex(
    "AT CAT ACT TAC CATS SCAT CAST DOG DOGS RAT RATS STAR TARS ART ARTS",
  );
  const t = PRESETS[0],
    board = emptyBoard(15);
  for (const limits of [{ maxNodes: 10 }, { maxMoves: 2 }, { maxMs: 0 }]) {
    assert.throws(() => solve(dict, board, "???????", t, limits), {
      name: "SearchLimitError",
    });
  }
  // An interrupted search must not poison its cached lexicon or the next solve.
  assert.equal(solve(lex("CAT AT ACT TAC DOG"), board, "CAT", t).length, 22);
  assert.throws(() => solve(dict, board, "???????????", t), /too many/);
  assert.throws(() => solve(dict, board, "CAT!", t), /invalid/);
});

test("a prepared board can reuse its snapshot across racks and interrupted searches", () => {
  const dict = lex("AT CAT ACT CATS RAT");
  const template = structuredClone(PRESETS[0]);
  const board = emptyBoard(15);
  const prepared = prepareSolver(dict, board, template);
  assert.throws(() => prepared.summarize("???????", { maxMoves: 1 }), {
    name: "SearchLimitError",
  });
  const withBlank = prepared.solve("C.T?");
  assert.ok(withBlank.some((move) => move.word === "CAT" && move.score === 8));
  board[112] = "Z";
  template.premiums[112] = "";
  assert.deepEqual(prepared.solve("C.T?"), withBlank);
  assert.equal(prepared.summarize("CAT").score, 10);
  assert.deepEqual(solve(dict, board, "CAT", template), []);
});

test("empty rack slots never become playable tiles, blanks or bingo bonuses", () => {
  const t = PRESETS[0],
    board = emptyBoard(15),
    words = lex("CAT AT ACT");
  assert.deepEqual(
    solve(words, board, "C.A.T..", t),
    solve(words, board, "CAT", t),
  );
  assert.deepEqual(
    solve(words, board, "C.?.T..", t),
    solve(words, board, "C?T", t),
  );
  assert.deepEqual(solve(words, board, ".......", t), []);
  assert.throws(() => solve(words, board, "C......T", t), /too many/);
  const game: Game = {
    id: "gaps",
    profileId: "p",
    name: "Gaps",
    template: t,
    dictionaryId: "test",
    board,
    rack: "C.A.T..",
    past: [],
    future: [],
    revision: 0,
    updatedAt: "",
    archived: false,
  };
  const played = applyMove(
    game,
    solve(words, board, game.rack, t).find((m) => m.word === "CAT")!,
  );
  assert.equal(played.rack, "");
  assert.equal(undo(played).rack, "C.A.T..");
});

test("anchor prefixes preserve premium scores, blanks, edge plays and unique placements", () => {
  const words = [
    "AB",
    "BA",
    "AC",
    "CA",
    "BC",
    "CB",
    "ABC",
    "BAC",
    "CAB",
    "ABCAB",
    "ABCA",
    "CABA",
  ];
  const dict = new Lexicon(words);
  const template: BoardTemplate = {
    ...PRESETS[0],
    size: 5,
    start: 12,
    rackSize: 3,
    bingo: 15,
    premiums: Array(25).fill(""),
  };
  template.premiums[11] = "TW";
  template.premiums[12] = "DL";
  template.premiums[6] = "QW";
  for (const fixed of [
    [[13, "C"]],
    [
      [11, "A"],
      [12, "b"],
    ],
    [
      [1, "A"],
      [2, "B"],
    ],
    [
      [6, "C"],
      [8, "A"],
      [12, "B"],
    ],
  ] as [number, string][][]) {
    const board = emptyBoard(5);
    for (const [index, tile] of fixed) board[index] = tile;
    for (const rack of ["AB?", "A??", "ABC"]) {
      const expected = brute(words, board, rack, template);
      const solver = prepareSolver(dict, board, template);
      const moves = solver.solve(rack);
      assert.equal(new Set(moves.map((m) => m.id)).size, moves.length);
      assert.deepEqual(new Map(moves.map((m) => [m.id, m.score])), expected);
      const counts = Array<number>(27).fill(0);
      for (const tile of rack)
        counts[tile === "?" ? 26 : tile.charCodeAt(0) - 65]++;
      const targets = new Set([6, 11, 12]);
      const replies = solver.premiumReplies(counts, targets, {});
      for (const target of targets) {
        const scores = moves
          .filter((m) => m.tiles.some((t) => t.index === target))
          .map((m) => m.score);
        assert.equal(
          replies.get(target)?.score,
          scores.length ? Math.max(...scores) : undefined,
        );
      }
    }
  }
});
