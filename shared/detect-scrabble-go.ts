import { PRESETS } from "./presets";
import type { Crop, Pixels } from "./screenshot";

const SIZE = 15;
const premiumTypes = ["TW", "DW", "TL", "DL"];
const premiums = PRESETS[0].premiums.map(
  (premium) => premiumTypes.indexOf(premium) + 1,
);
const positions = premiumTypes.map((_, type) =>
  premiums.flatMap((premium, i) =>
    premium === type + 1
      ? [{ x: (i % SIZE) + 0.5, y: Math.floor(i / SIZE) + 0.5 }]
      : [],
  ),
);

interface Anchor {
  x: number;
  y: number;
  span: number;
  type: number;
}

interface Fit {
  left: number;
  top: number;
  step: number;
}

// Classify broad HSV ranges so compression, display color, and theme changes
// do not require every premium to match one RGB swatch.
function premiumColor(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min;
  if (max < 120 || delta < max * 0.23) return 0;
  const hue =
    max === r
      ? (60 * (g - b)) / delta
      : max === b
        ? 240 + (60 * (r - g)) / delta
        : 120 + (60 * (b - r)) / delta;
  if (max >= 175 && hue >= -47 && hue <= -10 && delta >= max * 0.52) return 1;
  if (max >= 195 && hue >= 3 && hue <= 24 && delta >= max * 0.35) return 2;
  if (hue < 188 || hue > 223) return 0;
  if (max <= 211 && delta >= max * 0.45) return 3;
  if (max >= 205 && delta <= max * 0.57) return 4;
  return 0;
}

function findAnchors({ width, height, data }: Pixels): Anchor[] {
  const labels = new Uint8Array(width * height);
  for (let i = 0; i < labels.length; i++)
    labels[i] = premiumColor(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  const anchors: Anchor[] = [];
  const max = Math.ceil(Math.min(width, height) / SIZE);
  const stack: number[] = [];
  for (let i = 0; i < labels.length; i++) {
    const type = labels[i];
    if (!type) continue;
    labels[i] = 0;
    stack.push(i);
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
      if (x && labels[p - 1] === type) {
        labels[p - 1] = 0;
        stack.push(p - 1);
      }
      if (x + 1 < width && labels[p + 1] === type) {
        labels[p + 1] = 0;
        stack.push(p + 1);
      }
      if (labels[p - width] === type) {
        labels[p - width] = 0;
        stack.push(p - width);
      }
      if (labels[p + width] === type) {
        labels[p + width] = 0;
        stack.push(p + width);
      }
    }
    const w = right - left + 1,
      h = bottom - top + 1;
    if (
      Math.min(w, h) >= 6 &&
      Math.max(w, h) <= max &&
      Math.min(w, h) >= Math.max(w, h) * 0.75 &&
      count >= w * h * 0.58
    )
      anchors.push({
        x: (left + right + 1) / 2,
        y: (top + bottom + 1) / 2,
        span: (w + h) / 2,
        type,
      });
    // Bound the template search for unrelated or unusually busy images.
    if (anchors.length > 96) return [];
  }
  return anchors;
}

function inBounds({ left, top, step }: Fit, { width, height }: Pixels) {
  const inset = step * 0.15;
  return (
    left >= -inset &&
    top >= -inset &&
    left + SIZE * step <= width + inset &&
    top + SIZE * step <= height + inset
  );
}

