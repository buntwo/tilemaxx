import { readFileSync, existsSync } from "node:fs";
import { Lexicon, parseWords } from "../shared/lexicon";
import { solve } from "../shared/solver";
import { analyzeMoves, placeTiles } from "../shared/move-analysis";
import { PRESETS } from "../shared/presets";
import { emptyBoard } from "../shared/model";
import { getTileCounts } from "../shared/tile-pool";

const source = existsSync("data/dictionaries/WOW24.txt")
  ? "data/dictionaries/WOW24.txt"
  : "public/dictionaries/wordnik.txt";
const start = performance.now();
const dict = new Lexicon(parseWords(readFileSync(source, "utf8")));
console.log(
  `${source} · ${dict.count.toLocaleString()} words · ${Math.round(performance.now() - start)} ms to index`,
);
const template = PRESETS[0];
function medianMs<T>(run: () => T, iterations: number) {
  run(); // Warm the trie and the engine before timing.
  const timings: number[] = [];
  let result!: T;
  for (let i = 0; i < iterations; i++) {
    const now = performance.now();
    result = run();
    timings.push(performance.now() - now);
  }
  timings.sort((a, b) => a - b);
  return { result, ms: timings[Math.floor(timings.length / 2)] };
}

let seed = 18649;
const bag = Object.entries(getTileCounts(template)).flatMap(([letter, count]) =>
  Array<string>(count).fill(letter),
);
for (let i = bag.length - 1; i > 0; i--) {
  seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
  const j = Math.floor((seed / 2 ** 32) * (i + 1));
  [bag[i], bag[j]] = [bag[j], bag[i]];
}
let board = emptyBoard(template.size);
const racks = [bag.splice(0, 7).join(""), bag.splice(0, 7).join("")];
for (let turn = 0; turn < 8; turn++) {
  const player = turn % 2;
  const [move] = solve(dict, board, racks[player], template);
  if (!move) continue;
  board = placeTiles(board, move);
  racks[player] = move.leave + bag.splice(0, move.tiles.length).join("");
}
for (const [name, position, rack] of [
  ["Opening", emptyBoard(15), "RETAINS"],
  ["One blank", emptyBoard(15), "AEIRST?"],
  ["Two blanks", emptyBoard(15), "AEIRS??"],
  ["Midgame", board, racks[0]],
] as const) {
  const { result: moves, ms } = medianMs(
    () => solve(dict, position, rack, template),
    9,
  );
  console.log(
    `${name}: ${moves.length.toLocaleString()} moves · ${ms.toFixed(1)} ms median · best ${moves[0]?.word} ${moves[0]?.score}`,
  );
}

const moves = solve(dict, board, racks[0], template);
const alternatives = [
  moves[0],
  moves.find((move) => move.id !== moves[0].id && move.tiles.length <= 2),
];
const familiar = new Set(
  parseWords(readFileSync("public/dictionaries/moby-frequent.txt", "utf8")),
);
const { result, ms } = medianMs(
  () =>
    analyzeMoves(
      dict,
      {
        board,
        rack: racks[0],
        template,
        candidates: alternatives.filter((move) => move !== undefined),
        bagSize: bag.length,
        trials: 200,
        seed: 98765,
      },
      familiar,
      undefined,
      60_000,
    ),
  5,
);
console.log(
  `Analysis: ${result.trials} paired scenarios · ${result.forecasts.length} plays · ${ms.toFixed(1)} ms median (${board.filter(Boolean).length} tiles on board)`,
);
