import assert from "node:assert/strict";
import { test } from "node:test";
import {
  learnerRackCues,
  promoteLearnerRegions,
} from "../shared/learner-attention";
import { emptyBoard } from "../shared/model";
import {
  learnerAppeal,
  learnerLogAppeal,
  sampleProfilePlacements,
} from "../shared/player-profile-sampling";
import type { Move } from "../shared/model";
import { PRESETS } from "../shared/presets";

test("Learner appeal doubles every three utility points", () => {
  for (const utility of [-2, 10, 22, 25, 46]) {
    assert.equal(learnerAppeal(utility + 3), 2 * learnerAppeal(utility));
    assert.equal(learnerAppeal(utility - 3), learnerAppeal(utility) / 2);
  }
});

test("the Learner draw can distinguish utility on custom boards with very high scores", () => {
  const candidates = [
    {
      move: { id: "first", word: "FIRST" } as Move,
      weight: learnerLogAppeal(4_000),
    },
    {
      move: { id: "second", word: "SECOND" } as Move,
      weight: learnerLogAppeal(4_200),
    },
  ];
  assert.equal(learnerAppeal(4_200), Number.MAX_VALUE);
  for (let seed = 0; seed < 20; seed++)
    assert.equal(
      sampleProfilePlacements(candidates, seed, 1, true)[0],
      candidates[1],
    );
});

test("rack cues check the complete short main word and respect rack copies", () => {
  const template = PRESETS[0];
  const { size } = template;
  const board = emptyBoard(size);
  const first = 2 * size + 2;
  const second = first + 1;
  board[first + size] = "I";
  board[second + size] = "N";
  const known = new Set(["QI", "AN"]);
  const pair = (rack = "AQ") =>
    learnerRackCues(board, template, rack, (word) => known.has(word)).some(
      (cue) =>
        cue.cells.length === 2 &&
        cue.cells[0] === first &&
        cue.cells[1] === second,
    );
  assert.equal(pair(), false);
  known.add("QA");
  assert.equal(pair(), true);
  board[second + 1] = "n";
  assert.equal(
    pair(),
    false,
    "the existing assigned blank extends the word to QAN",
  );
  known.add("QAN");
  assert.equal(pair(), true);
  board[first - 1] = "S";
  assert.equal(pair(), false, "the complete four-letter span is checked too");
  board[second + 2] = "T";
  assert.equal(pair(), true, "a longer span remains eligible");
  assert.equal(pair("Q?"), false, "the cue does not assign a rack blank");
  known.add("QN");
  assert.equal(pair("Q"), false);
  assert.equal(
    pair("QQ"),
    true,
    "both crosses can use Q if two copies are present",
  );
});

test("Learner replaces up to two regions using distinct uncovered cues", () => {
  const ordered = Array.from({ length: 6 }, (_, area) => ({ area }));
  const regionOf = (cell: number) => cell;
  const cues = [
    { cells: [2], points: 3 },
    { cells: [1], points: 8 },
    { cells: [3, 4], points: 11 },
    { cells: [4], points: 8 },
    { cells: [5], points: 9 },
  ];
  const selected = ordered.slice(0, 3);
  promoteLearnerRegions(ordered, selected, cues, regionOf);
  assert.deepEqual(
    selected.map(({ area }) => area),
    [0, 5, 3],
  );

  const tied = ordered.slice(0, 3);
  promoteLearnerRegions(ordered, tied, cues.slice(0, -1), regionOf);
  assert.deepEqual(
    tied.map(({ area }) => area),
    [0, 1, 3],
  );
});
