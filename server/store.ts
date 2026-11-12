import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import {
  type AppState,
  type Dictionary,
  type Game,
  type BoardTemplate,
  emptyBoard,
} from "../shared/model";
import { PRESETS } from "../shared/presets";
import { parseWords } from "../shared/lexicon";

export function createStore(directory: string, root: string) {
  mkdirSync(join(directory, "dictionaries"), { recursive: true });
  const db = new DatabaseSync(join(directory, "tilewise.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY,revision INTEGER NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dictionaries (id TEXT PRIMARY KEY,data TEXT NOT NULL,file TEXT NOT NULL);`);
  function registerDictionary(
    id: string,
    name: string,
    file: string,
    description: string,
    builtin = false,
  ) {
    if (db.prepare("SELECT id FROM dictionaries WHERE id=?").get(id)) {
      db.prepare("UPDATE dictionaries SET file=? WHERE id=?").run(file, id);
      return;
    }
    const count = parseWords(readFileSync(file, "utf8")).length;
    const metadata: Dictionary = { id, name, count, description, builtin };
    db.prepare("INSERT INTO dictionaries VALUES (?,?,?)").run(
      id,
      JSON.stringify(metadata),
      file,
    );
  }
  for (const [id, name, description] of [
    [
      "enable",
      "ENABLE",
      "Classic open word-game list. Not the current official WWF dictionary.",
    ],
    [
      "wordnik",
      "Wordnik",
      "Open English word-game list (2021). Not a tournament lexicon.",
    ],
  ]) {
    const path = join(root, "public", "dictionaries", `${id}.txt`);
    if (existsSync(path)) registerDictionary(id, name, path, description, true);
  }
  for (const file of readdirSync(join(directory, "dictionaries")).filter((f) =>
    f.endsWith(".txt"),
  )) {
    const path = join(directory, "dictionaries", file);
    const existing = db
      .prepare("SELECT id,file FROM dictionaries")
      .all()
      .find((row) => basename(row.file as string) === file);
    if (existing) {
      db.prepare("UPDATE dictionaries SET file=? WHERE id=?").run(
        path,
        existing.id as string,
      );
      continue;
    }
    const id = basename(file, ".txt")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-");
    registerDictionary(id, basename(file, ".txt"), path, "Imported word list");
  }
  const games = () =>
    db
      .prepare("SELECT data FROM games")
      .all()
      .map((row) => JSON.parse(row.data as string) as Game);
  const dictionaries = () =>
    db
      .prepare("SELECT data FROM dictionaries")
      .all()
      .map((row) => JSON.parse(row.data as string) as Dictionary);
  const getGame = (id: string) => {
    const row = db.prepare("SELECT data FROM games WHERE id=?").get(id);
    return row ? (JSON.parse(row.data as string) as Game) : undefined;
  };
  const profiles = () =>
    db.prepare("SELECT id,name FROM profiles").all() as {
      id: string;
      name: string;
    }[];
  function createGame(
    input: Omit<Game, "id" | "revision" | "updatedAt">,
  ): Game {
    const game = {
      ...input,
      id: randomUUID(),
      revision: 0,
      updatedAt: new Date().toISOString(),
    };
    db.prepare("INSERT INTO games VALUES (?,?,?)").run(
      game.id,
      0,
      JSON.stringify(game),
    );
    return game;
  }
  if (!profiles().length) {
    const id = randomUUID();
    db.prepare("INSERT INTO profiles VALUES (?,?)").run(id, "My profile");
    createGame({
      profileId: id,
      name: "First game",
      template: PRESETS[0],
      dictionaryId:
        dictionaries().find((d) => d.id === "csw24")?.id || "wordnik",
      board: emptyBoard(15),
      rack: "",
      past: [],
      future: [],
      archived: false,
    });
  }
  return {
    db,
    getGame,
    createGame,
    dictionaries,
    state(): AppState {
      return {
        profiles: profiles(),
        games: games(),
        templates: [
          ...PRESETS,
          ...db
            .prepare("SELECT data FROM templates")
            .all()
            .map((row) => JSON.parse(row.data as string)),
        ],
        dictionaries: dictionaries(),
      };
    },
    createProfile(name: string) {
      const profile = { id: randomUUID(), name };
      db.prepare("INSERT INTO profiles VALUES (?,?)").run(
        profile.id,
        profile.name,
      );
      return profile;
    },
    renameProfile(id: string, name: string) {
      const result = db
        .prepare("UPDATE profiles SET name=? WHERE id=?")
        .run(name, id);
      return result.changes ? { id, name } : undefined;
    },
    deleteGame(id: string) {
      db.prepare("DELETE FROM games WHERE id=?").run(id);
    },
    saveGame(game: Game): Game | undefined {
      const saved = {
        ...game,
        revision: game.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      const result = db
        .prepare("UPDATE games SET revision=?,data=? WHERE id=? AND revision=?")
        .run(saved.revision, JSON.stringify(saved), game.id, game.revision);
      return result.changes ? saved : undefined;
    },
    saveTemplate(template: BoardTemplate) {
      const saved = { ...template, id: randomUUID(), builtin: false };
      db.prepare("INSERT INTO templates VALUES (?,?)").run(
        saved.id,
        JSON.stringify(saved),
      );
      return saved;
    },
    updateTemplate(template: BoardTemplate) {
      if (PRESETS.some((preset) => preset.id === template.id)) return undefined;
      const saved = { ...template, builtin: false };
      const result = db
        .prepare("UPDATE templates SET data=? WHERE id=?")
        .run(JSON.stringify(saved), saved.id);
      return result.changes ? saved : undefined;
    },
    deleteTemplate(id: string) {
      if (PRESETS.some((preset) => preset.id === id)) return false;
      db.prepare("DELETE FROM templates WHERE id=?").run(id);
      return true;
    },
    dictionaryText(id: string) {
      const row = db
        .prepare("SELECT file FROM dictionaries WHERE id=?")
        .get(id);
      return row ? readFileSync(row.file as string, "utf8") : undefined;
    },
    importDictionary(name: string, text: string) {
      const words = parseWords(text);
      if (words.length < 1)
        throw new Error(
          "No words found. Use a text file with one English word per line.",
        );
      const id = randomUUID(),
        file = join(directory, "dictionaries", `${id}.txt`);
      writeFileSync(file, words.join("\n") + "\n");
      registerDictionary(id, name, file, "Imported word list");
      return dictionaries().find((d) => d.id === id)!;
    },
  };
}
