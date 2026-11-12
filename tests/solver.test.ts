import { test } from "node:test";
import assert from "node:assert/strict";
import { Lexicon, parseWords } from "../shared/lexicon";
import { solve, inspectBoard } from "../shared/solver";
import { PRESETS } from "../shared/presets";
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
test("all legal placements and scores match exhaustive enumeration across 30 positions", () => {
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
  }
});
