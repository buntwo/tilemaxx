import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bingoDrawChance,
  ceilingOpponentRacks,
  findBingoCeiling,
  prepareCeilingReplies,
  summarizeCeilingReplies,
  weightedBingoDraws,
} from "../shared/bingo-ceilings";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard } from "../shared/model";
import { placeTiles, randomGenerator } from "../shared/move-analysis";
import { PRESETS } from "../shared/presets";
import { prepareSolver } from "../shared/solver";
import { choose, TILE_SYMBOLS } from "../shared/tile-pool";
import { createBingoHunterSession } from "../src/parallel-bingo-hunter";

const smallPool = [..."EEVVQJXZWEELSNT"];
const deadline = () => performance.now() + 5_000;

function azonFixture() {
  const rack = "ZABJONA";
  const board = emptyBoard(15);
  board[18] = "N";
  board[33] = "A";
  const tiles = [...board, ...rack, ...smallPool];
  const template = {
    ...PRESETS[0],
    tileCounts: Object.fromEntries(TILE_SYMBOLS.map((tile) =>
      [tile, tiles.filter((letter) => letter === tile).length])),
  };
  const position = { template, board, rack, bagSize: 8, scorelessTurns: 0 };
  const lexicon = new Lexicon(["AZON", "BANJAXES", "JAW", "OW", "WALTZ", "NAE", "JEEZ"]);
  const moves = prepareSolver(lexicon, board, template).solve(rack);
  const azon = moves.find(({ id }) => id === "15:A,16:Z,17:O")!;
  assert.equal(azon.word, "AZON");
  return { lexicon, position, moves, azon };
}

test("ceiling draws weight physical copies and condition opponent racks without replacement", () => {
  const draws = weightedBingoDraws(smallPool, 3, 384)!;
  assert.equal(draws.length, 186);
  assert.equal(draws.reduce((sum, draw) => sum + draw.weight, 0), choose(15, 3));
  assert.equal(weightedBingoDraws(smallPool, 3, 100), undefined);
  assert.equal(bingoDrawChance(smallPool, "ESX"), 4 / 455);
  assert.equal(bingoDrawChance(smallPool, "BBX"), 0);
  const { racks, exact } = ceilingOpponentRacks(smallPool, "ESX", 7, randomGenerator(9));
  assert.equal(exact, true);
  assert.equal(racks.reduce((sum, rack) => sum + rack.weight, 0), 792);
  for (const { tiles } of racks) {
    assert.equal(tiles.length, 7);
    assert.doesNotMatch(tiles, /[SX]/);
    assert.ok(tiles.split("E").length - 1 <= 3);
  }
});

test("an indexed premium lane finds the same eight-letter bingo when refills are too numerous", () => {
  const { lexicon, position, azon } = azonFixture();
  const bigPool = [...smallPool, ..."ABCDEFGHIKLMNOPRUY"];
  assert.equal(weightedBingoDraws(bigPool, 3, 384), undefined);
  const ceiling = findBingoCeiling(lexicon, position, azon, bigPool, 7, false, deadline())!;
  assert.equal(ceiling.draw, "ESX");
  assert.equal(ceiling.bingo.word, "BANJAXES");
  assert.equal(ceiling.bingo.score, 338);
  const board = placeTiles(position.board, azon);
  const solver = prepareSolver(lexicon, board, position.template);
  assert.equal(solver.bestBingo(azon.leave + ceiling.draw)?.score, ceiling.bingo.score);
});

test("a high-scoring bingo can survive the modeled reply when another legal play blocks it", () => {
  const { lexicon, position, azon } = azonFixture();
  const ceiling = findBingoCeiling(lexicon, position, azon, smallPool, 7, false, deadline())!;
  assert.equal(ceiling.bingo.score, 338);
  const evaluate = prepareCeilingReplies(lexicon, position, azon, ceiling);
  assert.equal(evaluate("EJQTVWZ", deadline()).score, 0);
  assert.equal(evaluate("ELNQTWZ", deadline()).score, 338);
  assert.equal(evaluate("ABJNESX", deadline()).laneBingo, true);

  const reviewed = summarizeCeilingReplies(azon, ceiling,
    [{ tiles: "", weight: 4 }, { tiles: "", weight: 1 }],
    [
      { score: 0, laneBingo: false, canBlock: true },
      { score: 344, laneBingo: true, canBlock: true },
    ],
    true,
  );
  assert.equal(reviewed.chance, ceiling.drawChance / 5);
  assert.equal(reviewed.bingo.score, 344);
  assert.equal(reviewed.laneBingoChance, 0.2);
  assert.equal(reviewed.blockChance, 1);
});

test("high ceilings use their own slice and preserve the completed utility ranking", async () => {
  const { lexicon, position, moves, azon } = azonFixture();
  const session = createBingoHunterSession(lexicon, position, moves, undefined, 1);
  const stages = new Set<string>();
  const run = () => session.run(new AbortController().signal, ({ phase, stage }) => {
    stages.add(`${stage}.${phase}`);
  });
  const normal = await run();
  assert.ok(normal.summary.checked);
  assert.equal(normal.summary.ceilingPass, true);
  assert.equal(normal.summary.ceilings, undefined);

  const extra = await run();
  assert.deepEqual([...stages], [
    "1.sample", "2.checkpoint", "3.refine", "4.ceiling-discovery", "5.ceiling-replies",
  ]);
  assert.deepEqual(extra.ranked, normal.ranked);
  const rare = extra.summary.ceilings?.find(({ move }) => move.id === azon.id);
  assert.equal(rare?.bingo.word, "BANJAXES");
  assert.equal(rare?.bingo.score, 338);
  assert.equal(rare?.cases, 792);
  assert.ok(rare.chance > 0 && rare.chance <= rare.drawChance);
  assert.equal(extra.summary.canContinue, false);
});

test("a constrained reply first can supply the board tile for an eight-letter bingo", () => {
  const template = PRESETS[0];
  const board = emptyBoard(template.size);
  [..."ODE"].forEach((tile, i) => { board[16 + 15 * i] = tile; });
  const rack = "ADEUNWY";
  const position = { board, template, rack, bagSize: 8, scorelessTurns: 0 };
  const lexicon = new Lexicon(["NO", "ODE", "NOW", "DE", "ER", "UN", "NODE", "SWERVE", "UNSWAYED"]);
  const move = prepareSolver(lexicon, board, template).solve(rack)
    .find(({ id }) => id === "15:N")!;
  const solver = prepareSolver(lexicon, placeTiles(board, move), template);
  assert.equal(solver.bestBingoScore(move.leave + "N"), 0);
  const pool = [..."RRVVQJXZWEELSNT"];
  const ceiling = findBingoCeiling(lexicon, position, move, pool, 7, true, deadline())!;
  assert.equal(ceiling.bingo.word, "UNSWAYED");
  assert.equal(ceiling.bingo.score, 232);
  assert.equal(ceiling.needsReply, true);
  const evaluate = prepareCeilingReplies(lexicon, position, move, ceiling);
  assert.equal(evaluate("EEQRSVW", deadline()).score, 232);
  assert.equal(evaluate("EJQTVWZ", deadline()).score, 0);
});
