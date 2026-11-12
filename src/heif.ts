// Each conversion gets a disposable worker, bounding CPU time and releasing WASM memory.
export async function convertHeif(
  file: File,
  signal: AbortSignal,
): Promise<Blob> {
  const bytes = await file.arrayBuffer();
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./heif.worker.ts", import.meta.url), {
      type: "module",
    });
    const cleanup = () => {
      clearTimeout(timer);
      worker.terminate();
      signal.removeEventListener("abort", cancel);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cancel = () => fail(new DOMException("Cancelled", "AbortError"));
    const timer = setTimeout(
      () =>
        fail(
          new Error(
            "This HEIF image took too long to open. Try a smaller image.",
          ),
        ),
      20000,
    );
    signal.addEventListener("abort", cancel, { once: true });
    worker.onerror = () => fail(new Error("Could not open this HEIF image."));
    worker.onmessage = (event) => {
      if (event.data.error) {
        fail(new Error(event.data.error));
        return;
      }
      const { width, height, data } = event.data;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas
          .getContext("2d")!
          .putImageData(new ImageData(data, width, height), 0, 0);
        canvas.toBlob((blob) => {
          cleanup();
          if (signal.aborted)
            reject(new DOMException("Cancelled", "AbortError"));
          else if (blob) resolve(blob);
          else reject(new Error("Could not convert this HEIF image."));
        }, "image/png");
      } catch (error) {
        fail(error as Error);
      }
    };
    worker.postMessage(bytes, [bytes]);
  });
}
