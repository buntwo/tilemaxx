import express from "express";
import compression from "compression";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { version } from "../version.json";
import { createStore } from "./store";
import {
  gameSchema,
  nameSchema,
  screenshotExampleSchema,
  templateSchema,
} from "./validation";
import { PRESETS } from "../shared/presets";
import { createDebugRouter } from "./debug";
import { apiAuthentication, type ApiCredentials } from "./api-auth";
import { createProgrammaticRouter } from "./programmatic";
import { ApiError } from "./api-error";

const definitionQuery = z.object({
  language: z.enum(["en", "fr"]),
  word: z
    .union([z.string(), z.array(z.string())])
    .transform((words) => [words].flat())
    .pipe(z.array(z.string().regex(/^[a-z]{2,25}$/i)).min(1).max(2)),
});

const apiNotFound: express.RequestHandler = (_req, res) => {
  res.status(404).json({ error: "Endpoint not found." });
};

const checkOrigin: express.RequestHandler = (req, res, next) => {
  if (!["GET", "HEAD"].includes(req.method)) {
    const origin = req.get("origin");
    if (origin && URL.parse(origin)?.host !== req.get("host")) {
      res.status(403).json({ error: "Cross-origin writes are not allowed." });
      return;
    }
    if (!req.is("application/json")) {
      res.status(415).json({ error: "Use application/json." });
      return;
    }
  }
  next();
};

