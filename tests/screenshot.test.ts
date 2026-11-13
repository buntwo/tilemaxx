import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { createWorker, PSM } from "tesseract.js";
import { createRequire } from "node:module";
import { extractGlyphs, importBoard, validateCrop } from "../shared/screenshot";
import {
  OCR_TILE_SIZE,
  readGlyphs,
  renderGlyph,
} from "../shared/screenshot-ocr";
import { PRESETS } from "../shared/presets";
import { emptyBoard, undo, redo, type Game } from "../shared/model";

const require = createRequire(import.meta.url);
test("crop bounds reject undersized or off-image boards", () => {
  assert.throws(() =>
    validateCrop({ left: -1, top: 0, width: 600, height: 600 }, 600, 600, 15),
  );
  assert.throws(() =>
    validateCrop({ left: 0, top: 0, width: 150, height: 150 }, 600, 600, 15),
  );
  assert.throws(() =>
    validateCrop({ left: 1, top: 0, width: 601, height: 600 }, 600, 600, 15),
  );
  assert.throws(() =>
    validateCrop({ left: NaN, top: 0, width: 600, height: 600 }, 600, 600, 15),
  );
  validateCrop({ left: 0, top: 0, width: 600, height: 600 }, 600, 600, 15);
});

test("screenshot replacement keeps rack and blank identities, supports undo/redo, and invalidates redo", () => {
  const game: Game = {
    id: "g",
    profileId: "p",
    name: "test",
    template: PRESETS[0],
    dictionaryId: "test",
    board: emptyBoard(15),
    rack: "C?T",
    past: [],
    future: [],
    revision: 0,
    updatedAt: "",
    archived: false,
  };
  game.board[112] = "D";
  const board = emptyBoard(15);
  board[112] = "C";
  board[113] = "a";
  board[114] = "T";
  const imported = importBoard(game, board);
  assert.equal(imported.rack, "C?T");
  assert.deepEqual(imported.board, board);
  assert.deepEqual(undo(imported).board, game.board);
  assert.deepEqual(redo(undo(imported)).board, board);
  assert.equal(importBoard(undo(imported), board).future.length, 0);
  assert.equal(game.board[112], "D");
  assert.throws(() => importBoard(game, ["C"]));
  assert.throws(() =>
    importBoard(
      game,
      board.map(() => "?"),
    ),
  );
});

test("Scrabble GO ink detection keeps blue assigned blanks and rejects bonus text and point values", async () => {
  const svg =
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192">
    <rect width="192" height="192" fill="#4979b0"/>
    <rect width="64" height="64" fill="#f6e7c3"/>
    <rect x="64" width="64" height="64" fill="#f6e7c3"/>
    <path d="M14 15 L29 46 L44 15" fill="none" stroke="#76b1f8" stroke-width="6"/>
    <rect x="92" y="15" width="7" height="32" fill="#503f30"/>
    <rect x="115" y="42" width="4" height="10" fill="#503f30"/>
    <path d="M143 16 v28 h9 c14 0 14 -28 0 -28 z M172 16 v28 h15"
          fill="none" stroke="#fff" stroke-width="4"/>
  </svg>`);
  const { data, info } = await sharp(svg)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const glyphs = extractGlyphs(
    { data, width: info.width, height: info.height },
    { left: 0, top: 0, width: 192, height: 192 },
    3,
  );
  assert.deepEqual(
    glyphs.map(({ index, assignedBlank }) => [index, assignedBlank]),
    [
      [0, true],
      [1, false],
    ],
  );
  const result = await readGlyphs(
    glyphs,
    3,
    async (glyph, pass) => {
      if (glyph.index === 0 && pass === "smallCharacter")
        return { text: "Vv", confidence: 82 };
      if (glyph.index === 1 && pass === "character")
        return { text: "|", confidence: 44 };
      return { text: "", confidence: 0 };
    },
    () => {},
    () => {},
  );
  assert.deepEqual(result, {
    board: ["v", "I", "", "", "", "", "", "", ""],
    uncertain: [0, 1],
    candidates: 2,
  });
});

test("a low-confidence A reading can recover a Z without changing other letters", async () => {
  const svg =
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">
    <rect width="120" height="120" fill="#f6e7c3"/>
    <path d="M11 8H28V12L17 24H28V28H11V24L22 12H11Z" fill="#22170f"/>
    <path d="M54 26L61 9H63L70 26M56 21H68" fill="none" stroke="#22170f" stroke-width="4"/>
    <path d="M91 8H108V12L97 24H108V28H91V24L102 12H91Z" fill="#68a8ee"/>
    <path d="M11 49L29 66M29 49L11 66" fill="none" stroke="#22170f" stroke-width="4"/>
  </svg>`);
  const { data, info } = await sharp(svg)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const glyphs = extractGlyphs(
    { data, width: info.width, height: info.height },
    { left: 0, top: 0, width: 120, height: 120 },
    3,
  );
  const result = await readGlyphs(
    glyphs,
    3,
    async (glyph, pass) => {
      if (glyph.index === 3 && pass === "character")
        return { text: "X", confidence: 83 };
      return { text: "A", confidence: glyph.index === 1 ? 70 : 0 };
    },
    () => {},
    () => {},
  );
  assert.deepEqual(result, {
    board: ["Z", "A", "z", "X", "", "", "", "", ""],
    uncertain: [0, 1, 2],
    candidates: 4,
  });
});

test(
  "local OCR recognizes a fixture and rejects premium labels and point values",
  { timeout: 60000 },
  async () => {
    // Original, generated test art, not a screenshot copied from a game app.
    const { data, info } = await sharp("tests/fixtures/board.png")
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const glyphs = extractGlyphs(
      { data, width: info.width, height: info.height },
      { left: 0, top: 0, width: 750, height: 750 },
      15,
    );
    const expected = new Map([
      [112, "C"],
      [113, "A"],
      [114, "T"],
      [98, "R"],
      [128, "E"],
      [143, "S"],
    ]);
    assert.deepEqual(
      glyphs.map((g) => g.index),
      [...expected.keys()].sort((a, b) => a - b),
    );
    const worker = await createWorker("eng", 1, {
      langPath: require("@tesseract.js-data/eng").langPath,
      cacheMethod: "none",
    });
    try {
      await worker.setParameters({
        user_defined_dpi: "300",
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      });
      const result = await readGlyphs(
        glyphs,
        15,
        async (glyph, pass) => {
          await worker.setParameters({
            tessedit_char_whitelist:
              pass === "block" ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ" : "",
            tessedit_pageseg_mode:
              pass === "block" ? PSM.SINGLE_BLOCK : PSM.SINGLE_CHAR,
          });
          const tile = await sharp(renderGlyph(glyph, pass), {
            raw: { width: OCR_TILE_SIZE, height: OCR_TILE_SIZE, channels: 4 },
          })
            .png()
            .toBuffer();
          return (await worker.recognize(tile)).data;
        },
        () => {},
        () => {},
      );
      const expectedBoard = emptyBoard(15);
      for (const [index, letter] of expected) expectedBoard[index] = letter;
      assert.deepEqual(result.board, expectedBoard);
    } finally {
      await worker.terminate();
    }
  },
);
