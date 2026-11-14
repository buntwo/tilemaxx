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
  const shorter = Math.min(w, h);
  const minSpan = Math.ceil(Math.max(size * 8, shorter * 0.35));
  // Find possible stretches in each direction, then pair results of
  // similar size. Keep the prior preference for a grid that fills the image.
  function axisFits(values: Float64Array) {
    const fits: { start: number; span: number; score: number }[] = [];
    const maxSpan = Math.min(values.length, Math.floor(shorter / 0.8));
    for (let span = maxSpan; span >= minSpan; span--) {
      let start = 0;
      let bestScore = 0;
      for (let offset = 0; offset <= values.length - span; offset++) {
        const score = axis(values, offset, span);
        if (score > bestScore) {
          start = offset;
          bestScore = score;
        }
      }
      if (bestScore >= 2) fits.push({ start, span, score: bestScore });
    }
    return fits;
  }
  const xs = axisFits(vx),
    ys = axisFits(hy);
  let best: (Crop & { score: number }) | null = null;
  for (const x of xs) {
    for (const y of ys) {
      const smaller = Math.min(x.span, y.span);
      if (smaller < Math.max(x.span, y.span) * 0.8) continue;
      const score =
        Math.sqrt(x.score * y.score) * (1 + (0.1 * smaller) / shorter);
      if (!best || score > best.score)
        best = {
          left: x.start,
          top: y.start,
          width: x.span,
          height: y.span,
          score,
        };
    }
  }
  if (!best || best.score < 4) return null;
  const local = projections(
    best.left,
    best.top,
    best.left + best.width,
    best.top + best.height,
  );
  if (
    axis(local.vx, best.left, best.width) < 4 ||
    axis(local.hy, best.top, best.height) < 4
  )
    return null;
  return {
    left: Math.round(best.left / scale),
    top: Math.round(best.top / scale),
    width: Math.min(
      image.width - Math.round(best.left / scale),
      Math.round(best.width / scale),
    ),
    height: Math.min(
      image.height - Math.round(best.top / scale),
      Math.round(best.height / scale),
    ),
  };
}