function createDataRouter(store: ReturnType<typeof createStore>) {
  const router = express.Router();
  router.use(express.json({ limit: "16mb" }));
  router.get("/definitions", async (req, res) => {
    const { language, word } = definitionQuery.parse(req.query);
    try {
      res.json(await store.definitions(language, word));
    } catch (error) {
      console.error(error);
      res.status(503).json({ error: "Definitions are unavailable." });
    }
  });
  router.get("/state", (_req, res) => res.json(store.state()));
  router.get("/state/index", (_req, res) =>
    res.json({ ...store.index(), version }),
  );
  router.post("/screenshot-examples", (req, res) => {
    const example = screenshotExampleSchema.parse(req.body);
    const header = Buffer.from(example.croppedPng.slice(0, 32), "base64");
    if (
      header.length < 24 ||
      header.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      header.toString("ascii", 12, 16) !== "IHDR" ||
      !header.readUInt32BE(16) ||
      header.readUInt32BE(16) > 1500 ||
      !header.readUInt32BE(20) ||
      header.readUInt32BE(20) > 1500
    ) {
      res.status(400).json({ error: "Expected a cropped PNG board." });
      return;
    }
    res.status(201).json(store.saveScreenshotExample(example));
  });
  router.post("/profiles", (req, res) =>
    res.status(201).json(store.createProfile(nameSchema.parse(req.body.name))),
  );
  router.put("/profiles/:id", (req, res) => {
    const renamed = store.renameProfile(
      req.params.id,
      nameSchema.parse(req.body.name),
    );
    if (!renamed) {
      res.status(404).json({ error: "Profile not found." });
      return;
    }
    res.json(renamed);
  });
  router.delete("/profiles/:id", (req, res) => {
    const name = z.string().min(1).max(80).parse(req.body.name);
    const result = store.deleteProfile(req.params.id, name);
    if (result.status === "missing") {
      res.status(404).json({ error: "Profile not found." });
    } else if (result.status === "mismatch") {
      res.status(409).json({
        error:
          "The profile name no longer matches. Check the current name and try again.",
      });
    } else {
      res.json({ gameIds: result.gameIds });
    }
  });
  router.put("/profiles/:id/game-order", (req, res) => {
    const gameIds = z.array(z.string().min(1).max(100)).parse(req.body.gameIds);
    const status = store.reorderGames(req.params.id, gameIds);
    if (status === "missing") {
      res.status(404).json({ error: "Profile not found." });
    } else if (status === "changed") {
      res
        .status(409)
        .json({ error: "The active games changed. Try reordering again." });
    } else {
      res.json({ gameOrder: gameIds });
    }
  });
  router.post("/games", (req, res) => {
    // Accept the old ID only for clients syncing games drafted before this change.
    const token = z.string().regex(/^[a-f0-9]{32}$/).optional();
    const { creationId, creationToken } = z.object({
      creationId: token,
      creationToken: token,
    }).parse(req.body);
    if (creationId && creationToken) {
      res.status(400).json({ error: "Provide one creation identifier." });
      return;
    }
    const game = gameSchema.parse({
      ...req.body,
      id: randomUUID(),
      revision: 0,
      updatedAt: new Date().toISOString(),
    });
    if (
      !store.hasProfile(game.profileId) ||
      !store.dictionaries().some((d) => d.id === game.dictionaryId)
    ) {
      res.status(400).json({ error: "Unknown profile or dictionary." });
      return;
    }
    if (creationId && store.wasGameDeleted(creationId)) {
      res
        .status(410)
        .json({
          error:
            "This game was deleted on the server. Your local draft is still on this device.",
        });
      return;
    }
    const existing = creationId && store.getGame(creationId);
    if (existing) {
      res
        .status(409)
        .json({ error: "This game was already created.", game: existing });
      return;
    }
    const saved = creationToken
      ? store.createGameOnce(game, creationToken)
      : store.createGame(game, creationId);
    if (!saved) {
      res.status(410).json({ error: "This game was deleted on the server." });
      return;
    }
    res.status(201).json(saved);
  });
  router.get("/games/:id", (req, res) => {
    const game = store.getGame(req.params.id);
    if (!game) {
      res.status(404).json({ error: "Game not found." });
      return;
    }
    res.json(game);
  });
  router.post("/games/:id/archive-and-start", (req, res) => {
    const { revision, startedOn } = z
      .object({
        revision: z.number().int().nonnegative(),
        startedOn: z.iso.date(),
      })
      .parse(req.body);
    const result = store.archiveAndStartNewGame(
      req.params.id,
      revision,
      startedOn,
    );
    if (result.status === "missing") {
      res.status(404).json({ error: "Game not found." });
    } else if (result.status === "conflict") {
      res.status(409).json({
        error: result.game.archived
          ? "This game has already been archived."
          : "This game was updated on another device. Try again with the latest version.",
        game: result.game,
      });
    } else {
      res
        .status(201)
        .json({ archived: result.archived, created: result.created });
    }
  });
  router.put("/games/:id", (req, res) => {
    const game = gameSchema.parse(req.body),
      current = store.getGame(req.params.id);
    if (!current) {
      res.status(404).json({ error: "Game not found." });
      return;
    }
    if (
      game.id !== current.id ||
      game.profileId !== current.profileId ||
      game.solo !== current.solo ||
      !store.dictionaries().some((d) => d.id === game.dictionaryId)
    ) {
      res.status(400).json({ error: "Invalid game identity or dictionary." });
      return;
    }
    const saved = store.saveGame(game);
    if (!saved) {
      res.status(409).json({
        error: "This game was updated on another device.",
        game: store.getGame(game.id),
      });
      return;
    }
    res.json(saved);
  });
  router.delete("/games/:id", (req, res) => {
    store.deleteGame(req.params.id);
    res.json({ deleted: true });
  });
  router.post("/templates", (req, res) =>
    res.status(201).json(store.saveTemplate(templateSchema.parse(req.body))),
  );
  router.put("/templates/:id", (req, res) => {
    if (PRESETS.some((preset) => preset.id === req.params.id)) {
      res.status(403).json({
        error:
          "Built-in boards cannot be edited. Create a custom board instead.",
      });
      return;
    }
    const template = templateSchema.parse(req.body);
    if (template.id !== req.params.id || template.builtin) {
      res.status(400).json({ error: "Invalid custom board identity." });
      return;
    }
    const saved = store.updateTemplate(template);
    if (!saved) {
      res.status(404).json({ error: "Custom board not found." });
      return;
    }
    res.json(saved);
  });
  router.delete("/templates/:id", (req, res) => {
    if (!store.deleteTemplate(req.params.id)) {
      res.status(403).json({ error: "Built-in boards cannot be deleted." });
      return;
    }
    res.json({ deleted: true });
  });
  router.get("/dictionaries/:id", (req, res) => {
    const text = store.dictionaryText(req.params.id);
    if (text === undefined) {
      res.status(404).json({ error: "Dictionary not found." });
      return;
    }
    res.type("text/plain").send(text);
  });
  router.post("/dictionaries", (req, res) => {
    const { name, text } = z
      .object({ name: nameSchema, text: z.string().max(12_000_000).min(1) })
      .parse(req.body);
    res.status(201).json(store.importDictionary(name, text));
  });
  router.delete("/dictionaries/:id", (req, res) => {
    const result = store.deleteDictionary(req.params.id);
    switch (result.status) {
      case "missing":
        res.status(404).json({ error: "Word list not found." });
        break;
      case "builtin":
        res
          .status(403)
          .json({ error: "Built-in word lists are part of Tilemaxx." });
        break;
      case "in-use":
        res.status(409).json({
          error:
            result.count === 1
              ? `“${result.name}” uses this word list. Choose a different list in that game first.`
              : `${result.count} games use this word list. Choose a different list in those games first.`,
        });
        break;
      case "deleted":
        res.json({ deleted: true });
        break;
    }
  });
  return router;
}

export function createApp(
  store: ReturnType<typeof createStore>,
  { credentials, root = process.cwd() }: { credentials?: ApiCredentials; root?: string } = {},
) {
  const app = express();
  const auth = apiAuthentication(credentials);
  const data = createDataRouter(store);
  app.disable("x-powered-by");
  app.use(compression());
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/v1", auth.bearer, checkOrigin, createProgrammaticRouter(store, root), data, apiNotFound);
  app.use(auth.web);
  app.use("/api/debug", createDebugRouter(store));
  app.use("/api", checkOrigin, data, apiNotFound);
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof ApiError) {
        if (err.status === 429) res.setHeader("Retry-After", "3");
        res.status(err.status).json({ error: err.message });
        return;
      }
      if (err instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: err.issues.map((i) => i.message).join("; ") });
        return;
      }
      if (err instanceof SyntaxError) {
        res.status(400).json({ error: "Invalid JSON." });
        return;
      }
      if (
        err &&
        typeof err === "object" &&
        "status" in err &&
        err.status === 413
      ) {
        res.status(413).json({ error: "The file is too large (16 MB limit)." });
        return;
      }
      console.error(err);
      res.status(500).json({
        error:
          "Could not save this change. Your local draft is still available.",
      });
    },
  );
  return app;
}
