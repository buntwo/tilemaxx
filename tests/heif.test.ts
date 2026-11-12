import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { acceptsScreenshot, decodeHeif, isHeif } from "../shared/heif";
import { extractGlyphs } from "../shared/screenshot";
test("HEIF detection supports iPhone MIME types and extension-only file selections", () => {
  for (const file of [
    { name: "board.HEIC", type: "" },
    { name: "board.heif", type: "application/octet-stream" },
    { name: "image", type: "image/heif" },
    { name: "image", type: "image/heic-sequence" },
  ]) {
    assert.ok(isHeif(file));
    assert.ok(acceptsScreenshot({ ...file, size: 100 }));
  }
  assert.ok(
    !acceptsScreenshot({
      name: "board.heic",
      type: "image/heic",
      size: 21 * 1024 * 1024,
    }),
  );
  assert.ok(
    !acceptsScreenshot({ name: "file.txt", type: "text/plain", size: 100 }),
  );
});
test("real HEIC decoding preserves board dimensions and tile locations for OCR", async () => {
  const image = await decodeHeif(readFileSync("tests/fixtures/board.heic"));
  assert.equal(image.width, 750);
  assert.equal(image.height, 750);
  assert.equal(image.data.length, 750 * 750 * 4);
  assert.deepEqual(
    extractGlyphs(image, { left: 0, top: 0, width: 750, height: 750 }, 15).map(
      (g) => g.index,
    ),
    [98, 112, 113, 114, 128, 143],
  );
});
test("invalid HEIF input is rejected", async () => {
  await assert.rejects(() => decodeHeif(new Uint8Array([1, 2, 3])));
});
