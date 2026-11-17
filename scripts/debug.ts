import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { gameSchema } from "../server/validation";

const help = `Usage:
  npm run debug:games -- --server http://NAS:4173 [--profile NAME_OR_ID] [--name TEXT]
  npm run debug:game -- GAME_ID --server http://NAS:4173

Set TILEMAXX_DEBUG_SERVER instead of passing --server each time.
All HTTP requests use GET. Snapshots are saved under ignored data/debug/.
The server must have the /api/debug endpoints deployed first.`;

const indexSchema = z.object({
  profiles: z.array(z.object({ id: z.string(), name: z.string() })),
  games: z.array(
    z.object({
      id: z.uuid(),
      profileId: z.string(),
      name: z.string(),
      archived: z.boolean(),
      revision: z.number().int(),
    }),
  ),
});
const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  serverVersion: z.string(),
  exportedAt: z.iso.datetime(),
  game: gameSchema,
  dictionary: z.object({
    id: z.string(),
    name: z.string(),
    text: z.string(),
    sha256: z.string(),
  }),
});

export async function runDebug(
  args: string[],
  options: {
    root?: string;
    server?: string;
    log?: (text: string) => void;
  } = {},
) {
  const log = options.log ?? console.log;
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      server: { type: "string" },
      profile: { type: "string" },
      name: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    log(help);
    return;
  }
  const [command, id, ...extra] = positionals;
  if (
    !["games", "game"].includes(command) ||
    extra.length ||
    (command === "games" && id) ||
    (command === "game" && !z.uuid().safeParse(id).success) ||
    (command === "game" &&
      (values.name !== undefined || values.profile !== undefined))
  ) {
    throw new Error(help);
  }
  const server =
    values.server ?? options.server ?? process.env.TILEMAXX_DEBUG_SERVER;
  if (!server)
    throw new Error(`Specify --server or TILEMAXX_DEBUG_SERVER.\n${help}`);
  const base = new URL(server);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== "/"
  ) {
    throw new Error("Server must be an http(s) origin, e.g. http://NAS:4173.");
  }
  const url = new URL(
    `/api/debug/games${command === "game" ? `/${id}` : ""}`,
    base,
  );
  const response = await fetch(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `Debug API returned HTTP ${response.status}.${response.status === 404 ? " Check that the debugging API is deployed and the game ID exists." : ""}`,
    );
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error(
      "Expected JSON from the debugging API. Check the server URL and deployed version.",
    );
  }
  const raw: unknown = await response.json();
  if (command === "games") {
    const index = indexSchema.parse(raw);
    const rows = index.games.filter((game) => {
      const profile = index.profiles.find((p) => p.id === game.profileId);
      return (
        (!values.profile ||
          game.profileId === values.profile ||
          profile?.name.toLowerCase() === values.profile.toLowerCase()) &&
        (!values.name ||
          game.name.toLowerCase().includes(values.name.toLowerCase()))
      );
    });
    log(
      [
        "ID\tPROFILE\tGAME\tSTATUS\tREVISION",
        ...rows.map((game) =>
          [
            game.id,
            index.profiles.find((p) => p.id === game.profileId)?.name ??
              game.profileId,
            game.name,
            game.archived ? "archived" : "active",
            game.revision,
          ]
            .map((value) => String(value).replace(/[\t\r\n]/g, " "))
            .join("\t"),
        ),
      ].join("\n"),
    );
    return;
  }
  const snapshot = snapshotSchema.parse(raw);
  if (
    snapshot.game.id !== id ||
    snapshot.dictionary.id !== snapshot.game.dictionaryId ||
    createHash("sha256").update(snapshot.dictionary.text).digest("hex") !==
      snapshot.dictionary.sha256
  ) {
    throw new Error("Snapshot game or dictionary does not match the request.");
  }
  const parent = resolve(options.root ?? process.cwd(), "data/debug");
  await mkdir(parent, { recursive: true });
  const folder = await mkdtemp(
    join(parent, `${id}-r${snapshot.game.revision}-`),
  );
  try {
    // Keep the original JSON fields for forward compatibility after validation.
    const original = raw as Record<string, unknown>;
    await writeFile(
      join(folder, "snapshot.json"),
      JSON.stringify(
        {
          ...original,
          source: base.origin,
          downloadedAt: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
    );
    await writeFile(join(folder, "dictionary.txt"), snapshot.dictionary.text);
  } catch (error) {
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
  log(
    `Saved ${snapshot.game.name} (revision ${snapshot.game.revision}, server ${snapshot.serverVersion})\n${folder}`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runDebug(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
