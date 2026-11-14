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
  width: number;
  height: number;
  type: number;
}

interface Fit {
  left: number;
  top: number;
  stepX: number;
  stepY: number;
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
  const maxWidth = Math.ceil(width / SIZE);
  const maxHeight = Math.ceil(height / SIZE);
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
      w <= maxWidth &&
      h <= maxHeight &&
      Math.min(w, h) >= Math.max(w, h) * 0.75 &&
      count >= w * h * 0.58
    )
      anchors.push({
        x: (left + right + 1) / 2,
        y: (top + bottom + 1) / 2,
        width: w,
        height: h,
        type,
      });
    // Bound the template search for unrelated or unusually busy images.
    if (anchors.length > 96) return [];
  }
  return anchors;
}

function inBounds({ left, top, stepX, stepY }: Fit, { width, height }: Pixels) {
  return (
    Math.min(stepX, stepY) >= Math.max(stepX, stepY) * 0.8 &&
    left >= -stepX * 0.15 &&
    top >= -stepY * 0.15 &&
    left + SIZE * stepX <= width + stepX * 0.15 &&
    top + SIZE * stepY <= height + stepY * 0.15
  );
}

function fitsCell(anchor: Anchor, stepX: number, stepY: number) {
  return (
    anchor.width >= stepX * 0.72 &&
    anchor.width <= stepX * 1.07 &&
    anchor.height >= stepY * 0.72 &&
    anchor.height <= stepY * 1.07
  );
}

function match(anchors: Anchor[], { left, top, stepX, stepY }: Fit) {
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
    if (!fitsCell(anchor, stepX, stepY)) continue;
    const x = (anchor.x - left) / stepX,
      y = (anchor.y - top) / stepY;
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

// Fit the spacing of each axis from all matching centers. A screenshot can
// stretch a grid slightly, so one scale for both axes can drift across rows.
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
  let covarianceX = 0,
    covarianceY = 0,
    varianceX = 0,
    varianceY = 0;
  for (const { anchor, x, y } of inliers) {
    const dc = x - meanCol,
      dr = y - meanRow;
    covarianceX += dc * (anchor.x - meanX);
    covarianceY += dr * (anchor.y - meanY);
    varianceX += dc * dc;
    varianceY += dr * dr;
  }
  const stepX = covarianceX / varianceX;
  const stepY = covarianceY / varianceY;
  return {
    left: meanX - meanCol * stepX,
    top: meanY - meanRow * stepY,
    stepX,
    stepY,
  };
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
      if (
        Math.hypot(dx, dy) <
        Math.max(a.width, a.height, b.width, b.height) * 5
      )
        continue;
      for (const start of positions[a.type - 1]) {
        for (const end of positions[b.type - 1]) {
          const dc = end.x - start.x,
            dr = end.y - start.y;
          if (!dc && !dr) continue;
          const step = (dx * dc + dy * dr) / (dc * dc + dr * dr);
          // Over short distances rounding can strongly bias the slope. Use
          // the shared estimate as a seed on that axis until refinement.
          const stepX = Math.abs(dc) >= 3 ? dx / dc : step;
          const stepY = Math.abs(dr) >= 3 ? dy / dr : step;
          if (
            !fitsCell(a, stepX, stepY) ||
            !fitsCell(b, stepX, stepY) ||
            Math.abs(dx - dc * stepX) > stepX * 0.2 ||
            Math.abs(dy - dr * stepY) > stepY * 0.2
          )
            continue;
          const fit = {
            left: (a.x + b.x - (start.x + end.x) * stepX) / 2,
            top: (a.y + b.y - (start.y + end.y) * stepY) / 2,
            stepX,
            stepY,
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
  const left = Math.max(0, best.left),
    top = Math.max(0, best.top);
  return {
    left,
    top,
    width: Math.min(image.width, best.left + SIZE * best.stepX) - left,
    height: Math.min(image.height, best.top + SIZE * best.stepY) - top,
  };
}
