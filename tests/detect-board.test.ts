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

test("Scrabble GO finds a late game through JPEG compression with no visible triple words", async () => {
  const width = 588,
    height = 1200,
    left = 8,
    top = 432,
    cell = 38;
  const colors = { DW: "#ff8b71", TL: "#1775b3", DL: "#90ccff" };
  const squares = PRESETS[0].premiums.map((premium, i) => {
    const col = i % 15,
      row = Math.floor(i / 15);
    const visible = premium !== "TW" && (col * 13 + row * 7) % 11 < 6;
    const color = visible
      ? (colors[premium as keyof typeof colors] ?? "#e7e9f0")
      : "#f1dfb6";
    const x = left + col * cell,
      y = top + row * cell;
    return `<rect x="${x + 2}" y="${y + 2}" width="34" height="34" rx="3" fill="${color}"/>
      ${visible && premium ? `<path d="M${x + 16} ${y + 15}h7v8h-7z" fill="white"/>` : ""}`;
  });
  const decoys = Array.from(
    { length: 7 },
    (_, i) =>
      `<rect x="${8 + i * 77}" y="1035" width="70" height="70" rx="5" fill="#f1c48a"/>
     <rect x="${20 + i * 77}" y="280" width="34" height="34" rx="4" fill="${["#ef207a", ...Object.values(colors)][i % 4]}"/>`,
  );
  const chrome = `<rect width="100%" height="100%" fill="#fafafa"/>
     <rect width="100%" height="370" fill="#c56f57"/>
     <rect y="370" width="100%" height="62" fill="#d2edf4"/>
     <rect y="1020" width="100%" height="180" fill="#c56f57"/>${decoys.join("")}`;
  const pixels = async (content: string) => {
    const { data, info } = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${content}</svg>`,
      ),
    )
      .jpeg({ quality: 72 })
      .resize({ height: 900 })
      .toBuffer()
      .then((buffer) =>
        sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      );
    return { width: info.width, height: info.height, data };
  };
  assert.equal(detectScrabbleGoBoard(await pixels(chrome)), null);
  const found = detectScrabbleGoBoard(await pixels(chrome + squares.join("")));
  assert.ok(found);
  for (const [key, expected] of Object.entries({
    left,
    top,
    width: cell * 15,
    height: cell * 15,
  })) {
    assert.ok(
      Math.abs(found[key as keyof typeof found] - expected * 0.75) < 1.5,
      JSON.stringify(found),
    );
  }
});
