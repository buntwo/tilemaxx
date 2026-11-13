import assert from "node:assert/strict";
import { test } from "node:test";
import { Lexicon } from "../shared/lexicon";
import { emptyBoard, type BoardTemplate } from "../shared/model";
import {
  checkPremiumDefense,
  type PremiumChange,
} from "../shared/premium-defense";
import { PRESETS } from "../shared/presets";
import { prepareSolver, solve } from "../shared/solver";

function setup() {
  const template: BoardTemplate = {
    ...PRESETS[0],
    size: 5,
    start: 12,
    premiums: Array(25).fill(""),
    tileCounts: { ...PRESETS[0].tileCounts! },
  };
  template.premiums[2] = "TW";
  const board = emptyBoard(5);
  board[12] = "T";
  return { template, board };
}

test("the quick check finds a legal QI hook only if a scoring Q is unseen", () => {
  const { board, template } = setup();
  board[12] = "";
  board[8] = "T";
  template.start = 8;
  const lexicon = new Lexicon(["AI", "IT", "QI"]);
  const move = solve(lexicon, board, "I", template).find(
    (candidate) => candidate.tiles[0].index === 7,
  )!;
  const quick: { opened?: PremiumChange } = {};
  checkPremiumDefense(
    lexicon,
    { board, rack: "I" },
    template,
    [move],
    (result) => {
      quick.opened = result[move.id]?.opened;
    },
  );
  assert.equal(quick.opened?.square, 2);
  assert.equal(quick.opened?.after?.word, "QI");
  assert.equal(quick.opened?.after?.score, 33);
  assert.equal(
    checkPremiumDefense(
      lexicon,
      { board, rack: "IQ", excludedRackSlots: [1] },
      template,
      [move],
    )[move.id],
    undefined,
  );
  const after = [...board];
  after[7] = "I";
  const block = solve(lexicon, after, "Q", template).find(
    (m) => m.tiles[0].index === 2,
  )!;
  // Our own Q is unavailable to the opponent, even before we play it.
  assert.equal(
    checkPremiumDefense(lexicon, { board: after, rack: "Q" }, template, [
      block,
    ])[block.id],
    undefined,
  );
  const cover = solve(lexicon, after, "A", template).find(
    (m) => m.tiles[0].index === 2,
  )!;
  const covered = checkPremiumDefense(
    lexicon,
    { board: after, rack: "A" },
    template,
    [cover],
  )[cover.id];
  assert.ok(covered.closed!.before!.score >= 33);
  assert.equal(covered.closed?.after, undefined);
});

test("the top moves also check replies that need more than one new tile", () => {
  const { board, template } = setup();
  board[12] = "";
  board[8] = "T";
  template.start = 8;
  template.tileCounts!.I = 1;
  template.tileCounts!["?"] = 0;
  const lexicon = new Lexicon(["IT", "QIS"]);
  const move = solve(lexicon, board, "I", template).find(
    (candidate) => candidate.tiles[0].index === 7,
  )!;
  let quickFlagged = false;
  const results = checkPremiumDefense(
    lexicon,
    { board, rack: "I" },
    template,
    [move],
    (quick) => {
      quickFlagged = Boolean(quick[move.id]);
    },
  );
  assert.equal(quickFlagged, false);
  assert.equal(results[move.id]?.depth, 3);
  assert.equal(results[move.id]?.opened?.after?.word, "QIS");
  assert.equal(results[move.id]?.opened?.after?.score, 36);
});

test("targeted searches match standard scoring, multiplicities and blank assignments", () => {
  const { board, template } = setup();
  const lexicon = new Lexicon(["AT", "BAT", "BA", "BATT", "TAB", "TT"]);
  const targets = new Set([2]);
  const solver = prepareSolver(lexicon, board, template);
  for (const rack of ["ABT", "AB?", "A??", "ATT", "AB"]) {
    const counts = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ?"].map(
      (letter) => [...rack].filter((tile) => tile === letter).length,
    );
    const actual = solver.premiumReplies(counts, targets, {}).get(2);
    const expected = solver
      .solve(rack)
      .find((m) => m.tiles.some((tile) => tile.index === 2));
    assert.equal(actual?.score, expected?.score, rack);
    if (actual)
      assert.ok(
        solver
          .solve(rack)
          .some(
            (m) =>
              m.word === actual.word &&
              m.score === actual.score &&
              m.tiles.every(({ index, letter }) =>
                actual.tiles.some(
                  (tile) => tile.index === index && tile.letter === letter,
                ),
              ),
          ),
      );
  }
});
