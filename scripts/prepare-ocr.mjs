import { copyFile, mkdir, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const destination = new URL("../public/ocr/", import.meta.url);
await mkdir(destination, { recursive: true });
const core = dirname(require.resolve("tesseract.js-core/package.json"));
for (const name of await readdir(core)) {
  if (name.endsWith(".wasm.js") || name.endsWith(".wasm"))
    await copyFile(join(core, name), new URL(name, destination));
}
await copyFile(
  require.resolve("tesseract.js/dist/worker.min.js"),
  new URL("worker.min.js", destination),
);
await copyFile(
  join(require("@tesseract.js-data/eng").langPath, "eng.traineddata.gz"),
  new URL("eng.traineddata.gz", destination),
);
console.log("Local OCR assets ready.");
await copyFile(
  require.resolve("tesseract.js/LICENSE.md"),
  new URL("TESSERACT-LICENSE.txt", destination),
);
await copyFile(
  join(core, "LICENSE"),
  new URL("TESSERACT-CORE-LICENSE.txt", destination),
);

await copyFile(
  require.resolve("libheif-js/LICENSE"),
  new URL("LIBHEIF-JS-LICENSE.txt", destination),
);
await copyFile(
  require.resolve("libheif-js/libheif-wasm/LICENSE"),
  new URL("LIBHEIF-WASM-LICENSE.txt", destination),
);
