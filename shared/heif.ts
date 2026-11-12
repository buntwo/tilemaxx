export const isHeif = (file: { name: string; type: string }) =>
  /\.(heic|heif)$/i.test(file.name) ||
  /^image\/(heic|heif)(-sequence)?$/i.test(file.type);
export const acceptsScreenshot = (file: {
  name: string;
  type: string;
  size: number;
}) =>
  file.size <= 20 * 1024 * 1024 &&
  (/^image\/(png|jpeg|webp)$/i.test(file.type) || isHeif(file));
export async function decodeHeif(bytes: Uint8Array) {
  const { default: createModule } =
    await import("libheif-js/libheif-wasm/libheif-bundle.mjs");
  const lib = await createModule();
  const images = new lib.HeifDecoder().decode(bytes);
  try {
    const image = images.find((i) => i.is_primary()) || images[0];
    if (!image)
      throw new Error("No readable image was found in this HEIF file.");
    const width = image.get_width(),
      height = image.get_height();
    if (width <= 0 || height <= 0 || width * height > 32_000_000)
      throw new Error(
        "This image is too large. Crop or resize it to under 32 megapixels.",
      );
    const pixels = {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    };
    return await new Promise<typeof pixels>((resolve, reject) =>
      image.display(pixels, (result) =>
        result
          ? resolve(result)
          : reject(new Error("Could not decode this HEIF image.")),
      ),
    );
  } finally {
    for (const image of images) image.free();
  }
}
