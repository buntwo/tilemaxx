import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  DefinitionLanguage,
  DefinitionLookup,
  WordDefinition,
} from "../shared/definitions";

export function definitionIndexPath(dataDir: string) {
  return join(dataDir, "definitions", "definitions.sqlite");
}

export function definitionSpelling(word: string) {
  return word.trim().normalize("NFC").toLowerCase().replaceAll("’", "'");
}

export function definitionTileKey(word: string) {
  const key = definitionSpelling(word)
    .replaceAll("œ", "oe")
    .replaceAll("æ", "ae")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return /^[a-z]{2,25}$/.test(key) ? key : null;
}

export function openDefinitionIndex(path: string) {
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS definition_sources (
        id TEXT PRIMARY KEY,
        word_language TEXT NOT NULL,
        definition_language TEXT NOT NULL,
        format TEXT NOT NULL,
        filename TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        entry_count INTEGER NOT NULL,
        alias_count INTEGER NOT NULL,
        license TEXT
      );
      CREATE TABLE IF NOT EXISTS definitions (
        id INTEGER PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES definition_sources(id) ON DELETE CASCADE,
        spelling TEXT NOT NULL,
        spelling_key TEXT NOT NULL,
        tile_key TEXT,
        part_of_speech TEXT NOT NULL,
        glosses TEXT NOT NULL,
        source_url TEXT
      );
      CREATE INDEX IF NOT EXISTS definitions_tiles ON definitions(source_id, tile_key);
      CREATE INDEX IF NOT EXISTS definitions_spellings ON definitions(source_id, spelling_key);
      CREATE TABLE IF NOT EXISTS definition_aliases (
        source_id TEXT NOT NULL REFERENCES definition_sources(id) ON DELETE CASCADE,
        spelling TEXT NOT NULL,
        spelling_key TEXT NOT NULL,
        tile_key TEXT,
        part_of_speech TEXT NOT NULL,
        target_key TEXT NOT NULL,
        target_part_of_speech TEXT NOT NULL,
        PRIMARY KEY (source_id, spelling, part_of_speech, target_key, target_part_of_speech)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS definition_alias_tiles ON definition_aliases(source_id, tile_key);
      CREATE INDEX IF NOT EXISTS definition_alias_spellings ON definition_aliases(source_id, spelling_key);
    `);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

// Keep the small source and match sets on the outside of the indexed joins.
// SQLite otherwise may scan the large dictionary tables before applying the keys.
export const definitionLookupSql = `
    WITH RECURSIVE sources AS (
      SELECT id, license FROM definition_sources
      WHERE word_language = ? AND definition_language = ?
    ),
    matches(source_id, spelling, spelling_key, part_of_speech) AS (
      SELECT d.source_id, d.spelling, d.spelling_key, d.part_of_speech
      FROM sources s CROSS JOIN definitions d ON d.source_id = s.id
      WHERE d.tile_key = ?
      UNION
      SELECT a.source_id, a.spelling, a.target_key, a.target_part_of_speech
      FROM sources s CROSS JOIN definition_aliases a ON a.source_id = s.id
      WHERE a.tile_key = ?
      UNION
      SELECT m.source_id, m.spelling, a.target_key, a.target_part_of_speech
      FROM matches m CROSS JOIN definition_aliases a
        ON a.source_id = m.source_id AND a.spelling_key = m.spelling_key
        AND (m.part_of_speech = '' OR a.part_of_speech = '' OR m.part_of_speech = a.part_of_speech)
    )
    SELECT DISTINCT d.source_id AS source, m.spelling, d.spelling AS headword,
      d.part_of_speech AS partOfSpeech, d.glosses, d.source_url AS sourceUrl, s.license
    FROM matches m
    CROSS JOIN definitions d ON d.source_id = m.source_id AND d.spelling_key = m.spelling_key
      AND (m.part_of_speech = '' OR m.part_of_speech = d.part_of_speech)
    JOIN sources s ON s.id = d.source_id
    ORDER BY m.spelling, d.spelling, d.part_of_speech, d.source_id
  `;

export function lookupDefinitions(
  db: DatabaseSync,
  word: string,
  wordLanguage: DefinitionLanguage,
  definitionLanguage: DefinitionLanguage,
): WordDefinition[] {
  const key = definitionTileKey(word);
  if (!key) return [];
  const rows = db
    .prepare(definitionLookupSql)
    .all(wordLanguage, definitionLanguage, key, key);
  return (
    rows as unknown as Array<
      Omit<WordDefinition, "glosses"> & { glosses: string }
    >
  ).map((row) => ({ ...row, glosses: JSON.parse(row.glosses) as string[] }));
}

export function lookupEnglishGlosses(
  path: string,
  language: DefinitionLanguage,
  words: string[],
): DefinitionLookup {
  if (!existsSync(path)) return { available: false, entries: [] };
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const source = db
      .prepare(
        `
      SELECT 1 FROM definition_sources
      WHERE word_language = ? AND definition_language = 'en' LIMIT 1
    `,
      )
      .get(language);
    return source
      ? {
          available: true,
          entries: words.map((word) =>
            lookupDefinitions(db, word, language, "en"),
          ),
        }
      : { available: false, entries: [] };
  } finally {
    db.close();
  }
}
