import type { Crop, Pixels } from "./screenshot";

// Find the repeated, evenly spaced horizontal and vertical edges of a board.
// Sample at a bounded resolution so large phone images do not monopolize the UI.
export function detectBoard(image: Pixels, size: number): Crop | null {
  if (!Number.isInteger(size) || size < 5 || size > 25) return null;
  const scale = Math.min(1, 600 / Math.max(image.width, image.height));
  const w = Math.round(image.width * scale),
    h = Math.round(image.height * scale);
  if (Math.min(w, h) < size * 8) return null;
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const source =
        (Math.min(image.height - 1, Math.floor(y / scale)) * image.width +
          Math.min(image.width - 1, Math.floor(x / scale))) *
        4;
      for (let c = 0; c < 3; c++)
        rgb[(y * w + x) * 3 + c] = image.data[source + c];
    }
  function projections(
    left: number,
    top: number,
    right: number,
    bottom: number,
  ) {
    const vx = new Float64Array(w),
      hy = new Float64Array(h);
    for (let y = top; y < bottom; y++)
      for (let x = left; x < right; x++) {
        const p = (y * w + x) * 3;
        for (let c = 0; c < 3; c++) {
          if (x > 0)
            vx[x] +=
              Math.abs(rgb[p + c] - rgb[p - 3 + c]) / (3 * (bottom - top));
          if (y > 0)
            hy[y] +=
              Math.abs(rgb[p + c] - rgb[p - w * 3 + c]) / (3 * (right - left));
        }
      }
    return { vx, hy };
  }
  function axis(values: Float64Array, start: number, side: number) {
    let edge = 0,
      middle = 0,
      hits = 0;
    const peak = (position: number) => {
      const p = Math.round(position);
      return Math.max(values[p - 1] || 0, values[p] || 0, values[p + 1] || 0);
    };
    for (let k = 0; k <= size; k++) {
      const e = peak(start + (k * side) / size),
        m = k < size ? peak(start + ((k + 0.5) * side) / size) : 0;
      edge += e;
      middle += m;
      if (e > m + 1.5) hits++;
    }
    return hits >= (size - 1) * 0.7 ? (edge - middle) / (size - 1) : 0;
  }
  const { vx, hy } = projections(0, 0, w, h);
  let best: { left: number; top: number; side: number; score: number } | null =
    null;
  for (
    let side = Math.min(w, h);
    side >= Math.max(size * 8, Math.min(w, h) * 0.35);
    side -= 1
  ) {
    let xs = 0,
      ys = 0,
      left = 0,
      top = 0;
    for (let x = 0; x <= w - side; x++) {
      const score = axis(vx, x, side);
      if (score > xs) {
        xs = score;
        left = x;
      }
    }
    if (xs < 2) continue;
    for (let y = 0; y <= h - side; y++) {
      const score = axis(hy, y, side);
      if (score > ys) {
        ys = score;
        top = y;
      }
    }
    const score = Math.sqrt(xs * ys) * (1 + (0.1 * side) / Math.min(w, h));
    if (ys >= 2 && (!best || score > best.score))
      best = { left, top, side, score };
  }
  if (!best || best.score < 4) return null;
  const local = projections(
    best.left,
    best.top,
    best.left + best.side,
    best.top + best.side,
  );
  if (
    axis(local.vx, best.left, best.side) < 4 ||
    axis(local.hy, best.top, best.side) < 4
  )
    return null;
  return {
    left: Math.round(best.left / scale),
    top: Math.round(best.top / scale),
    width: Math.min(
      image.width - Math.round(best.left / scale),
      Math.round(best.side / scale),
    ),
    height: Math.min(
      image.height - Math.round(best.top / scale),
      Math.round(best.side / scale),
    ),
  };
}
