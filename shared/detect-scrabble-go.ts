import { PRESETS } from "./presets";
import type { Crop, Pixels } from "./screenshot";

const SIZE = 15;
const premiums = PRESETS[0].premiums;
const tripleWords = premiums.flatMap((premium, index) =>
  premium === "TW"
    ? [{ col: index % SIZE, row: Math.floor(index / SIZE) }]
    : [],
);

const palette = [
  { premium: "TW", rgb: [218, 56, 120] },
  { premium: "DW", rgb: [240, 145, 119] },
  { premium: "TL", rgb: [56, 118, 173] },
  { premium: "DL", rgb: [160, 201, 250] },
] as const;

interface Anchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

function findTripleWords({ width, height, data }: Pixels): Anchor[] {
  const red = new Uint8Array(width * height);
  for (let i = 0; i < red.length; i++) {
    const r = data[i * 4],
      g = data[i * 4 + 1],
      b = data[i * 4 + 2];
    if (
      r >= 175 &&
      r - g > 100 &&
      b - g > 35 &&
      r - b > 45 &&
      b > 85 &&
      b < 155
    )
      red[i] = 1;
  }
  const anchors: Anchor[] = [];
  const min = 6;
  const max = Math.min(width, height) / SIZE;
  for (let i = 0; i < red.length; i++) {
    if (!red[i]) continue;
    red[i] = 0;
    const stack = [i];
    let left = width,
      right = 0,
      top = height,
      bottom = 0,
      count = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % width,
        y = Math.floor(p / width);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      count++;
      const neighbors = [
        x > 0 ? p - 1 : -1,
        x + 1 < width ? p + 1 : -1,
        p - width,
        p + width,
      ];
      for (const next of neighbors)
        if (red[next]) {
          red[next] = 0;
          stack.push(next);
        }
    }
    const w = right - left + 1,
      h = bottom - top + 1;
    if (
      w >= min &&
      h >= min &&
      w <= max &&
      h <= max &&
      Math.min(w, h) >= Math.max(w, h) * 0.75 &&
      count >= w * h * 0.6
    )
      anchors.push({
        x: (left + right + 1) / 2,
        y: (top + bottom + 1) / 2,
        width: w,
        height: h,
      });
  }
  return anchors;
}

function scoreCrop(image: Pixels, crop: Crop): number {
  const step = crop.width / SIZE;
  let matches = 0,
    misses = 0,
    tripleMatches = 0;
  for (let i = 0; i < premiums.length; i++) {
    // Sample away from the printed labels in the middle of the squares.
    const x = Math.floor(crop.left + ((i % SIZE) + 0.25) * step);
    const y = Math.floor(crop.top + (Math.floor(i / SIZE) + 0.25) * step);
    const p = (y * image.width + x) * 4;
    const color = palette.find(
      ({ rgb: [r, g, b] }) =>
        Math.abs(image.data[p] - r) +
          Math.abs(image.data[p + 1] - g) +
          Math.abs(image.data[p + 2] - b) <
        50,
    );
    if (!color) continue; // Played tiles can hide a premium.
    if (color.premium !== premiums[i]) misses++;
    else {
      matches++;
      if (color.premium === "TW") tripleMatches++;
    }
  }
  return tripleMatches >= 3 && matches >= 10 && misses <= matches / 4
    ? matches - 2 * misses
    : 0;
}

// Scrabble GO repeats grid lines even when a candidate starts one row too low.
// Locate the triple-word squares first, then verify the other premium positions.
export function detectScrabbleGoBoard(image: Pixels): Crop | null {
  const anchors = findTripleWords(image);
  // Avoid a large pair search on images that do not resemble a game board.
  if (anchors.length < 3 || anchors.length > 32) return null;
  let best: Crop | null = null,
    bestScore = 0;
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    for (const b of anchors.slice(i + 1)) {
      const dx = b.x - a.x,
        dy = b.y - a.y;
      if (Math.hypot(dx, dy) < a.width * 6) continue;
      for (const start of tripleWords) {
        for (const end of tripleWords) {
          const dc = end.col - start.col,
            dr = end.row - start.row;
          if (!dc && !dr) continue;
          const step = (dx * dc + dy * dr) / (dc * dc + dr * dr);
          if (
            [a.width, a.height, b.width, b.height].some(
              (span) => span < step * 0.72 || span > step * 1.05,
            )
          )
            continue;
          if (
            Math.abs(dx - dc * step) > step * 0.1 ||
            Math.abs(dy - dr * step) > step * 0.1
          )
            continue;
          const left = (a.x + b.x - (start.col + end.col + 1) * step) / 2;
          const top = (a.y + b.y - (start.row + end.row + 1) * step) / 2;
          const side = SIZE * step;
          // A grid can touch the image border. Allow a small error from sampling.
          const inset = step * 0.12;
          if (
            left < -inset ||
            top < -inset ||
            left + side > image.width + inset ||
            top + side > image.height + inset
          )
            continue;
          const crop = {
            left: Math.max(0, left),
            top: Math.max(0, top),
            width: side,
            height: side,
          };
          const score = scoreCrop(image, crop);
          if (score > bestScore) {
            best = crop;
            bestScore = score;
          }
        }
      }
    }
  }
  if (!best) return null;
  return {
    ...best,
    width: Math.min(best.width, image.width - best.left),
    height: Math.min(best.height, image.height - best.top),
  };
}
