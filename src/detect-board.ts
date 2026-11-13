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
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const crop = detect(
      ctx.getImageData(0, 0, canvas.width, canvas.height),
      size,
    );
    if (!crop) return null;
    const xScale = image.naturalWidth / canvas.width;
    const yScale = image.naturalHeight / canvas.height;
    return {
      left: crop.left * xScale,
      top: crop.top * yScale,
      width: crop.width * xScale,
      height: crop.height * yScale,
    };
  }
  return (
    (size === 15 ? search(1200, detectScrabbleGoBoard) : null) ??
    search(600, detectBoard)
  );
}
