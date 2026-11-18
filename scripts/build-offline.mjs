import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const assets = [
  "/index.html",
  "/favicon.svg",
  "/dictionaries/wordfreq-en-3.1.1.msgpack.gz",
  ...(await readdir("dist/assets")).sort().map((name) => `/assets/${name}`),
];
// Tesseract chooses the SIMD or portable LSTM engine. These JS files embed WASM.
const ocr = [
  "/ocr/worker.min.js",
  "/ocr/eng.traineddata.gz",
  "/ocr/tesseract-core-lstm.wasm.js",
  "/ocr/tesseract-core-simd-lstm.wasm.js",
];
const worker = await readFile("scripts/offline-worker.js", "utf8");
const hash = createHash("sha256").update(worker);
for (const path of [...assets, ...ocr])
  hash.update(await readFile(`dist${path}`));
const name = `tilemaxx-app-${hash.digest("hex").slice(0, 16)}`;
const ocrHash = createHash("sha256");
for (const path of ocr) ocrHash.update(await readFile(`dist${path}`));
const ocrName = `tilemaxx-ocr-${ocrHash.digest("hex").slice(0, 16)}`;
await writeFile(
  "dist/sw.js",
  [
    `const CACHE_NAME = ${JSON.stringify(name)};`,
    `const OCR_CACHE_NAME = ${JSON.stringify(ocrName)};`,
    `const ASSETS = ${JSON.stringify(assets)};`,
    `const OCR_ASSETS = ${JSON.stringify(ocr)};`,
    worker,
  ].join("\n"),
);
console.log(
  `Offline app ready: ${assets.length} app assets, ${ocr.length} OCR assets.`,
);
