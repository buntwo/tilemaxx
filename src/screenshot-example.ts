import { type Board } from "../shared/model";
import { type Crop, type Recognition } from "../shared/screenshot";

export async function saveScreenshotExample(
  image: HTMLImageElement,
  crop: Crop,
  size: number,
  recognized: Recognition,
  corrected: Board,
): Promise<{ id: string }> {
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1500 / Math.max(crop.width, crop.height));
  canvas.width = Math.max(1, Math.round(crop.width * scale));
  canvas.height = Math.max(1, Math.round(crop.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not copy the cropped board.");
  context.drawImage(
    image,
    crop.left,
    crop.top,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const response = await fetch("/api/screenshot-examples", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      size,
      crop,
      sourceWidth: image.naturalWidth,
      sourceHeight: image.naturalHeight,
      recognized,
      corrected,
      croppedPng: canvas
        .toDataURL("image/png")
        .slice("data:image/png;base64,".length),
    }),
  });
  if (!response.ok)
    throw new Error(
      "Could not save the corrected example. Check your Tilemaxx server and try again.",
    );
  return response.json();
}