function match(anchors: Anchor[], { left, top, step }: Fit) {
  let minX = SIZE,
    minY = SIZE,
    maxX = 0,
    maxY = 0,
    types = 0,
    misses = 0,
    residual = 0;
  const inliers: { anchor: Anchor; x: number; y: number }[] = [];
  const cells = new Set<number>();
  for (const anchor of anchors) {
    if (anchor.span < step * 0.72 || anchor.span > step * 1.07) continue;
    const x = (anchor.x - left) / step,
      y = (anchor.y - top) / step;
    const col = Math.floor(x),
      row = Math.floor(y);
    const dx = x - col - 0.5,
      dy = y - row - 0.5;
    if (
      col < 0 ||
      col >= SIZE ||
      row < 0 ||
      row >= SIZE ||
      Math.abs(dx) > 0.18 ||
      Math.abs(dy) > 0.18
    )
      continue;
    const cell = row * SIZE + col;
    if (premiums[cell] !== anchor.type) {
      misses++;
      continue;
    }
    if (cells.has(cell)) continue;
    cells.add(cell);
    minX = Math.min(minX, col);
    maxX = Math.max(maxX, col);
    minY = Math.min(minY, row);
    maxY = Math.max(maxY, row);
    types |= 1 << anchor.type;
    residual += dx * dx + dy * dy;
    inliers.push({ anchor, x: col + 0.5, y: row + 0.5 });
  }
  if (
    inliers.length < 8 ||
    misses > inliers.length / 4 ||
    maxX - minX < 5 ||
    maxY - minY < 5 ||
    !(types & (types - 1))
  )
    return null;
  return {
    inliers,
    score: inliers.length - 2 * misses - residual / inliers.length,
  };
}

// Least-squares grid fit using all matching centers, with one scale for both axes.
function refine(
  inliers: NonNullable<ReturnType<typeof match>>["inliers"],
): Fit {
  let meanX = 0,
    meanY = 0,
    meanCol = 0,
    meanRow = 0;
  for (const { anchor, x, y } of inliers) {
    meanX += anchor.x;
    meanY += anchor.y;
    meanCol += x;
    meanRow += y;
  }
  const n = inliers.length;
  meanX /= n;
  meanY /= n;
  meanCol /= n;
  meanRow /= n;
  let covariance = 0,
    variance = 0;
  for (const { anchor, x, y } of inliers) {
    const dc = x - meanCol,
      dr = y - meanRow;
    covariance += dc * (anchor.x - meanX) + dr * (anchor.y - meanY);
    variance += dc * dc + dr * dr;
  }
  const step = covariance / variance;
  return { left: meanX - meanCol * step, top: meanY - meanRow * step, step };
}

// Propose alignments from pairs of landmarks and score them against the Scrabble
// template. Played tiles obscure premiums, so missing landmarks are not penalized.
export function detectScrabbleGoBoard(image: Pixels): Crop | null {
  const anchors = findAnchors(image);
  let best: Fit | null = null,
    bestScore = 0;
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    for (let j = i + 1; j < anchors.length; j++) {
      const b = anchors[j];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      if (Math.hypot(dx, dy) < Math.max(a.span, b.span) * 5) continue;
      for (const start of positions[a.type - 1]) {
        for (const end of positions[b.type - 1]) {
          const dc = end.x - start.x,
            dr = end.y - start.y;
          if (!dc && !dr) continue;
          const step = (dx * dc + dy * dr) / (dc * dc + dr * dr);
          if (
            a.span < step * 0.72 ||
            a.span > step * 1.07 ||
            b.span < step * 0.72 ||
            b.span > step * 1.07 ||
            Math.abs(dx - dc * step) > step * 0.2 ||
            Math.abs(dy - dr * step) > step * 0.2
          )
            continue;
          const fit = {
            left: (a.x + b.x - (start.x + end.x) * step) / 2,
            top: (a.y + b.y - (start.y + end.y) * step) / 2,
            step,
          };
          if (!inBounds(fit, image)) continue;
          const supported = match(anchors, fit);
          if (!supported || supported.score + 0.1 < bestScore) continue;
          const refined = refine(supported.inliers);
          if (!inBounds(refined, image)) continue;
          const verified = match(anchors, refined);
          if (verified && verified.score > bestScore) {
            best = refined;
            bestScore = verified.score;
          }
        }
      }
    }
  }
  if (!best) return null;
  const side = Math.min(SIZE * best.step, image.width, image.height);
  return {
    left: Math.max(0, Math.min(best.left, image.width - side)),
    top: Math.max(0, Math.min(best.top, image.height - side)),
    width: side,
    height: side,
  };
}
