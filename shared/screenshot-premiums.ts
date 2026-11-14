import { type Premium } from "./model";
import { PRESETS } from "./presets";
import { scrabbleGoPremiumColor } from "./detect-scrabble-go";
import type { Crop, Pixels } from "./screenshot";

export type ScreenshotStyle = "wordfeud" | "scrabble-go";
export type ReadPremiums = {
  style: ScreenshotStyle;
  // null represents a square whose face could not be read, including covered squares.
  squares: (Premium | null)[];
  fixed?: Premium[];
};

const wordfeudColors: readonly [Premium, number, number, number][] = [
  ["", 42, 45, 50],
  ["TL", 34, 96, 140],
  ["TW", 143, 37, 48],
  ["DL", 108, 140, 80],
  ["DW", 198, 115, 20],
];

function wordfeudColor(r: number, g: number, b: number): Premium | null {
  let best: Premium | null = null;
  let distance = 38 ** 2;
  for (const [premium, red, green, blue] of wordfeudColors) {
    const difference = (r - red) ** 2 + (g - green) ** 2 + (b - blue) ** 2;
    if (difference < distance) {
      best = premium;
      distance = difference;
    }
  }
  // The plain face must be distinct from grid lines and the surrounding UI.
  if (best === "" && (r < 33 || r > 50 || b < g || b - r > 17)) return null;
  return best;
}

const goTypes: Premium[] = ["", "TW", "DW", "TL", "DL"];
function scrabbleGoColor(r: number, g: number, b: number): Premium | null {
  const premium = scrabbleGoPremiumColor(r, g, b);
  if (premium) return goTypes[premium];
  if (r >= 198 && r <= 249 && g >= r - 6 && b >= g - 4 && b >= r - 2) return "";
  return null;
}

export function readScreenshotPremiums(
  image: Pixels,
  crop: Crop,
  size: number,
  occupied: ReadonlySet<number>,
): ReadPremiums | undefined {
  const profiles = [
    { style: "wordfeud", color: wordfeudColor, preset: "wordfeud" },
    { style: "scrabble-go", color: scrabbleGoColor, preset: "scrabble" },
  ] as const;
  const cw = crop.width / size,
    ch = crop.height / size;
  const sample = [0.2, 0.32, 0.68, 0.8];
  let best: ReadPremiums | undefined;
  let bestCount = 0;
  for (const { style, color, preset } of profiles) {
    const squares = Array.from({ length: size * size }, (_, index) => {
      if (occupied.has(index)) return null;
      const counts = new Map<Premium, number>();
      for (const dy of sample)
        for (const dx of sample) {
          const x = Math.floor(crop.left + ((index % size) + dx) * cw);
          const y = Math.floor(crop.top + (Math.floor(index / size) + dy) * ch);
          const p = (y * image.width + x) * 4;
          const premium = color(
            image.data[p],
            image.data[p + 1],
            image.data[p + 2],
          );
          if (premium !== null)
            counts.set(premium, (counts.get(premium) ?? 0) + 1);
        }
      return [...counts].find(([, count]) => count >= 9)?.[0] ?? null;
    });
    const visible = squares.filter((square) => square !== null).length;
    const premiums = squares.filter(Boolean).length;
    if (
      visible < (size * size - occupied.size) * 0.65 ||
      premiums < 6 ||
      visible <= bestCount
    )
      continue;
    const reference = PRESETS.find(({ id }) => id === preset)!;
    const fixed =
      size === reference.size &&
      (style === "scrabble-go" || visible >= 170) &&
      squares.every(
        (square, index) =>
          square === null || square === reference.premiums[index],
      )
        ? reference.premiums
        : undefined;
    best = { style, squares, fixed };
    bestCount = visible;
  }
  return best;
}

export function wordfeudBlank(
  image: Pixels,
  crop: Crop,
  size: number,
  index: number,
) {
  const cw = crop.width / size,
    ch = crop.height / size;
  const x = crop.left + (index % size) * cw;
  const y = crop.top + Math.floor(index / size) * ch;
  let dark = 0,
    area = 0;
  // Wordfeud prints the value in the upper-right corner of nonblank tiles.
  for (let yy = Math.ceil(y + ch * 0.09); yy < y + ch * 0.33; yy++) {
    for (let xx = Math.ceil(x + cw * 0.73); xx < x + cw * 0.92; xx++) {
      const p = (yy * image.width + xx) * 4;
      if (image.data[p] < 166 && image.data[p + 1] < 160) dark++;
      area++;
    }
  }
  return area > 0 && dark / area < 0.09;
}

export function detectWordfeudBoard(image: Pixels, size: number): Crop | null {
  const { width, height, data } = image;
  const rows: number[] = [];
  let top = -1;
  // Wordfeud's phone board spans the viewport. Look for 15 evenly spaced
  // bands of tile faces separated by the dark horizontal grid lines.
  const samples = size * 2;
  for (let y = 0; y <= height; y++) {
    let recognized = 0;
    for (let i = 0; i < samples && y < height; i++) {
      const x = Math.floor(((i + 0.5) * width) / samples);
      const p = (y * width + x) * 4;
      const r = data[p],
        g = data[p + 1],
        b = data[p + 2];
      if (wordfeudColor(r, g, b) !== null || (r > 220 && g > 195 && b > 130))
        recognized++;
    }
    if (recognized > samples * 0.58) {
      if (top < 0) top = y;
    } else if (top >= 0) {
      const step = width / size;
      if (y - top >= step * 0.48 && y - top <= step * 1.1)
        rows.push((top + y) / 2);
      top = -1;
    }
  }
  const step = width / size;
  for (let i = 0; i <= rows.length - size; i++) {
    const start = rows[i] - step / 2;
    if (start < 0 || start + width > height) continue;
    if (
      rows
        .slice(i, i + size)
        .every((y, r) => Math.abs(y - rows[i] - r * step) < step * 0.18)
    )
      return { left: 0, top: start, width, height: width };
  }
  return null;
}
