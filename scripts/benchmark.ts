import { readFileSync, existsSync } from "node:fs";
import { Lexicon, parseWords } from "../shared/lexicon";
import { solve } from "../shared/solver";
import { PRESETS } from "../shared/presets";
import { emptyBoard } from "../shared/model";
const source = existsSync("data/dictionaries/CSW24.txt")
  ? "data/dictionaries/CSW24.txt"
  : "public/dictionaries/wordnik.txt";
const start = performance.now(),
  dict = new Lexicon(parseWords(readFileSync(source, "utf8")));
console.log(
  `${dict.count.toLocaleString()} words; index ${Math.round(performance.now() - start)} ms; compact trie ${(dict.first.byteLength * 2 + dict.letters.byteLength * 2) / 1024 / 1024} MiB`,
);
for (const [name, rack, filled] of [
  ["Opening", "RETAINS", false],
  ["One blank", "AEIRST?", false],
  ["Two blanks", "AEIRS??", false],
  ["Midgame", "AEINST?", true],
] as const) {
  const board = emptyBoard(15);
  if (filled) {
    for (const [r, c, w] of [
      [7, 4, "READING"],
      [6, 4, "ORE"],
      [5, 5, "AIR"],
    ] as const)
      for (let k = 0; k < w.length; k++) board[r * 15 + c + k] = w[k];
  }
  const now = performance.now(),
    moves = solve(dict, board, rack, PRESETS[0]);
  console.log(
    `${name}: ${moves.length.toLocaleString()} moves in ${Math.round(performance.now() - now)} ms; best ${moves[0]?.word} ${moves[0]?.score}`,
  );
}
