import express from "express";
import compression from "compression";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createStore } from "./store";
import { gameSchema, nameSchema, templateSchema } from "./validation";

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
  app.post("/api/profiles", (req, res) =>
    res.status(201).json(store.createProfile(nameSchema.parse(req.body.name))),
  );
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
      res
        .status(409)
        .json({
          error: "This game was updated on another device.",
          game: store.getGame(game.id),
        });
      return;
    }
    res.json(saved);
  });
  app.post("/api/templates", (req, res) =>
    res.status(201).json(store.saveTemplate(templateSchema.parse(req.body))),
  );
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
      res
        .status(500)
        .json({
          error:
            "Could not save this change. Your local draft is still available.",
        });
    },
  );
  return app;
}
