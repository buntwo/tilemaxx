import type { Worker } from "tesseract.js";
import { emptyBoard } from "../shared/model";
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
  const board = emptyBoard(size),
    uncertain: number[] = [];
  if (!glyphs.length) return { board, uncertain, candidates: 0 };
  progress("Loading letter recognition…");
  const { createWorker, PSM } = await import("tesseract.js");
  check();
  let worker: Worker | undefined;
  const cancel = () => {
    void worker?.terminate();
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    worker = await createWorker("eng", 1, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr",
      langPath: "/ocr",
      logger: (m) => {
        if (!signal.aborted && m.status === "loading language traineddata")
          progress("Loading English letters…");
      },
    });
    check();
    await worker.setParameters({
      user_defined_dpi: "300",
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    });
    const tile = document.createElement("canvas"),
      glyph = document.createElement("canvas");
    tile.width = tile.height = 96;
    const tc = tile.getContext("2d")!;
    for (let i = 0; i < glyphs.length; i++) {
      check();
      progress(`Reading tile ${i + 1} of ${glyphs.length}…`);
      const g = glyphs[i];
      glyph.width = g.width;
      glyph.height = g.height;
      glyph
        .getContext("2d")!
        .putImageData(
          new ImageData(new Uint8ClampedArray(g.data), g.width, g.height),
          0,
          0,
        );
      tc.fillStyle = "white";
      tc.fillRect(0, 0, 96, 96);
      const scale = Math.min(60 / g.width, 64 / g.height),
        width = g.width * scale,
        height = g.height * scale;
      tc.drawImage(glyph, (96 - width) / 2, (96 - height) / 2, width, height);
      const { data } = await worker.recognize(tile);
      check();
      const text = data.text.trim();
      if (/^[A-Z]$/.test(text)) board[g.index] = text;
      if (!board[g.index] || data.confidence < 75) uncertain.push(g.index);
    }
    return { board, uncertain, candidates: glyphs.length };
  } finally {
    signal.removeEventListener("abort", cancel);
    await worker?.terminate();
  }
}
