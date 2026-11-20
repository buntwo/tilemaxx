import { resolve, join } from "node:path";
import { importDefinitions } from "../server/definition-import";

const dataDir = resolve(process.env.DATA_DIR || "data");

try {
  const result = await importDefinitions(dataDir, (name) =>
    console.log(`Importing ${name}…`),
  );
  if (!result.sources.length) {
    console.error(
      `No definition exports found in ${join(dataDir, "definitions")}.`,
    );
    process.exitCode = 1;
  } else {
    for (const { filename, status, entries } of result.sources)
      console.log(
        `${filename}: ${entries.toLocaleString()} entries (${status})`,
      );
    console.log(`Definition index: ${result.database}`);
  }
} catch (error) {
  console.error(`Definition import failed: ${(error as Error).message}`);
  process.exitCode = 1;
}
