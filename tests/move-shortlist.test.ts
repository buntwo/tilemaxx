import assert from "node:assert/strict";
import { test } from "node:test";
import type { Move } from "../shared/model";
import { shortlistMoves } from "../shared/move-shortlist";

const move = (
  word: string,
  score: number,
  leave: string,
  index: number,
): Move => ({
  id: `${word}:${index}`,
  word,
  score,
  leave,
  direction: "across",
  row: 0,
  col: index,
  tiles: [...word].map((letter, i) => ({ index: index + i, letter })),
  crosses: [],
  blanks: 0,
});

test("shortlist keeps distinct choices and considers premium blocks below the top 20", () => {
  const top = move("RATE", 40, "UU", 0);
  const near = move("RATE", 39, "ES", 1);
  const leave = move("TAR", 38, "ERS", 8);
  const lower = move("AT", 28, "ER", 40);
  const bingo = move("TEA", 35, "AES", 16);
  const extras = Array.from({ length: 24 }, (_, i) =>
    move("AA", 30, "UU", 60 + i * 2),
  );
  const list = shortlistMoves([top, near, leave, bingo, ...extras, lower], {
    rackOdds: {
      byLeave: { UU: 0.01, ER: 0.02, ERS: 0.03, AES: 0.24 },
      exact: true,
      bagSize: 40,
    },
    defense: {
      [lower.id]: {
        depth: 1,
        closed: {
          square: 40,
          premium: "TW",
          before: { word: "AX", score: 27, tiles: [] },
        },
      },
    },
  });
  assert.deepEqual(
    list.map(({ move, reason }) => [move.id, reason]),
    [
      [top.id, "Top score"],
      [leave.id, "Better leave"],
      [lower.id, "Closes a premium"],
      [bingo.id, "Better bingo odds"],
    ],
  );
});
