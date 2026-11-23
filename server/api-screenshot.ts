import { createRequire } from "node:module";
import sharp from "sharp";
import { createWorker, PSM } from "tesseract.js";
import { detectBoard } from "../shared/detect-board";
import { detectScrabbleGoBoard } from "../shared/detect-scrabble-go";
import { decodeHeif } from "../shared/heif";
import { emptyBoard } from "../shared/model";
import { type Crop, type Pixels, validateCrop } from "../shared/screenshot";
import { detectWordfeudBoard } from "../shared/screenshot-premiums";
import {
  OCR_TILE_SIZE,
  prepareScreenshotRecognition,
  readGlyphs,
  renderGlyph,
} from "../shared/screenshot-ocr";
import type { Computation } from "./api-computation";
import { ApiError } from "./api-error";

const localRequire = createRequire(import.meta.url);
const limitInputPixels = 32_000_000;
const tileShape = {
  width: OCR_TILE_SIZE,
  height: OCR_TILE_SIZE,
  channels: 4,
} as const;

const bufferFor = (data: Pixels["data"]) =>
  Buffer.from(data.buffer, data.byteOffset, data.byteLength);

async function detectCrop(pixels: Pixels, size: number) {
  const { width, height } = pixels;
  async function search(maxEdge: number, detect: typeof detectBoard) {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const preview =
      scale === 1
        ? pixels
        : await sharp(bufferFor(pixels.data), {
            raw: { width, height, channels: 4 },
          })
            .resize({
              width: Math.max(1, Math.round(width * scale)),
              height: Math.max(1, Math.round(height * scale)),
              fit: "fill",
            })
            .raw()
            .toBuffer({ resolveWithObject: true })
            .then(({ data, info }) => ({
              data,
              width: info.width,
              height: info.height,
            }));
    const crop = detect(preview, size);
    if (!crop) return null;
    const side = Math.min(crop.width / scale, width, height);
    return {
      left: Math.min(crop.left / scale, width - side),
      top: Math.min(crop.top / scale, height - side),
      width: side,
      height: side,
    } satisfies Crop;
  }
  return (
    (size === 15
      ? ((await search(1200, detectScrabbleGoBoard)) ??
        (await search(1200, detectWordfeudBoard)))
      : null) ?? (await search(600, detectBoard))
  );
}

export async function readScreenshot({
  image,
  format,
  size,
  crop,
}: Extract<Computation, { kind: "screenshot" }>["request"]) {
  const source = Buffer.from(image, "base64");
  let pixels: Pixels;
  try {
    if (format === "heif") {
      pixels = await decodeHeif(source);
    } else {
      const input = sharp(source, { limitInputPixels });
      const metadata = await input.metadata();
      if (metadata.format !== format) throw new Error("Image format mismatch.");
      const { data, info } = await input
        .autoOrient()
        .toColourspace("srgb")
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      pixels = { width: info.width, height: info.height, data };
    }
  } catch {
    throw new ApiError(
      422,
      "Could not decode the screenshot in the supplied format within the 32 MP limit.",
    );
  }
  const selected = crop ?? (await detectCrop(pixels, size));
  if (!selected)
    throw new ApiError(
      422,
      "Could not find the grid. Supply the board crop in pixels.",
    );
  validateCrop(selected, pixels.width, pixels.height, size);
  const { glyphs, premiums } = prepareScreenshotRecognition(
    pixels,
    selected,
    size,
  );
  const metadata = {
    crop: selected,
    sourceWidth: pixels.width,
    sourceHeight: pixels.height,
  };
  if (!glyphs.length)
    return {
      ...metadata,
      board: emptyBoard(size),
      uncertain: [],
      candidates: 0,
      premiums,
    };

  const engine = await createWorker("eng", 1, {
    langPath: localRequire("@tesseract.js-data/eng").langPath,
    cacheMethod: "none",
  });
  try {
    let mode: "block" | "character" | undefined;
    const result = await readGlyphs(
      glyphs,
      size,
      async (glyph, pass) => {
        const nextMode = pass === "block" ? "block" : "character";
        if (mode !== nextMode) {
          await engine.setParameters({
            user_defined_dpi: "300",
            tessedit_char_whitelist:
              pass === "block" ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ" : "",
            tessedit_pageseg_mode:
              pass === "block" ? PSM.SINGLE_BLOCK : PSM.SINGLE_CHAR,
          });
          mode = nextMode;
        }
        const tile = await sharp(bufferFor(renderGlyph(glyph, pass)), {
          raw: tileShape,
        })
          .png()
          .toBuffer();
        return (await engine.recognize(tile)).data;
      },
      () => {},
      () => {},
    );
    return { ...metadata, ...result, premiums };
  } finally {
    await engine.terminate();
  }
}
