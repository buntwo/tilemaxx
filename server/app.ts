import express from "express";
import compression from "compression";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createStore } from "./store";
import {
  gameSchema,
  nameSchema,
  screenshotExampleSchema,
  templateSchema,
} from "./validation";
import { PRESETS } from "../shared/presets";

export function createApp(store: ReturnType<typeof createStore>) {
  const app = express();
  app.disable("x-powered-by");
  app.use(compression());
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!["GET", "HEAD"].includes(req.method)) {
      const origin = req.get("origin");
      if (origin && new URL(origin).host !== req.get("host")) {
        res.status(403).json({ error: "Cross-origin writes are not allowed." });
        return;
      }
      if (!req.is("application/json")) {
        res.status(415).json({ error: "Use application/json." });
        return;
      }
    }
    next();
  });
  app.use(express.json({ limit: "16mb" }));
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/state", (_req, res) => res.json(store.state()));
  app.post("/api/screenshot-examples", (req, res) => {
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
  app.post("/api/profiles", (req, res) =>
    res.status(201).json(store.createProfile(nameSchema.parse(req.body.name))),
  );
  app.put("/api/profiles/:id", (req, res) => {
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
  app.post("/api/games", (req, res) => {
    const game = gameSchema.parse({
      ...req.body,
      id: randomUUID(),
      revision: 0,
      updatedAt: new Date().toISOString(),
    });
    if (
      !store.state().profiles.some((p) => p.id === game.profileId) ||
      !store.dictionaries().some((d) => d.id === game.dictionaryId)
    ) {
      res.status(400).json({ error: "Unknown profile or dictionary." });
      return;
    }
    res.status(201).json(store.createGame(game));
  });
  app.put("/api/games/:id", (req, res) => {
    const game = gameSchema.parse(req.body),
      current = store.getGame(req.params.id);
    if (!current) {
      res.status(404).json({ error: "Game not found." });
      return;
    }
    if (
      game.id !== current.id ||
      game.profileId !== current.profileId ||
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
  app.delete("/api/games/:id", (req, res) => {
    store.deleteGame(req.params.id);
    res.json({ deleted: true });
  });
  app.post("/api/templates", (req, res) =>
    res.status(201).json(store.saveTemplate(templateSchema.parse(req.body))),
  );
  app.put("/api/templates/:id", (req, res) => {
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
  app.delete("/api/templates/:id", (req, res) => {
    if (!store.deleteTemplate(req.params.id)) {
      res.status(403).json({ error: "Built-in boards cannot be deleted." });
      return;
    }
    res.json({ deleted: true });
  });
  app.get("/api/dictionaries/:id", (req, res) => {
    const text = store.dictionaryText(req.params.id);
    if (text === undefined) {
      res.status(404).json({ error: "Dictionary not found." });
      return;
    }
    res.type("text/plain").send(text);
  });
  app.post("/api/dictionaries", (req, res) => {
    const { name, text } = z
      .object({ name: nameSchema, text: z.string().max(12_000_000).min(1) })
      .parse(req.body);
    res.status(201).json(store.importDictionary(name, text));
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Endpoint not found." }),
  );
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
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
