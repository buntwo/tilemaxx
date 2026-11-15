import assert from "node:assert/strict";
import { test } from "node:test";
import { EndgameSearchLimitError, solveEmptyBag } from "../shared/endgame";
import { Lexicon } from "../shared/lexicon";
import { placeTiles } from "../shared/move-analysis";
import { emptyBoard } from "../shared/model";
import { PRESETS } from "../shared/presets";
import { SearchLimitError, solve } from "../shared/solver";

const template = PRESETS[0];
const board = emptyBoard(template.size);
const [candidate] = solve(new Lexicon(["AT"]), board, "ATBCDEF", template);

test("endgame reports the overall deadline, positions visited, and elapsed time", (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  assert.throws(
    () =>
      solveEmptyBag(
        board,
        candidate,
        "TINGLOS",
        template,
        0,
        () => {
          now = 500;
          throw new SearchLimitError("time");
        },
        placeTiles,
        500,
      ),
    {
      message:
        "Endgame search reached its 500 ms time limit after visiting 1 position (500 ms elapsed).",
    },
  );
});

test("endgame reports the position cap separately from the deadline", (t) => {
  t.mock.method(performance, "now", () => 0);
  let generated = 0;
  assert.throws(
    () =>
      solveEmptyBag(
        board,
        candidate,
        "TINGLOS",
        template,
        0,
        (position, rack) => {
          generated++;
          const index = position.indexOf("");
          return [..."ABCDE"].map((letter) => ({
            ...candidate,
            tiles: [{ index, letter }],
            leave: rack.slice(1),
          }));
        },
        placeTiles,
        500,
      ),
    (error) =>
      error instanceof EndgameSearchLimitError &&
      error.message.includes(
        "its position limit after visiting 1,500 positions",
      ),
  );
  assert.equal(generated, 1_500);
});

test("endgame identifies a single-position move-generation limit", (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  assert.throws(
    () =>
      solveEmptyBag(
        board,
        candidate,
        "TINGLOS",
        template,
        0,
        () => {
          now = 2_000;
          throw new SearchLimitError("time");
        },
        placeTiles,
        2_500,
      ),
    /2,000 ms move-generation limit at a single position after visiting 1 position/,
  );
});
