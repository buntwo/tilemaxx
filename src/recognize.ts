import type { Worker } from "tesseract.js";
import { emptyBoard } from "../shared/model";
import {
  OCR_TILE_SIZE,
  readGlyphs,
  renderGlyph,
  type GlyphPass,
} from "../shared/screenshot-ocr";
import {
  extractGlyphs,
  type Crop,
  type Recognition,
} from "../shared/screenshot";

export async function recognizeBoard(
  image: HTMLImageElement,
  crop: Crop,
  size: number,
  progress: (text: string) => void,
  signal: AbortSignal,
): Promise<Recognition> {
  const check = () => {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  };
  check();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const glyphs = extractGlyphs(
    ctx.getImageData(0, 0, canvas.width, canvas.height),
    crop,
    size,
  );
  if (!glyphs.length)
    return { board: emptyBoard(size), uncertain: [], candidates: 0 };
  progress("Loading letter recognition…");
  const { createWorker, PSM } = await import("tesseract.js");
  check();
  let worker: Worker | undefined;
  const cancel = () => {
    void worker?.terminate();
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const engine = (worker = await createWorker("eng", 1, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr",
      langPath: "/ocr",
      logger: (m) => {
        if (!signal.aborted && m.status === "loading language traineddata")
          progress("Loading English letters…");
      },
    }));
    check();
    let mode: GlyphPass | undefined;
    const tile = document.createElement("canvas");
    tile.width = tile.height = OCR_TILE_SIZE;
    const tc = tile.getContext("2d")!;
    return await readGlyphs(
      glyphs,
      size,
      async (g, pass) => {
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
        tc.putImageData(
          new ImageData(renderGlyph(g, pass), OCR_TILE_SIZE, OCR_TILE_SIZE),
          0,
          0,
        );
        const { data } = await engine.recognize(tile);
        return data;
      },
      (completed, total) => progress(`Reading tile ${completed} of ${total}…`),
      check,
    );
  } finally {
    signal.removeEventListener("abort", cancel);
    await worker?.terminate();
  }
}
