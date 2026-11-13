import assert from "node:assert/strict";
import { test } from "node:test";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard, type Move } from "../shared/model";
import { placeTiles } from "../shared/move-analysis";
import { PRESETS } from "../shared/presets";
import {
  prepareReplyAnalysis,
  replyColor,
  replyEndgameLine,
} from "../shared/reply-analysis";
import { solve } from "../shared/solver";
import { TILE_SYMBOLS } from "../shared/tile-pool";

const budget = () => performance.now() + 2_000;

function fixture(tiles: string, rackSize: number, words = ["IT", "QI", "TI"]) {
  const template = {
    ...PRESETS[0],
    size: 5,
    start: 8,
    premiums: emptyBoard(5) as (typeof PRESETS)[0]["premiums"],
    rackSize,
    bingo: 0,
    tileCounts: Object.fromEntries(
      TILE_SYMBOLS.map((letter) => [
        letter,
        [...tiles].filter((tile) => letter === tile).length,
      ]),
    ),
  };
  template.premiums[2] = "TW";
  const board = emptyBoard(5);
  board[8] = "T";
  return { template, board, lexicon: new Lexicon(words) };
}

test("paired histograms weight physical copies and use a fixed reference", () => {
  const { template, board, lexicon } = fixture("TIZQAAB", 2);
  const moves = solve(lexicon, board, "IZ", template);
  const opens = moves.find((move) => move.tiles[0].index === 7)!;
  const baseline = moves.find((move) => move.tiles[0].index === 9)!;
  const check = prepareReplyAnalysis(
    lexicon,
    { template, board, rack: "IZ", bagSize: 3, scorelessTurns: 0 },
    baseline,
    500,
    budget,
  );
  const result = check(opens);
  assert.equal(result.kind, "distribution");
  assert.equal(result.count, 4);
  assert.equal(result.exact, true);
  assert.deepEqual(result.reference.buckets, [4, 0, 0, 0, 0]);
  assert.deepEqual(result.buckets, [3, 0, 1, 0, 0]);
  assert.deepEqual(result.discordant, [1, 0, 1, 0, 0]);
  assert.ok(result.difference > 0);
  assert.equal(replyColor(result, 0), "less");
  assert.equal(replyColor(result, 2), "more");
  assert.equal(replyColor(result, 4), "similar");
  assert.equal(check(baseline).difference, 0);
});

test("sampled comparisons widen the gray band for noisy paired buckets", () => {
  const base = {
    kind: "distribution" as const,
    mean: 31,
    difference: 1,
    count: 500,
    buckets: [0, 240, 260, 0, 0],
    exact: false,
    discordant: [0, 460, 460, 0, 0],
    reference: { mean: 30, buckets: [0, 260, 240, 0, 0] },
  };
  assert.equal(replyColor(base, 2), "similar");
  assert.equal(replyColor({ ...base, exact: true }, 2), "more");
  assert.equal(
    replyColor({ ...base, discordant: [0, 20, 20, 0, 0] }, 2),
    "more",
  );
});

test("reply hotspots count physical racks, only on squares occupied by their best 40+ reply", () => {
  const { template, board, lexicon } = fixture("TIZQAB", 2, ["IT", "QI", "TI"]);
  template.premiums[2] = "QW";
  const moves = solve(lexicon, board, "IZ", template);
  const opens = moves.find((move) => move.tiles[0].index === 7)!;
  const covers = moves.find((move) => move.tiles[0].index === 9)!;
  const compare = prepareReplyAnalysis(
    lexicon,
    { template, board, rack: "IZ", bagSize: 1, scorelessTurns: 0 },
    opens,
    500,
    budget,
    true,
  );
  const opened = compare(opens);
  const closed = compare(covers);
  assert.equal(opened.kind, "distribution");
  assert.equal(closed.kind, "distribution");
  assert.equal(opened.count, 3);
  assert.deepEqual(opened.heatmap?.squares, [
    {
      square: 2,
      count: 2,
      examples: [
        {
          count: 2,
          play: { word: "QI", score: 44, tiles: [{ index: 2, letter: "Q" }] },
        },
      ],
    },
  ]);
  assert.deepEqual(closed.heatmap, {
    squares: [],
    reference: [{ square: 2, count: 2 }],
  });
});

test("known racks separate the raw reply from going-out adjustments", () => {
  const { template, board, lexicon } = fixture("TIQZ", 2);
  const moves = solve(lexicon, board, "IZ", template);
  const opens = moves.find((move) => move.tiles[0].index === 7)!;
  const reference = moves.find((move) => move.tiles[0].index === 9)!;
  const position = {
    board,
    rack: "IZ",
    template,
    bagSize: 0,
    scorelessTurns: 0,
  };
  const result = prepareReplyAnalysis(
    lexicon,
    position,
    reference,
    500,
    budget,
  )(opens);
  assert.equal(result.kind, "empty-bag");
  assert.equal(result.rack, "Q");
  assert.equal(result.reply?.word, "QI");
  assert.equal(result.reply?.score, 33);
  assert.equal(result.ends, "opponent");
  assert.equal(result.yourAdjustment, -10);
  assert.equal(result.opponentAdjustment, 10);
  assert.equal(result.difference, 22);
  const out: Move = { ...opens, id: "out", leave: "" };
  const final = prepareReplyAnalysis(
    lexicon,
    position,
    reference,
    500,
    budget,
  )(out);
  assert.equal(final.kind, "empty-bag");
  assert.equal(final.ends, "you");
  assert.equal(final.reply, null);
  assert.equal(final.difference, null);
  assert.equal(final.yourAdjustment, 10);
  assert.equal(final.opponentAdjustment, -10);
  assert.equal(
    replyEndgameLine(lexicon, position, out, budget()).spread,
    out.score + 20,
  );
  assert.equal(placeTiles(board, opens)[7], "I");
});

test("scoreless endings deduct both racks and invalid bag counts fail", () => {
  const { template, board, lexicon } = fixture("TIQZ", 2);
  const move = { ...solve(lexicon, board, "IZ", template)[0], score: 0 };
  const position = {
    board,
    rack: "IZ",
    template,
    bagSize: 0,
    scorelessTurns: 5,
  };
  const result = prepareReplyAnalysis(
    lexicon,
    position,
    move,
    500,
    budget,
  )(move);
  assert.equal(result.kind, "empty-bag");
  assert.equal(result.ends, "scoreless");
  assert.equal(result.reply, null);
  assert.equal(result.yourAdjustment, -10);
  assert.equal(result.opponentAdjustment, -10);
  assert.throws(
    () =>
      prepareReplyAnalysis(
        lexicon,
        { ...position, bagSize: 2 },
        move,
        500,
        budget,
      ),
    /bag count/,
  );
});
