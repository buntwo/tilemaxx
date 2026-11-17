import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyBoard, type Move } from "../shared/model";
import type { MoveDefense } from "../shared/premium-defense";
import { PRESETS } from "../shared/presets";
import { REPLY_LIMIT } from "../shared/reply-analysis";
import { extraReplyCandidates } from "../shared/reply-candidates";

function play(id: string, score: number, leave: string): Move {
  return {
    id, score, leave, word: "PLAY", row: 7, col: 7, direction: "across",
    tiles: [{ index: 112, letter: "P" }], blanks: 0, crosses: [],
  };
}

function closes(square: number, letter: string, score: number): MoveDefense {
  return {
    depth: 1,
    closed: { square, premium: "TW", before: {
      word: "REPLY", score, tiles: [{ index: square, letter }],
    } },
  };
}

test("reply screening adds distinct blocks and leaves without spending slots on impossible threats", () => {
  const template = PRESETS[0];
  const position = { template, board: emptyBoard(template.size), rack: "AEIQST?" };
  const head = Array.from({ length: REPLY_LIMIT }, (_, i) =>
    play(`top-${i}`, 45, i ? "S" : ""),
  );
  const moves = [
    ...head,
    play("unavailable", 44, "S"),
    play("best-block", 43, ""),
    play("same-square", 43, ""),
    play("other-block", 42, ""),
    play("opens-worse", 41, ""),
    play("good-leave", 40, "?S"),
    play("same-leave", 39, "?S"),
    play("different-leave", 38, "AENST"),
    play("weak-leave", 35, "Q"),
    play("too-costly", 25, "?"),
  ];
  const defense = {
    unavailable: closes(1, "Q", 100),
    "best-block": closes(2, "A", 55),
    "same-square": closes(2, "A", 45),
    "other-block": closes(3, "E", 46),
    "opens-worse": {
      ...closes(4, "A", 58),
      opened: { square: 5, premium: "TW" as const, after: {
        word: "OPEN", score: 70, tiles: [{ index: 5, letter: "E" }],
      } },
    },
  };
  assert.deepEqual(
    extraReplyCandidates(position, moves, defense).map(({ move, reason }) => [move.id, reason]),
    [
      ["best-block", "block"],
      ["other-block", "block"],
      ["good-leave", "leave"],
      ["different-leave", "leave"],
    ],
  );
  assert.deepEqual(extraReplyCandidates(position, head, defense), []);
});

test("reply screening can block a multi-tile threat outside the one-tile checks", () => {
  const template = PRESETS[0];
  const position = { template, board: emptyBoard(template.size), rack: "BGINRST" };
  const head = Array.from({ length: REPLY_LIMIT }, (_, i) => play(`top-${i}`, 36, ""));
  const premium = 3;
  const outside = 4;
  const usesSameLetter = {
    ...play("compatible", 35, ""), tiles: [{ index: outside, letter: "E" }],
  };
  const takesAwayReply = {
    ...play("blocks", 34, ""), tiles: [{ index: outside, letter: "B" }],
  };
  const baseline = new Map([[premium, {
    word: "EAR", score: 70,
    tiles: [{ index: premium, letter: "A" }, { index: outside, letter: "E" }],
  }]]);
  assert.deepEqual(
    extraReplyCandidates(position, [...head, usesSameLetter, takesAwayReply], {}, baseline),
    [{ move: takesAwayReply, reason: "block" }],
  );
});
