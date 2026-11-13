import { type Board, type Game, remember } from "./model";
import { emptyScoring } from "./game-scoring";

export interface Crop {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface Pixels {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}
export interface Glyph {
  index: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
  warmTile: boolean;
  assignedBlank: boolean;
  blueInkFraction: number;
}
export interface Recognition {
  board: Board;
  uncertain: number[];
  candidates: number;
}

export function validateCrop(
  crop: Crop,
  width: number,
  height: number,
  size: number,
) {
  if (
    !Object.values(crop).every(Number.isFinite) ||
    crop.left < 0 ||
    crop.top < 0 ||
    crop.width < size * 12 ||
    crop.height < size * 12 ||
    crop.left + crop.width > width + 1 ||
    crop.top + crop.height > height + 1
  )
    throw new Error(
      "Keep the crop inside the image and include the whole board (at least 12 pixels per square).",
    );
}

// Isolate the main glyph in each square. Small premium labels, borders and the
// point value in the bottom-right corner must not become playable letters.
export function extractGlyphs(
  image: Pixels,
  crop: Crop,
  size: number,
): Glyph[] {
  validateCrop(crop, image.width, image.height, size);
  const glyphs: Glyph[] = [],
    cw = crop.width / size,
    ch = crop.height / size;
  for (let index = 0; index < size * size; index++) {
    const x = Math.round(crop.left + ((index % size) + 0.12) * cw);
    const y = Math.round(crop.top + (Math.floor(index / size) + 0.1) * ch);
    const w = Math.floor(cw * 0.76),
      h = Math.floor(ch * 0.76);
    const gray = new Uint8Array(w * h),
      histogram = new Uint32Array(256);
    const blue = new Uint8Array(w * h);
    let warm = 0;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const p = ((y + j) * image.width + x + i) * 4;
        const r = image.data[p],
          g = image.data[p + 1],
          b = image.data[p + 2];
        if (r > 175 && g > 145 && g - b > 18 && r >= g - 12) warm++;
        if (b - r > 65 && g - r > 25 && b > 135) blue[j * w + i] = 1;
        const v = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
        gray[j * w + i] = v;
        histogram[v]++;
      }
    let background = 0;
    for (let i = 1; i < 256; i++)
      if (histogram[i] > histogram[background]) background = i;
    // Pale wood tiles in Scrabble GO use dark letters and blue assigned blanks.
    const warmTile = warm > gray.length * 0.43;
    const ink = Uint8Array.from(gray, (v, p) =>
      (warmTile ? v < 115 || blue[p] : Math.abs(v - background) > 65) ? 1 : 0,
    );
    const components: {
      pixels: number[];
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    }[] = [];
    for (let p = 0; p < ink.length; p++) {
      if (!ink[p]) continue;
      const stack = [p],
        pixels: number[] = [];
      ink[p] = 0;
      let minX = w,
        minY = h,
        maxX = 0,
        maxY = 0;
      while (stack.length) {
        const q = stack.pop()!,
          xx = q % w,
          yy = Math.floor(q / w);
        pixels.push(q);
        minX = Math.min(minX, xx);
        maxX = Math.max(maxX, xx);
        minY = Math.min(minY, yy);
        maxY = Math.max(maxY, yy);
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = xx + dx,
              ny = yy + dy,
              next = ny * w + nx;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && ink[next]) {
              ink[next] = 0;
              stack.push(next);
            }
          }
      }
      if (pixels.length > 2)
        components.push({ pixels, minX, minY, maxX, maxY });
    }
    const letters = components.filter(
      (c) =>
        c.maxY - c.minY + 1 >= ch * 0.32 &&
        c.maxY - c.minY + 1 <= ch * 0.72 &&
        c.maxX - c.minX + 1 <= cw * (warmTile ? 0.75 : 0.69) &&
        c.pixels.length < w * h * 0.55 &&
        (c.minX + c.maxX) / 2 > w * 0.14 &&
        (c.minX + c.maxX) / 2 < w * 0.82,
    );
    if (letters.length !== 1) continue;
    const c = letters[0];
    // Reject two-letter premiums even when one of the two letters is narrow.
    if (
      components.some(
        (other) =>
          other !== c &&
          other.maxY - other.minY >= (c.maxY - c.minY) * 0.65 &&
          Math.abs(other.minY - c.minY) < ch * 0.12,
      )
    )
      continue;
    const width = c.maxX - c.minX + 1,
      height = c.maxY - c.minY + 1;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    let blueInk = 0;
    for (const p of c.pixels) {
      const out = ((Math.floor(p / w) - c.minY) * width + (p % w) - c.minX) * 4;
      data[out] = data[out + 1] = data[out + 2] = 0;
      blueInk += blue[p];
    }
    const blueInkFraction = warmTile ? blueInk / c.pixels.length : 0;
    glyphs.push({
      index,
      width,
      height,
      data,
      warmTile,
      assignedBlank: blueInkFraction > 0.55,
      blueInkFraction,
    });
  }
  return glyphs;
}

export function importBoard(game: Game, board: Board): Game {
  if (
    board.length !== game.template.size ** 2 ||
    board.some((tile) => !/^[A-Za-z]?$/.test(tile))
  )
    throw new Error("The imported board does not match this game.");
  return {
    ...game,
    ...remember(game, "Imported screenshot"),
    board: [...board],
    scoring: emptyScoring(true),
  };
}
