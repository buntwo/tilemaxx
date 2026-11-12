import { detectBoard } from "../shared/detect-board";
export function findBoard(image: HTMLImageElement, size: number) {
  const scale = Math.min(
    1,
    600 / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const crop = detectBoard(
    ctx.getImageData(0, 0, canvas.width, canvas.height),
    size,
  );
  return crop
    ? {
        left: crop.left / scale,
        top: crop.top / scale,
        width: crop.width / scale,
        height: crop.height / scale,
      }
    : null;
}
