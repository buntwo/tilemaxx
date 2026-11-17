import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import {
  type AppState,
  type Dictionary,
  type Game,
  type Profile,
  type BoardTemplate,
  archiveGame,
  emptyBoard,
  localDate,
  newGameFromSettings,
} from "../shared/model";
import {
  summarizeGame,
  type GameIndex,
  type GameSummary,
} from "../shared/game-index";
import { backfillGameResult } from "../shared/game-scoring";
import { PRESETS } from "../shared/presets";
import { parseWords } from "../shared/lexicon";
import { defaultDictionary } from "../shared/dictionaries";
import { type z } from "zod";
import { type screenshotExampleSchema } from "./validation";

const removingSuffix = ".tilemaxx-removing";

function cleanRemovedDictionary(path: string) {
  try {
    rmSync(path, { force: true });
  } catch (error) {
    console.warn("Could not clean up a removed word list.", error);
  }
}

export function createStore(directory: string, root: string) {
  const dictionaryDirectory = join(directory, "dictionaries");
  mkdirSync(dictionaryDirectory, { recursive: true });
  const db = new DatabaseSync(join(directory, "tilewise.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY,revision INTEGER NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS deleted_games (id TEXT PRIMARY KEY);
    CREATE TRIGGER IF NOT EXISTS remember_deleted_game AFTER DELETE ON games
      BEGIN INSERT OR IGNORE INTO deleted_games VALUES (OLD.id); END;
    CREATE TABLE IF NOT EXISTS game_summaries (id TEXT PRIMARY KEY,revision INTEGER NOT NULL,data TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS delete_game_summary AFTER DELETE ON games
      BEGIN DELETE FROM game_summaries WHERE id=OLD.id; END;
    CREATE TABLE IF NOT EXISTS profile_game_order (profile_id TEXT PRIMARY KEY,game_ids TEXT NOT NULL);
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
  const dictionaryFiles = db.prepare("SELECT id,file FROM dictionaries");
  // A rename stages removal until SQLite commits. On restart, a row that
  // still exists means the interrupted removal must be rolled back.
  const registeredFiles = new Set(
    dictionaryFiles.all().map((row) => basename(row.file as string)),
  );
  for (const file of readdirSync(dictionaryDirectory)) {
    if (!file.endsWith(`.txt${removingSuffix}`)) continue;
    const original = file.slice(0, -removingSuffix.length);
    const path = join(dictionaryDirectory, original);
    const staged = join(dictionaryDirectory, file);
    if (registeredFiles.has(original) && !existsSync(path))
      renameSync(staged, path);
    else cleanRemovedDictionary(staged);
  }
  for (const file of readdirSync(dictionaryDirectory).filter((f) =>
    f.endsWith(".txt"),
  )) {
    const path = join(dictionaryDirectory, file);
    const existing = dictionaryFiles
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
  const writeSummary = db.prepare(`
    INSERT INTO game_summaries VALUES (?,?,?)
    ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data
  `);
  function saveSummary(game: Game) {
    writeSummary.run(
      game.id,
      game.revision,
      JSON.stringify(summarizeGame(game)),
    );
  }
  const staleSummary = `summaries.id IS NULL OR json_type(summaries.data, '$.fullMoveHistory') IS NULL
      OR json_type(summaries.data, '$.score') IS NULL`;
  const staleSummaryJoin = `
    FROM games LEFT JOIN game_summaries AS summaries
      ON summaries.id=games.id AND summaries.revision=games.revision
    WHERE ${staleSummary}
  `;
  const hasStaleSummary = db.prepare(`SELECT 1 ${staleSummaryJoin} LIMIT 1`);
  const missingSummaries = db.prepare(`SELECT games.data ${staleSummaryJoin}`);
  const summaries = db.prepare(`
    SELECT summaries.data FROM games
    JOIN game_summaries AS summaries
      ON summaries.id=games.id AND summaries.revision=games.revision
    ORDER BY games.rowid
  `);
  const debugSummaries = db.prepare(`
    SELECT CASE WHEN ${staleSummary} THEN games.data END AS game,
      summaries.data AS summary
    FROM games LEFT JOIN game_summaries AS summaries
      ON summaries.id=games.id AND summaries.revision=games.revision
    ORDER BY games.rowid
  `);
  function transaction<T>(run: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  function gameIndex() {
    // Older databases and saves made by an older server have no current summary.
    if (hasStaleSummary.get()) {
      transaction(() => {
        for (const row of missingSummaries.all())
          saveSummary(JSON.parse(row.data as string) as Game);
      });
    }
    return summaries
      .all()
      .map((row) => JSON.parse(row.data as string) as GameSummary);
  }
  const dictionaries = () =>
    db
      .prepare("SELECT data FROM dictionaries")
      .all()
      .map((row) => JSON.parse(row.data as string) as Dictionary);
  const getGame = (id: string) => {
    const row = db.prepare("SELECT data FROM games WHERE id=?").get(id);
    return row ? (JSON.parse(row.data as string) as Game) : undefined;
  };
  const profiles = (): Profile[] =>
    db
      .prepare(
        `SELECT id,name,game_ids FROM profiles
      LEFT JOIN profile_game_order ON profile_id=id`,
      )
      .all()
      .map((row) => ({
        id: row.id as string,
        name: row.name as string,
        ...(typeof row.game_ids === "string" && {
          gameOrder: JSON.parse(row.game_ids) as string[],
        }),
      }));
  const workspace = () => ({
    profiles: profiles(),
    templates: [
      ...PRESETS,
      ...db
        .prepare("SELECT data FROM templates")
        .all()
        .map((row) => JSON.parse(row.data as string) as BoardTemplate),
    ],
    dictionaries: dictionaries(),
  });
  function insertGame(
    input: Omit<Game, "id" | "revision" | "updatedAt">,
    id: string = randomUUID(),
  ): Game {
    const game = {
      ...input,
      startedOn: input.startedOn ?? localDate(),
      trackScores: input.trackScores ?? true,
      id,
      revision: 0,
      updatedAt: new Date().toISOString(),
    };
    db.prepare("INSERT INTO games VALUES (?,?,?)").run(
      game.id,
      game.revision,
      JSON.stringify(game),
    );
    saveSummary(game);
    return game;
  }
  function createGame(input: Parameters<typeof insertGame>[0], id?: string) {
    return transaction(() => insertGame(input, id));
  }
  function writeGame(
    game: Game,
    updatedAt = new Date().toISOString(),
  ): Game | undefined {
    const saved = {
      ...game,
      revision: game.revision + 1,
      updatedAt,
    };
    const result = db
      .prepare("UPDATE games SET revision=?,data=? WHERE id=? AND revision=?")
      .run(saved.revision, JSON.stringify(saved), game.id, game.revision);
    if (!result.changes) return undefined;
    saveSummary(saved);
    return saved;
  }
  if (db.prepare("PRAGMA user_version").get()?.user_version === 0) {
    if (!profiles().length) {
      const id = randomUUID();
      db.prepare("INSERT INTO profiles VALUES (?,?)").run(id, "My profile");
      createGame({
        profileId: id,
        name: "First game",
        template: PRESETS[0],
        dictionaryId: defaultDictionary(dictionaries())?.id || "wordnik",
        board: emptyBoard(15),
        rack: "",
        past: [],
        future: [],
        archived: false,
      });
    }
    db.exec("PRAGMA user_version=1");
  }
  if (db.prepare("PRAGMA user_version").get()?.user_version === 1) {
    transaction(() => {
      if (db.prepare("PRAGMA user_version").get()?.user_version !== 1) return;
      for (const game of games()) {
        const updated = backfillGameResult(game);
        if (updated !== game) writeGame(updated, game.updatedAt);
      }
      db.exec("PRAGMA user_version=2");
    });
  }
  return {
    db,
    saveScreenshotExample({
      croppedPng,
      ...example
    }: z.infer<typeof screenshotExampleSchema>) {
      const id = randomUUID();
      const folder = join(directory, "screenshot-examples", id);
      mkdirSync(folder, { recursive: true });
      writeFileSync(
        join(folder, "board.png"),
        Buffer.from(croppedPng, "base64"),
      );
      writeFileSync(
        join(folder, "labels.json"),
        JSON.stringify({ ...example, id, version: 1 }, null, 2),
      );
      return { id };
    },
    getGame,
    createGame,
    dictionaries,
    hasProfile(id: string) {
      return !!db.prepare("SELECT 1 FROM profiles WHERE id=?").get(id);
    },
    state(): AppState {
      return { ...workspace(), games: games() };
    },
    index(): GameIndex {
      return { ...workspace(), games: gameIndex() };
    },
    debugIndex(): GameIndex {
      // Debug reads must not repair or write the summary cache, even on old saves.
      return {
        ...workspace(),
        games: debugSummaries
          .all()
          .map((row) =>
            row.game
              ? summarizeGame(JSON.parse(row.game as string) as Game)
              : (JSON.parse(row.summary as string) as GameSummary),
          ),
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
      return result.changes
        ? profiles().find((profile) => profile.id === id)
        : undefined;
    },
    reorderGames(profileId: string, gameIds: string[]) {
      const profile = profiles().find((item) => item.id === profileId);
      if (!profile) return "missing";
      const active = new Set(
        gameIndex()
          .filter((g) => g.profileId === profileId && !g.archived)
          .map((g) => g.id),
      );
      if (
        gameIds.length !== active.size ||
        !gameIds.every((id) => active.delete(id))
      )
        return "changed";
      db.prepare(
        `INSERT INTO profile_game_order VALUES (?,?)
        ON CONFLICT(profile_id) DO UPDATE SET game_ids=excluded.game_ids`,
      ).run(profileId, JSON.stringify(gameIds));
      return "saved";
    },
    deleteProfile(id: string, name: string) {
      const profile = db
        .prepare("SELECT name FROM profiles WHERE id=?")
        .get(id);
      if (!profile) return { status: "missing" } as const;
      if (profile.name !== name) return { status: "mismatch" } as const;
      return transaction(() => {
        const deleted = db
          .prepare(
            "DELETE FROM games WHERE json_extract(data, '$.profileId')=? RETURNING id",
          )
          .all(id);
        db.prepare("DELETE FROM profiles WHERE id=?").run(id);
        db.prepare("DELETE FROM profile_game_order WHERE profile_id=?").run(id);
        return {
          status: "deleted",
          gameIds: deleted.map((game) => game.id as string),
        } as const;
      });
    },
    wasGameDeleted(id: string) {
      return !!db.prepare("SELECT id FROM deleted_games WHERE id=?").get(id);
    },
    deleteGame(id: string) {
      transaction(() => {
        // Also cover a DELETE that arrives before an in-flight creation.
        db.prepare("INSERT OR IGNORE INTO deleted_games VALUES (?)").run(id);
        db.prepare("DELETE FROM games WHERE id=?").run(id);
      });
    },
    saveGame(game: Game): Game | undefined {
      return transaction(() => writeGame(game));
    },
    archiveAndStartNewGame(id: string, revision: number, startedOn: string) {
      return transaction(() => {
        const game = getGame(id);
        if (!game) return { status: "missing" } as const;
        if (game.archived || game.revision !== revision)
          return { status: "conflict", game } as const;
        const archived = writeGame(archiveGame(game));
        if (!archived) return { status: "conflict", game } as const;
        const created = insertGame(newGameFromSettings(game, startedOn));
        return { status: "created", archived, created } as const;
      });
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
        file = join(dictionaryDirectory, `${id}.txt`);
      writeFileSync(file, words.join("\n") + "\n");
      registerDictionary(id, name, file, "Imported word list");
      return dictionaries().find((d) => d.id === id)!;
    },
    deleteDictionary(id: string) {
      let staged: { from: string; to: string } | undefined;
      let result;
      try {
        result = transaction(() => {
          const row = db
            .prepare("SELECT data,file FROM dictionaries WHERE id=?")
            .get(id);
          if (!row) return { status: "missing" } as const;
          if ((JSON.parse(row.data as string) as Dictionary).builtin)
            return { status: "builtin" } as const;

          const usage = db
            .prepare(
              `SELECT count(*) AS count, min(json_extract(data, '$.name')) AS name
               FROM games WHERE json_extract(data, '$.dictionaryId')=?`,
            )
            .get(id)!;
          const count = usage.count as number;
          if (count)
            return {
              status: "in-use",
              count,
              name: usage.name as string,
            } as const;

          const path = join(dictionaryDirectory, basename(row.file as string));
          if (existsSync(path)) {
            const next = path + removingSuffix;
            renameSync(path, next);
            staged = { from: path, to: next };
          }
          db.prepare("DELETE FROM dictionaries WHERE id=?").run(id);
          return { status: "deleted" } as const;
        });
      } catch (error) {
        if (staged) renameSync(staged.to, staged.from);
        throw error;
      }
      if (staged) cleanRemovedDictionary(staged.to);
      return result;
    },
  };
}
