import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { createWorker, PSM } from "tesseract.js";
import { createRequire } from "node:module";
import { extractGlyphs, importBoard, validateCrop } from "../shared/screenshot";
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
      for (const g of glyphs) {
        const width = Math.round(
            g.width * Math.min(60 / g.width, 64 / g.height),
          ),
          height = Math.round(g.height * Math.min(60 / g.width, 64 / g.height));
        const letter = await sharp(g.data, {
          raw: { width: g.width, height: g.height, channels: 4 },
        })
          .resize(width, height)
          .png()
          .toBuffer();
        const tile = await sharp({
          create: { width: 96, height: 96, channels: 4, background: "white" },
        })
          .composite([
            {
              input: letter,
              left: Math.round((96 - width) / 2),
              top: Math.round((96 - height) / 2),
            },
          ])
          .png()
          .toBuffer();
        const result = await worker.recognize(tile);
        assert.equal(
          result.data.text.trim(),
          expected.get(g.index),
          `Cell ${g.index}`,
        );
      }
    } finally {
      await worker.terminate();
    }
  },
);
