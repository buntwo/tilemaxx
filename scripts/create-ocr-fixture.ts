// Deterministic original test artwork: varied premiums, small scores, and six letters.
import sharp from "sharp";
import { PRESETS } from "../shared/presets";
const letters = new Map([
  [112, "C"],
  [113, "A"],
  [114, "T"],
  [98, "R"],
  [128, "E"],
  [143, "S"],
]);
let svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="750" height="750"><rect width="750" height="750" fill="#aeb5c5"/>';
for (let i = 0; i < 225; i++) {
  const x = (i % 15) * 50,
    y = Math.floor(i / 15) * 50,
    p = PRESETS[0].premiums[i],
    l = letters.get(i);
  const color = l
    ? "#ffedd2"
    : p.endsWith("W")
      ? "#e794ac"
      : p
        ? "#a2c8e7"
        : "#d3dae6";
  svg += `<rect x="${x + 1}" y="${y + 1}" width="48" height="48" rx="3" fill="${color}"/>`;
  if (l)
    svg += `<text x="${x + 24}" y="${y + 35}" text-anchor="middle" font-family="Arial" font-size="34" font-weight="bold" fill="#302c37">${l}</text><text x="${x + 40}" y="${y + 43}" text-anchor="middle" font-family="Arial" font-size="10" fill="#302c37">${l === "C" ? 3 : 1}</text>`;
  else if (p)
    svg += `<text x="${x + 25}" y="${y + 29}" text-anchor="middle" font-family="Arial" font-size="12" font-weight="bold" fill="#584d6f">${p}</text>`;
}
await sharp(Buffer.from(svg + "</svg>"))
  .png()
  .toFile("tests/fixtures/board.png");
