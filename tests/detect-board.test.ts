import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { detectBoard } from "../shared/detect-board";
import { detectScrabbleGoBoard } from "../shared/detect-scrabble-go";
import { PRESETS } from "../shared/presets";
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

test("Scrabble GO detector locates the board even when most triple words are covered", async () => {
  const width = 350,
    height = 740,
    left = 10,
    top = 233,
    cell = 22;
  const colors = {
    TW: "#da3878",
    DW: "#f09177",
    TL: "#3876ad",
    DL: "#a0c9fa",
  };
  const visibleTriples = [0, 7, 105];
  const squares = PRESETS[0].premiums.map((premium, i) => {
    const x = left + (i % 15) * cell,
      y = top + Math.floor(i / 15) * cell;
    const color =
      premium === "TW" && !visibleTriples.includes(i)
        ? "#f5e3be"
        : (colors[premium as keyof typeof colors] ?? "#e8e9ef");
    return `<rect x="${x + 1}" y="${y + 1}" width="20" height="20" rx="2" fill="${color}"/>`;
  });
  const chrome = `<rect width="${width}" height="${height}" fill="#f9fcff"/>
    <rect x="11" y="180" width="20" height="20" fill="${colors.TW}"/>
    <rect x="165" y="180" width="20" height="20" fill="${colors.TW}"/>
    <rect x="319" y="180" width="20" height="20" fill="${colors.TW}"/>`;
  const pixels = async (content: string) => {
    const data = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${content}</svg>`,
      ),
    )
      .ensureAlpha()
      .raw()
      .toBuffer();
    return { width, height, data };
  };
  assert.equal(detectScrabbleGoBoard(await pixels(chrome)), null);
  assert.deepEqual(
    detectScrabbleGoBoard(await pixels(chrome + squares.join(""))),
    { left, top, width: 330, height: 330 },
  );
});
