import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createApp } from "../server/app";
import { createStore } from "../server/store";
import { importDefinitions } from "../server/definition-import";
import {
  definitionLookupSql,
  lookupDefinitions,
  openDefinitionIndex,
} from "../server/definitions";

function jsonl(...entries: unknown[]) {
  return entries.map((entry) => JSON.stringify(entry)).join("\r\n");
}

function entry(word: string, gloss: string, language = "fr", pos = "noun") {
  return { word, lang_code: language, pos, senses: [{ glosses: [gloss] }] };
}

test("the definitions API reads optional local imports by game language", async () => {
  const data = await mkdtemp(join(tmpdir(), "tilemaxx-definition-api-"));
  const store = createStore(data, process.cwd());
  const server = createApp(store).listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/definitions`;
    const get = (query: string) => fetch(base + "?" + query);

    const missing = await get("language=en&word=cat");
    assert.equal(missing.headers.get("cache-control"), "no-store");
    assert.deepEqual(await missing.json(), {
      available: false,
      entries: [],
      wordFrequencyZipf: [4.78],
    });
    assert.equal((await get("language=it&word=CAT")).status, 400);
    assert.equal(
      (await get("language=en&word=CAT&word=AT&word=TO")).status,
      400,
    );
    assert.equal((await get("language=en&word=CAT!")).status, 400);

    const definitions = join(data, "definitions");
    await mkdir(definitions);
    await writeFile(
      join(definitions, "en.tsv"),
      "Word\tDefinition\nCAT\tA domestic feline.\n",
    );
    await importDefinitions(data);
    assert.deepEqual(await (await get("language=fr&word=COTE")).json(), {
      available: false,
      entries: [],
    });
    await writeFile(
      join(definitions, "fr-en.jsonl"),
      jsonl(
        entry("côte", "rib or coast"),
        entry("côté", "side"),
        entry("lune", "moon"),
      ),
    );
    await importDefinitions(data);
    const english = await (await get("language=en&word=CAT&word=ZYZZYVA")).json();
    assert.equal(english.available, true);
    assert.deepEqual(english.entries[0][0].glosses, ["A domestic feline."]);
    assert.deepEqual(english.entries[1], []);
    assert.deepEqual(english.wordFrequencyZipf, [4.78, null]);
    const french = await (await get("language=fr&word=COTE&word=LUNE")).json();
    assert.equal(french.available, true);
    assert.equal(Object.hasOwn(french, "wordFrequencyZipf"), false);
    assert.deepEqual(
      french.entries.map((entries: { spelling: string }[]) =>
        entries.map(({ spelling }) => spelling),
      ),
      [["côte", "côté"], ["lune"]],
    );
    assert.match(french.entries[0][0].sourceUrl, /en\.wiktionary\.org/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.db.close();
    await rm(data, { recursive: true, force: true });
  }
});

test("definition exports for each language pair share one index, preserving French spellings and base words", async (t) => {
  const data = await mkdtemp(join(tmpdir(), "tilemaxx-definitions-"));
  t.after(() => rm(data, { recursive: true, force: true }));
  const directory = join(data, "definitions");
  await mkdir(directory);
  await Promise.all([
    writeFile(
      join(directory, "fr.jsonl.gz"),
      gzipSync(
        jsonl(
          entry("cote", "Classement ou évaluation."),
          entry("côte", "Os de la cage thoracique."),
          entry("côté", "Partie latérale."),
          entry("cœur", "Organe qui fait circuler le sang."),
          {
            ...entry("manger", "Prendre de la nourriture.", "fr", "verb"),
            forms: [{ form: "mangés", tags: ["plural", "past", "participle"] }],
          },
          {
            word: "mangèrent",
            lang_code: "fr",
            pos: "verb",
            senses: [
              { form_of: [{ word: "manger" }], glosses: ["Forme de manger."] },
            ],
          },
          {
            word: "coeur",
            lang_code: "fr",
            pos: "typographic variant",
            senses: [{ alt_of: [{ word: "cœur" }] }],
          },
          entry("tree", "A woody plant.", "en"),
        ),
      ),
    ),
    writeFile(
      join(directory, "fr-en.jsonl.gz"),
      gzipSync(
        jsonl(
          entry("côte", "rib or coast"),
          entry(" ", "space", "fr", "punct"),
        ),
      ),
    ),
    writeFile(
      join(directory, "en.tsv"),
      "\uFEFFWord\tDefinition\r\nQIN\tA Chinese stringed instrument.\r\n",
    ),
    writeFile(
      join(directory, "en.jsonl"),
      jsonl(entry("cat", "A domestic feline.", "en")),
    ),
    writeFile(join(directory, "fr-en.jsonl.gz.part"), "still copying"),
  ]);

  const first = await importDefinitions(data);
  assert.equal(first.database, join(directory, "definitions.sqlite"));
  assert.deepEqual(
    first.sources.map(({ filename, status }) => [filename, status]),
    [
      ["en.jsonl", "imported"],
      ["fr.jsonl.gz", "imported"],
      ["fr-en.jsonl.gz", "imported"],
      ["en.tsv", "imported"],
    ],
  );
  const db = openDefinitionIndex(first.database);
  t.after(() => db.close());

  const french = lookupDefinitions(db, "COTE", "fr", "fr");
  assert.deepEqual(
    new Set(french.map(({ spelling }) => spelling)),
    new Set(["cote", "côte", "côté"]),
  );
  assert.deepEqual(
    lookupDefinitions(db, "COTE", "fr", "en").map(({ glosses }) => glosses),
    [["rib or coast"]],
  );
  assert.deepEqual(lookupDefinitions(db, "MANGERENT", "fr", "fr"), [
    {
      source: "fr.wiktextract",
      spelling: "mangèrent",
      headword: "manger",
      partOfSpeech: "verb",
      glosses: ["Prendre de la nourriture."],
      sourceUrl: "https://fr.wiktionary.org/wiki/manger#Fran%C3%A7ais",
      license: "CC BY-SA 4.0",
    },
  ]);
  assert.equal(
    lookupDefinitions(db, "MANGES", "fr", "fr")[0].headword,
    "manger",
  );
  assert.ok(
    lookupDefinitions(db, "COEUR", "fr", "fr").every(
      ({ headword }) => headword === "cœur",
    ),
  );
  assert.deepEqual(
    lookupDefinitions(db, "QIN", "en", "en").map(({ source, license }) => [
      source,
      license,
    ]),
    [["en.crowdsourceddefs", null]],
  );
  assert.equal(
    lookupDefinitions(db, "CAT", "en", "en")[0].source,
    "en.wiktextract",
  );
  assert.deepEqual(lookupDefinitions(db, "TREE", "fr", "fr"), []);

  const rerun = await importDefinitions(data);
  assert.ok(rerun.sources.every(({ status }) => status === "unchanged"));
});

test("a failed refresh keeps the previous definitions and a valid replacement removes stale entries", async (t) => {
  const data = await mkdtemp(join(tmpdir(), "tilemaxx-definitions-refresh-"));
  const directory = join(data, "definitions");
  await mkdir(directory);
  const path = join(directory, "fr.jsonl.gz");
  await writeFile(path, gzipSync(jsonl(entry("chat", "Félin domestique."))));
  const { database } = await importDefinitions(data);
  const db = openDefinitionIndex(database);
  t.after(async () => {
    db.close();
    await rm(data, { recursive: true, force: true });
  });

  await writeFile(
    path,
    gzipSync(jsonl(entry("chien", "Canidé domestique.")) + "\n{"),
  );
  await assert.rejects(importDefinitions(data), /fr.jsonl.gz, line 2/);
  assert.equal(lookupDefinitions(db, "CHAT", "fr", "fr").length, 1);
  assert.deepEqual(lookupDefinitions(db, "CHIEN", "fr", "fr"), []);
  const valid = gzipSync(jsonl(entry("chien", "Canidé domestique.")));
  await writeFile(path, valid.subarray(0, valid.length - 8));
  await assert.rejects(importDefinitions(data), /unexpected end/i);
  assert.equal(lookupDefinitions(db, "CHAT", "fr", "fr").length, 1);

  await writeFile(path, valid);
  assert.equal((await importDefinitions(data)).sources[0].status, "imported");
  assert.equal(lookupDefinitions(db, "CHIEN", "fr", "fr").length, 1);
  assert.deepEqual(lookupDefinitions(db, "CHAT", "fr", "fr"), []);
});

test("lookup seeks the tile and spelling indexes without scanning definitions or aliases", (t) => {
  const db = openDefinitionIndex(":memory:");
  t.after(() => db.close());
  const plan = db
    .prepare(`EXPLAIN QUERY PLAN ${definitionLookupSql}`)
    .all("fr", "en", "cote", "cote")
    .map((row) => String(row.detail))
    .join("\n");

  for (const index of [
    "definitions_tiles",
    "definition_alias_tiles",
    "definition_alias_spellings",
    "definitions_spellings",
  ]) {
    assert.match(
      plan,
      new RegExp(`SEARCH .* USING (?:COVERING )?INDEX ${index} `),
    );
  }
  assert.doesNotMatch(plan, /SCAN (?:d|a)\b/);
});
