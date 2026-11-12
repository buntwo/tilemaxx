import { decodeHeif } from "../shared/heif";
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const pixels = await decodeHeif(new Uint8Array(event.data));
    self.postMessage(pixels, { transfer: [pixels.data.buffer] });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error
          ? error.message
          : "Could not decode this HEIF image.",
    });
  }
};
