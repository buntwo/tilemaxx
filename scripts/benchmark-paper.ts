import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as newLex from "../shared/lexicon";
import * as optimized from "../shared/solver";
import { PRESETS } from "../shared/presets";
import {
  emptyBoard,
  type Board,
  type BoardTemplate,
  type Move,
} from "../shared/model";
import { getTileCounts } from "../shared/tile-pool";
import {
  placeTiles,
  randomGenerator,
  sampleTiles,
} from "../shared/move-analysis";

// Pass the shared/ directory from the revision being compared. Keep imported
// dictionaries local; this benchmark prints only aggregate results.
const baselineDirectory = process.argv[2];
if (!baselineDirectory)
  throw new Error(
    "Usage: node --import tsx scripts/benchmark-paper.ts BASELINE_SHARED_DIR [DICTIONARY]",
  );
const load = (name: string) =>
  import(pathToFileURL(resolve(baselineDirectory, name + ".ts")).href);
const oldLex: typeof newLex = await load("lexicon");
const baseline: typeof optimized = await load("solver");
const source = process.argv[3] ?? "data/dictionaries/WOW24.txt";
const words = oldLex.parseWords(readFileSync(source, "utf8"));
function index(Type: typeof newLex.Lexicon) {
  const start = performance.now(),
    dict = new Type(words);
  return {
    dict,
    ms: performance.now() - start,
    bytes:
      dict.first.byteLength +
      dict.mask.byteLength +
      dict.terminal.byteLength +
      dict.maxTail.byteLength,
  };
}
const original = index(oldLex.Lexicon),
  compact = index(newLex.Lexicon);
console.log(
  JSON.stringify({
    index: {
      trie: { ms: original.ms, bytes: original.bytes },
      dawg: { ms: compact.ms, bytes: compact.bytes },
    },
  }),
);
const variants = [
  ["baseline", baseline, original.dict],
  ["dictionary-only", baseline, compact.dict],
  ["optimized", optimized, compact.dict],
] as const;
const random = randomGenerator(18649);
const cases: {
  name: string;
  board: Board;
  rack: string;
  template: BoardTemplate;
}[] = [];
for (const template of PRESETS) {
  let board = emptyBoard(template.size);
  const bag = Object.entries(getTileCounts(template)).flatMap(([l, n]) =>
    Array(n).fill(l),
  );
  for (let turn = 0; turn < 10; turn++) {
    const rack = sampleTiles(bag, template.rackSize, random);
    cases.push({ name: `${template.id}-${turn}`, board, rack, template });
    const moves = baseline.solve(original.dict, board, rack, template);
    const move = moves[Math.floor(random() * Math.min(moves.length, 10))];
    if (move) board = placeTiles(board, move);
  }
}
for (const rack of ["RETAINS", "AEIRST?", "AEIRS??"])
  cases.push({
    name: `opening-${rack}`,
    board: emptyBoard(15),
    rack,
    template: PRESETS[0],
  });
const normalize = (moves: Move[]) =>
  moves
    .map((m) => [m.id, m.score, m.word, m.leave, m.crosses.join("|")])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
for (const c of cases) {
  const expected = normalize(
    baseline.solve(original.dict, c.board, c.rack, c.template),
  );
  for (const [name, mod, dict] of variants.slice(1)) {
    assert.deepEqual(
      normalize(mod.solve(dict, c.board, c.rack, c.template)),
      expected,
      `${name} ${c.name}`,
    );
    const before = baseline.prepareSolver(original.dict, c.board, c.template);
    const after = mod.prepareSolver(dict, c.board, c.template);
    assert.deepEqual(after.summarize(c.rack), before.summarize(c.rack));
    assert.equal(after.bestScore(c.rack), before.bestScore(c.rack));
    assert.equal(after.bestBingoScore(c.rack), before.bestBingoScore(c.rack));
    assert.deepEqual(
      after.summarizeReply(c.rack),
      before.summarizeReply(c.rack),
    );
  }
}
console.log(
  `Identical complete move sets: ${cases.length} positions across ${PRESETS.length} variants.`,
);
const mid = cases.find((c) => c.name === "scrabble-8")!;
const racks = Array.from({ length: 150 }, () =>
  sampleTiles(
    [
      ..."AAAAAAAAAEEEEEEEEEEEEIIIIIIIIIOOOOOOOONNNNNNRRRRRRTTTTTTLLLLSSSSUUUUDDDDGGGBBCCMMPPFFHHVVWWYYKJXQZ??",
    ],
    7,
    random,
  ),
);
const jobs = [
  ...cases.slice(-3).map((c) => ({
    name: c.name,
    run: (mod: typeof optimized, dict: newLex.Lexicon) =>
      mod.solve(dict, c.board, c.rack, c.template),
  })),
  {
    name: "all-variant-positions",
    run: (mod: typeof optimized, dict: newLex.Lexicon) =>
      cases
        .slice(0, -3)
        .forEach((c) => mod.solve(dict, c.board, c.rack, c.template)),
  },
  {
    name: "150-rack-summary",
    run: (mod: typeof optimized, dict: newLex.Lexicon) => {
      const p = mod.prepareSolver(dict, mid.board, mid.template);
      for (const rack of racks) p.summarize(rack);
    },
  },
];
jobs.push({
  name: "150-rack-best-score",
  run: (mod, dict) => {
    const prepared = mod.prepareSolver(dict, mid.board, mid.template);
    for (const rack of racks) prepared.bestScore(rack);
  },
});
const results: Record<string, Record<string, number>> = {};
for (const job of jobs) {
  const samples: Record<string, number[]> = Object.fromEntries(
    variants.map(([name]) => [name, []]),
  );
  for (const [name, mod, dict] of variants) job.run(mod, dict);
  for (let round = 0; round < 9; round++)
    for (let n = 0; n < variants.length; n++) {
      const [name, mod, dict] = variants[(n + round) % variants.length];
      const start = performance.now();
      job.run(mod, dict);
      samples[name].push(performance.now() - start);
    }
  results[job.name] = Object.fromEntries(
    Object.entries(samples).map(([name, x]) => [
      name,
      +x.sort((a: number, b: number) => a - b)[4].toFixed(2),
    ]),
  );
  console.log(JSON.stringify({ job: job.name, ...results[job.name] }));
}
