import { createReadStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import type { DatabaseSync } from "node:sqlite";
import type { DefinitionLanguage } from "../shared/definitions";
import {
  definitionIndexPath,
  definitionSpelling,
  definitionTileKey,
  openDefinitionIndex,
} from "./definitions";

const sources = [
  { stem: "en", word: "en", gloss: "en", format: "wiktextract" },
  { stem: "fr", word: "fr", gloss: "fr", format: "wiktextract" },
  { stem: "fr-en", word: "fr", gloss: "en", format: "wiktextract" },
  { stem: "en", word: "en", gloss: "en", format: "crowdsourceddefs" },
] as const satisfies readonly {
  stem: string;
  word: DefinitionLanguage;
  gloss: DefinitionLanguage;
  format: string;
}[];

type Source = (typeof sources)[number];
type Input = {
  source: Source;
  filename: string;
  path: string;
};

export interface DefinitionImportResult {
  filename: string;
  status: "imported" | "unchanged";
  entries: number;
  aliases: number;
}

type Link = { word: string };
type Reference = { alt_of?: Link[]; form_of?: Link[] };
type Sense = Reference & { glosses?: string[]; tags?: string[] };
type WiktextractEntry = Reference & {
  word: string;
  lang_code: string;
  pos: string;
  tags?: string[];
  senses?: Sense[];
  forms?: Array<{ form: string; tags?: string[]; source?: string }>;
};

const nonWords = new Set([
  "name",
  "proper-noun",
  "character",
  "letter",
  "symbol",
  "punct",
  "punctuation",
]);
const nonDefinitions = new Set([
  "no-gloss",
  "empty-gloss",
  "form-of",
  "alt-of",
  "misspelling",
]);
const inflectionTags = new Set([
  "alternative",
  "archaic",
  "comparative",
  "dialectal",
  "feminine",
  "first-person",
  "future",
  "imperative",
  "imperfect",
  "indicative",
  "infinitive",
  "masculine",
  "neuter",
  "obsolete",
  "participle",
  "past",
  "plural",
  "present",
  "reflexive",
  "second-person",
  "singular",
  "subjunctive",
  "superlative",
  "third-person",
  "variant",
]);
const nonInflectionTags = new Set([
  "romanization",
  "transliteration",
  "phonetic",
  "pinyin",
  "table-tags",
  "class",
]);

const sourceId = (source: Source) => `${source.stem}.${source.format}`;

async function fileFingerprint(path: string) {
  try {
    const info = await stat(path, { bigint: true });
    if (!info.isFile()) throw new Error(`Expected a file at ${path}.`);
    return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(
      ":",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function findInputs(directory: string) {
  const inputs: Input[] = [];
  for (const source of sources) {
    const names =
      source.format === "wiktextract"
        ? [`${source.stem}.jsonl.gz`, `${source.stem}.jsonl`]
        : [`${source.stem}.tsv`];
    let input: Input | undefined;
    for (const filename of names) {
      const path = join(directory, filename);
      const stamp = await fileFingerprint(path);
      if (!stamp) continue;
      if (input)
        throw new Error(
          `Found both ${names.join(" and ")}. Keep one file for this source.`,
        );
      input = { source, filename, path };
    }
    if (input) inputs.push(input);
  }
  return inputs;
}

async function readLines(
  input: Input,
  consume: (line: string, ordinal: number) => void,
) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let ordinal = 0;
  let remainder = "";
  const readLine = (line: string) => {
    ordinal++;
    if (!line.trim()) return;
    try {
      consume(line, ordinal);
    } catch (error) {
      throw new Error(
        `${input.filename}, line ${ordinal}: ${(error as Error).message}`,
        { cause: error },
      );
    }
  };
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try {
        const lines = (
          remainder + decoder.decode(chunk, { stream: true })
        ).split("\n");
        remainder = lines.pop()!;
        for (const line of lines) readLine(line);
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
    final(callback) {
      try {
        readLine(remainder + decoder.decode());
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
  });
  const stream = createReadStream(input.path);
  if (input.filename.endsWith(".gz"))
    await pipeline(stream, createGunzip(), destination);
  else await pipeline(stream, destination);
}

function readWiktextract(line: string, language: DefinitionLanguage) {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("Expected one JSON object per line.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a Wiktextract object.");

  const record = value as Partial<WiktextractEntry> & { redirect?: unknown };
  // Language-less redirects in raw dumps cannot be assigned to a definition source.
  if (!record.lang_code && typeof record.redirect === "string") return;
  if (typeof record.pos === "string" && nonWords.has(record.pos)) return;
  if (
    typeof record.lang_code !== "string" ||
    typeof record.word !== "string" ||
    !record.word.trim()
  )
    throw new Error("Wiktextract entries need a word and lang_code.");
  if (record.lang_code !== language) return;
  if (typeof record.pos !== "string" || !Array.isArray(record.senses))
    throw new Error("Wiktextract entries need a part of speech and senses.");
  return record as WiktextractEntry;
}

function writeEntries(db: DatabaseSync, source: Source) {
  const id = sourceId(source);
  let entries = 0;
  let aliases = 0;
  const putDefinition = db.prepare(`
    INSERT INTO definitions(source_id, spelling, spelling_key, tile_key, part_of_speech, glosses, source_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const putAlias = db.prepare(`
    INSERT OR IGNORE INTO definition_aliases
      (source_id, spelling, spelling_key, tile_key, part_of_speech, target_key, target_part_of_speech)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  function addDefinition(
    word: string,
    pos: string,
    glosses: string[],
    sourceUrl: string | null,
  ) {
    putDefinition.run(
      id,
      word,
      definitionSpelling(word),
      definitionTileKey(word),
      pos,
      JSON.stringify(glosses),
      sourceUrl,
    );
    entries++;
  }

  function addAlias(
    word: string,
    pos: string,
    target: string,
    targetPos: string,
  ) {
    const key = definitionSpelling(word);
    const targetKey = definitionSpelling(target);
    if (key && targetKey && (key !== targetKey || pos !== targetPos)) {
      aliases += Number(
        putAlias.run(
          id,
          word,
          key,
          definitionTileKey(word),
          pos,
          targetKey,
          targetPos,
        ).changes,
      );
    }
  }

  function addReferences(entry: WiktextractEntry, relation: Reference) {
    for (const target of relation.form_of ?? [])
      addAlias(entry.word, entry.pos, target.word, entry.pos);
    for (const target of relation.alt_of ?? [])
      addAlias(entry.word, entry.pos, target.word, "");
  }

  function wiktextract(line: string) {
    const entry = readWiktextract(line, source.word);
    if (!entry) return;
    addReferences(entry, entry);
    const entryIsReference =
      entry.tags?.some((tag) => nonDefinitions.has(tag)) ||
      !!entry.form_of?.length ||
      !!entry.alt_of?.length;
    const glosses = new Set<string>();
    for (const sense of entry.senses ?? []) {
      addReferences(entry, sense);
      if (
        entryIsReference ||
        sense.form_of?.length ||
        sense.alt_of?.length ||
        sense.tags?.some((tag) => nonDefinitions.has(tag))
      )
        continue;
      for (const gloss of sense.glosses ?? []) {
        if (typeof gloss !== "string")
          throw new Error("Definition text must be a string.");
        if (gloss.trim()) glosses.add(gloss.trim());
      }
    }
    if (glosses.size) {
      const section =
        source.gloss === "fr"
          ? "Français"
          : source.word === "fr"
            ? "French"
            : "English";
      addDefinition(
        entry.word,
        entry.pos,
        [...glosses],
        `https://${source.gloss}.wiktionary.org/wiki/${encodeURIComponent(entry.word)}#${encodeURIComponent(section)}`,
      );
    }
    for (const form of entry.forms ?? []) {
      if (
        !form.form ||
        !definitionTileKey(form.form) ||
        form.tags?.some((tag) => nonInflectionTags.has(tag))
      )
        continue;
      if (
        form.tags?.some((tag) => inflectionTags.has(tag)) ||
        form.source?.startsWith("Conjugaison:")
      ) {
        addAlias(form.form, entry.pos, entry.word, entry.pos);
      }
    }
  }

  function tsv(line: string, ordinal: number) {
    const [word, gloss, ...extra] = line.trimEnd().split("\t");
    if (
      ordinal === 1 &&
      word.toLowerCase() === "word" &&
      gloss?.toLowerCase() === "definition"
    )
      return;
    if (extra.length || !/^[a-z]{2,25}$/i.test(word) || !gloss?.trim())
      throw new Error("Expected a tile word, a tab, and a definition.");
    addDefinition(word, "", [gloss.trim()], null);
  }

  return {
    consume: source.format === "wiktextract" ? wiktextract : tsv,
    counts: () => ({ entries, aliases }),
  };
}

async function importSource(
  db: DatabaseSync,
  input: Input,
  onImport: (name: string) => void,
): Promise<DefinitionImportResult> {
  const { filename, source } = input;
  const id = sourceId(source);
  db.exec("BEGIN IMMEDIATE");
  try {
    const stamp = await fileFingerprint(input.path);
    if (!stamp) throw new Error(`${filename} disappeared before import.`);
    const fingerprint = `${filename}:${stamp}`;
    const previous = db
      .prepare(
        `
      SELECT fingerprint, entry_count AS entries, alias_count AS aliases FROM definition_sources WHERE id = ?
    `,
      )
      .get(id) as
      | { fingerprint: string; entries: number; aliases: number }
      | undefined;
    if (previous?.fingerprint === fingerprint) {
      db.exec("COMMIT");
      return {
        filename,
        status: "unchanged",
        entries: previous.entries,
        aliases: previous.aliases,
      };
    }
    onImport(filename);
    db.prepare("DELETE FROM definition_sources WHERE id = ?").run(id);
    db.prepare(
      `
      INSERT INTO definition_sources
      (id, word_language, definition_language, format, filename, fingerprint, entry_count, alias_count, license)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)
    `,
    ).run(
      id,
      source.word,
      source.gloss,
      source.format,
      filename,
      fingerprint,
      source.format === "wiktextract" ? "CC BY-SA 4.0" : null,
    );
    const writer = writeEntries(db, source);
    await readLines(input, writer.consume);
    const counts = writer.counts();
    if (!counts.entries)
      throw new Error(`No ${source.word} definitions in ${filename}.`);
    if ((await fileFingerprint(input.path)) !== stamp)
      throw new Error(
        `${filename} changed during import. Run the import again after it finishes copying.`,
      );
    db.prepare(
      "UPDATE definition_sources SET entry_count = ?, alias_count = ? WHERE id = ?",
    ).run(counts.entries, counts.aliases, id);
    db.exec("COMMIT");
    return { filename, status: "imported", ...counts };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function importDefinitions(
  dataDir: string,
  onImport: (name: string) => void = () => {},
) {
  const directory = join(dataDir, "definitions");
  await mkdir(directory, { recursive: true });
  const inputs = await findInputs(directory);
  const database = definitionIndexPath(dataDir);
  if (!inputs.length) return { database, sources: [] };
  const db = openDefinitionIndex(database);
  try {
    const imported: DefinitionImportResult[] = [];
    for (const input of inputs)
      imported.push(await importSource(db, input, onImport));
    return { database, sources: imported };
  } finally {
    db.close();
  }
}
