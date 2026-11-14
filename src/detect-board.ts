import { detectBoard } from "../shared/detect-board";
import { detectScrabbleGoBoard } from "../shared/detect-scrabble-go";

export function findBoard(image: HTMLImageElement, size: number) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  function search(maxEdge: number, detect: typeof detectBoard) {
    const scale = Math.min(
      1,
      maxEdge / Math.max(image.naturalWidth, image.naturalHeight),
    );
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    // Keep the same pixel scale on both axes despite rounding the canvas size.
    ctx.drawImage(
      image,
      0,
      0,
      image.naturalWidth * scale,
      image.naturalHeight * scale,
    );
    const crop = detect(
      ctx.getImageData(0, 0, canvas.width, canvas.height),
      size,
    );
    if (!crop) return null;
    const side = Math.min(
      crop.width / scale,
      image.naturalWidth,
      image.naturalHeight,
    );
    return {
      left: Math.min(crop.left / scale, image.naturalWidth - side),
      top: Math.min(crop.top / scale, image.naturalHeight - side),
      width: side,
      height: side,
    };
  }
  return (
    (size === 15 ? search(1200, detectScrabbleGoBoard) : null) ??
    search(600, detectBoard)
  );
}
