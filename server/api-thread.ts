import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

export function startApiThread(built: URL, source: URL, data: object = {}) {
  if (existsSync(built)) return new Worker(built, { workerData: data, execArgv: [] });
  return new Worker(
    'require("tsx/cjs"); require(require("node:worker_threads").workerData.entry);',
    {
      eval: true,
      workerData: { ...data, entry: fileURLToPath(source) },
      execArgv: [],
    },
  );
}
