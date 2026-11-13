import { emptyBoard } from "./model";
import type { Glyph, Recognition } from "./screenshot";

export interface GlyphReading {
  text: string;
  confidence: number;
}

export type GlyphPass = "block" | "character" | "smallCharacter";

export const OCR_TILE_SIZE = 96;

// Scale the binary mask and center it on white. Integer coordinates and
// explicit sampling keep the OCR input independent of canvas interpolation.
export function renderGlyph(
  glyph: Glyph,
  pass: GlyphPass,
): Uint8ClampedArray<ArrayBuffer> {
  const cap = pass === "smallCharacter" ? 40 : 64;
  const scale = Math.min((cap - 4) / glyph.width, cap / glyph.height);
  const width = Math.round(glyph.width * scale);
  const height = Math.round(glyph.height * scale);
  const left = Math.round((OCR_TILE_SIZE - width) / 2);
  const top = Math.round((OCR_TILE_SIZE - height) / 2);
  const data = new Uint8ClampedArray(OCR_TILE_SIZE ** 2 * 4).fill(255);
  for (let y = 0; y < height; y++) {
    const sourceY = Math.max(
      0,
      Math.min(glyph.height - 1, ((y + 0.5) * glyph.height) / height - 0.5),
    );
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(y0 + 1, glyph.height - 1);
    const fy = sourceY - y0;
    for (let x = 0; x < width; x++) {
      const sourceX = Math.max(
        0,
        Math.min(glyph.width - 1, ((x + 0.5) * glyph.width) / width - 0.5),
      );
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(x0 + 1, glyph.width - 1);
      const fx = sourceX - x0;
      const upper =
        glyph.data[(y0 * glyph.width + x0) * 4] * (1 - fx) +
        glyph.data[(y0 * glyph.width + x1) * 4] * fx;
      const lower =
        glyph.data[(y1 * glyph.width + x0) * 4] * (1 - fx) +
        glyph.data[(y1 * glyph.width + x1) * 4] * fx;
      const target = ((top + y) * OCR_TILE_SIZE + left + x) * 4;
      data[target] =
        data[target + 1] =
        data[target + 2] =
          upper * (1 - fy) + lower * fy;
    }
  }
  return data;
}

function normalizeCharacter(text: string, glyph: Glyph): string {
  if (/^[a-z]$/i.test(text)) return text.toUpperCase();
  if (/^(?:1|\|)$/.test(text) && glyph.width / glyph.height < 0.3) return "I";
  if (text === "0" && glyph.width / glyph.height >= 0.75) return "O";
  // OCR can split a wide uppercase letter into repeated cases of itself.
  if (/^([a-z])\1{1,2}$/i.test(text)) return text[0].toUpperCase();
  return "";
}

export async function readGlyphs(
  glyphs: readonly Glyph[],
  size: number,
  read: (glyph: Glyph, pass: GlyphPass) => Promise<GlyphReading>,
  progress: (completed: number, total: number) => void,
  check: () => void,
): Promise<Recognition> {
  const board = emptyBoard(size);
  const uncertain: number[] = [];
  for (const [i, glyph] of glyphs.entries()) {
    check();
    progress(i + 1, glyphs.length);
    const primary = await read(glyph, "block");
    check();
    const text = primary.text.trim();
    let letter = /^[A-Z]$/.test(text) ? text : "";
    let confidence = primary.confidence;
    if (glyph.warmTile && (!letter || confidence < 65)) {
      const fallback = await read(glyph, "character");
      check();
      const fallbackText = fallback.text.trim();
      const candidate = normalizeCharacter(fallbackText, glyph);
      // A plain vertical I can score poorly even when OCR sees a vertical bar.
      const minConfidence =
        fallbackText === "|" && candidate === "I" && !letter ? 40 : 55;
      if (
        candidate &&
        fallback.confidence >= minConfidence &&
        (!letter || fallback.confidence > confidence)
      ) {
        letter = candidate;
        confidence = fallback.confidence;
      }
    }
    if (glyph.warmTile && !letter) {
      const smaller = await read(glyph, "smallCharacter");
      check();
      if (smaller.confidence >= 60) {
        letter = normalizeCharacter(smaller.text.trim(), glyph);
        // A reading only visible at this scale still needs a review mark.
        confidence = Math.min(smaller.confidence, 74);
      }
    }
    if (letter)
      board[glyph.index] = glyph.assignedBlank ? letter.toLowerCase() : letter;
    if (!letter || confidence < 75 || glyph.assignedBlank)
      uncertain.push(glyph.index);
  }
  return { board, uncertain, candidates: glyphs.length };
}
