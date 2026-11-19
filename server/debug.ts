import { Router } from "express";
import { createHash } from "node:crypto";
import { version } from "../version.json";
import type { createStore } from "./store";

/** A separate read-only surface for developer tools. Mount before body parsing. */
export function createDebugRouter(store: ReturnType<typeof createStore>) {
  const router = Router();
  router.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      res.status(405).json({ error: "The debugging API is read only." });
      return;
    }
    next();
  });
  router.get("/games", (_req, res) => res.json(store.debugIndex()));
  router.get("/games/:id", (req, res) => {
    const game = store.getGame(req.params.id);
    if (!game) {
      res.status(404).json({ error: "Game not found." });
      return;
    }
    const dictionary = store
      .dictionaries()
      .find((d) => d.id === game.dictionaryId);
    let text: string | undefined;
    try {
      text = store.dictionaryText(game.dictionaryId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!dictionary || text === undefined) {
      res.status(409).json({ error: "The game's dictionary is unavailable." });
      return;
    }
    res.json({
      schemaVersion: 1,
      serverVersion: version,
      exportedAt: new Date().toISOString(),
      game,
      dictionary: {
        ...dictionary,
        text,
        sha256: createHash("sha256").update(text).digest("hex"),
      },
    });
  });
  router.use((_req, res) =>
    res.status(404).json({ error: "Debug endpoint not found." }),
  );
  return router;
}
