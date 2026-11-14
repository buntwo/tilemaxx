import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { emptyBoard, type Premium } from "../shared/model";
import { PRESETS } from "../shared/presets";
import { extractGlyphs } from "../shared/screenshot";
import {
  detectWordfeudBoard,
  readScreenshotPremiums,
  wordfeudBlank,
} from "../shared/screenshot-premiums";
import {
  inferWordfeudPremiums,
  openingSequences,
} from "../shared/infer-premiums";
import { scorePlacement } from "../shared/game-scoring";

const wordfeud = PRESETS.find(({ id }) => id === "wordfeud")!;

test("Wordfeud grid reads premiums by square, separates tiles, and recognizes a missing upper-right point value", async () => {
  const side = 600,
    top = 150;
  const colors: Partial<Record<Premium, string>> = {
    "": "#2a2d32",
    DL: "#6c8c50",
    TL: "#22608c",
    DW: "#c67314",
    TW: "#8f2530",
  };
  const squares = wordfeud.premiums
    .map((premium, index) => {
      const x = (index % 15) * 40,
        y = top + Math.floor(index / 15) * 40;
      const played = index === 112 || index === 113;
      return `<rect x="${x + 1}" y="${y + 2}" width="38" height="37" rx="2" fill="${played ? "#fff3b2" : colors[premium]}"/>${
        played
          ? `<path d="M${x + 15},${y + 10}v22h10" fill="none" stroke="#141306" stroke-width="4"/>${
              index === 113
                ? `<path d="M${x + 32},${y + 7}v7" stroke="#141306" stroke-width="2"/>`
                : ""
            }`
          : ""
      }`;
    })
    .join("");
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="900"><rect width="100%" height="100%" fill="#383e48"/><rect y="${top}" width="${side}" height="${side}" fill="#17191e"/>${squares}</svg>`,
  );
  const { data, info } = await sharp(svg)
    .jpeg({ quality: 83 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = { data, width: info.width, height: info.height };
  const crop = detectWordfeudBoard(pixels, 15)!;
  assert.ok(crop);
  assert.ok(Math.abs(crop.top - top) < 3);
  const glyphs = extractGlyphs(pixels, crop, 15);
  assert.deepEqual(
    glyphs.map(({ index }) => index),
    [112, 113],
  );
  assert.equal(wordfeudBlank(pixels, crop, 15, 112), true);
  assert.equal(wordfeudBlank(pixels, crop, 15, 113), false);
  const recognized = readScreenshotPremiums(
    pixels,
    crop,
    15,
    new Set([112, 113]),
  )!;
  assert.equal(recognized.style, "wordfeud");
  assert.deepEqual(recognized.fixed, wordfeud.premiums);
  assert.deepEqual(
    recognized.squares,
    wordfeud.premiums.map((premium, i) =>
      i === 112 || i === 113 ? null : premium,
    ),
  );
  const index = (top + 2 * 40 + 8) * side + 2 * 40 + 14;
  for (let y = 0; y < 30; y++)
    for (let x = -10; x < 25; x++) {
      const start = (index + y * side + x) * 4;
      data.set([108, 140, 80], start);
    }
  const random = readScreenshotPremiums(pixels, crop, 15, new Set([112, 113]))!;
  assert.equal(random.squares[32], "DL");
  assert.equal(random.fixed, undefined);
});

test("opening points set only premiums common to all possible layouts", () => {
  const board = emptyBoard(15);
  board[111] = "A";
  board[112] = "T";
  const [turns] = openingSequences(board, wordfeud);
  const hidden = board.map(() => null);
  assert.deepEqual(inferWordfeudPremiums(wordfeud, turns, hidden, [2]), {
    matches: 1,
    certain: [
      [111, ""],
      [112, ""],
    ],
  });
  assert.deepEqual(inferWordfeudPremiums(wordfeud, turns, hidden, [4]), {
    matches: 2,
    certain: [[112, ""]],
  });
  assert.deepEqual(inferWordfeudPremiums(wordfeud, turns, hidden, [1]), {
    matches: 0,
    certain: [],
  });
  const earlier = emptyBoard(15);
  for (const [i, tile] of [..."OuTLIER"].entries()) earlier[67 + 15 * i] = tile;
  const [opening] = openingSequences(earlier, wordfeud);
  assert.equal(scorePlacement(opening[0].before, earlier, wordfeud)?.score, 46);
  const inferred = inferWordfeudPremiums(wordfeud, opening, hidden, [46]);
  assert.equal(inferred.matches, 3);
  assert.equal(
    inferred.certain.some(([index]) => index === 82),
    false,
  );
});

test("two opening scores can resolve separate placements and include cross words", () => {
  const board = emptyBoard(15);
  for (const [index, tile] of [
    [111, "A"],
    [112, "T"],
    [126, "I"],
    [127, "N"],
  ] as const)
    board[index] = tile;
  const history = openingSequences(board, wordfeud).find(
    (turns) => turns[0].word === "AT" && turns[1]?.word === "IN",
  )!;
  assert.ok(history);
  const squares: (Premium | null)[] = board.map((tile) => (tile ? null : ""));
  const guess = [...wordfeud.premiums].fill("") as Premium[];
  guess[111] = "TL";
  guess[126] = "TW";
  guess[127] = "TW";
  const scores = history.map(
    ({ before, after, direction }) =>
      scorePlacement(
        before,
        after,
        { ...wordfeud, premiums: guess },
        direction,
      )!.score,
  );
  assert.deepEqual(scores, [4, 30]);
  const result = inferWordfeudPremiums(wordfeud, history, squares, scores);
  assert.deepEqual(result, {
    matches: 2,
    certain: [
      [112, ""],
      [126, "TW"],
      [127, "TW"],
    ],
  });
  assert.equal(
    inferWordfeudPremiums(wordfeud, history, squares, [null, 30]).certain
      .length,
    2,
  );
});
