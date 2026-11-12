import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { detectBoard } from "../shared/detect-board";
for (const [width, height, left, top, side] of [
  [900, 1600, 75, 340, 750],
  [1200, 900, 210, 60, 750],
  [390, 844, 15, 230, 360],
  [750, 750, 0, 0, 750],
]) {
  test(`detect board in ${width}×${height} image`, async () => {
    const board = await sharp("tests/fixtures/board.png")
      .resize(side, side)
      .png()
      .toBuffer();
    const { data, info } = await sharp({
      create: { width, height, channels: 4, background: "#faf8fc" },
    })
      .composite([{ input: board, left, top }])
      .raw()
      .toBuffer({ resolveWithObject: true });
    const found = detectBoard(
      { data, width: info.width, height: info.height },
      15,
    );
    assert.ok(found);
    for (const [key, expected] of Object.entries({
      left,
      top,
      width: side,
      height: side,
    }))
      assert.ok(
        Math.abs(found[key as keyof typeof found] - expected) < 7,
        JSON.stringify(found),
      );
  });
}
test("no grid is reported for a blank image", () => {
  assert.equal(
    detectBoard(
      {
        width: 400,
        height: 800,
        data: new Uint8Array(400 * 800 * 4).fill(230),
      },
      15,
    ),
    null,
  );
});
