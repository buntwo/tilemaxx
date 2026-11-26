import { json, Router, type Request, type Response } from "express";
import { z } from "zod";
import { version } from "../version.json";
import { archiveStatistics } from "../shared/archive-stats";
import { correctSuperLexulousCenter } from "../shared/game-scoring";
import { ApiError } from "./api-error";
import { createComputationRunner } from "./api-computation";
import {
  createGameCommands,
  gameActionRequest,
  newGameRequest,
} from "./api-games";
import {
  analysisRequest,
  inferPremiumsRequest,
  screenshotRequest,
  wordCheck,
} from "./api-analysis-request";
import type { createStore } from "./store";
import type { ProfileVocabularySource } from "./profile-vocabulary";
import { gameWordLanguage } from "../shared/model";
import {
  gameSchema,
  screenshotExampleSchema,
  templateSchema,
} from "./validation";

const schemas = {
  "POST /analysis": analysisRequest,
  "POST /games/new": newGameRequest,
  "POST /games/:id/actions": gameActionRequest,
  "PUT /games/:id": gameSchema,
  "POST /screenshots/read": screenshotRequest,
  "POST /screenshots/infer-premiums": inferPremiumsRequest,
  "POST /screenshot-examples": screenshotExampleSchema,
  "POST /templates": templateSchema,
  "POST /word-check": wordCheck,
};
export function createProgrammaticRouter(
  store: ReturnType<typeof createStore>,
  root: string,
  vocabulary: ProfileVocabularySource,
) {
  const router = Router();
  const compute = createComputationRunner();
  const dictionaryFile = (id: string) => {
    const file = store.dictionaryFile(id);
    if (!file) throw new ApiError(404, "Word list not found.");
    return { file };
  };
  async function run(res: Response, input: Parameters<typeof compute>[0]) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    res.once("close", cancel);
    try {
      if (input.kind === "analysis" && "file" in input.dictionary &&
          gameWordLanguage(input.position.template.rules) === "en") {
        const operation = input.operation;
        const style = operation.kind === "moves" ? operation.style
          : operation.kind === "compare" ? operation.opponent
          : operation.kind === "exchange-advice" && operation.style === "learner" ? "learner"
          : undefined;
        if (style === "casual" || style === "learner")
          input = { ...input, profileVocabulary: (await vocabulary(input.dictionary.file)).bytes };
      }
      const result = await compute(input, controller.signal);
      if (!controller.signal.aborted) res.json(result);
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      res.off("close", cancel);
    }
  }

  router.use(json({ limit: "16mb" }));
  router.use(createGameCommands(store));
  router.get("/schema", (_req, res) => {
    res.json(
      Object.fromEntries(
        Object.entries(schemas).map(([route, schema]) => [
          route,
          z.toJSONSchema(schema, { io: "input", reused: "ref" }),
        ]),
      ),
    );
  });
  router.get("/health", (_req, res) => res.json({ ok: true, version }));
  router.get("/archive/statistics", (req, res) => {
    const { profileId } = z
      .object({ profileId: z.string().min(1).max(100) })
      .parse(req.query);
    if (!store.hasProfile(profileId))
      throw new ApiError(404, "Profile not found.");
    res.json(
      archiveStatistics(
        store
          .index()
          .games.filter(
            (game) => game.archived && game.profileId === profileId,
          ),
      ),
    );
  });
  router.post("/word-check", async (req, res) => {
    const { dictionary, words } = wordCheck.parse(req.body);
    await run(res, {
      kind: "word-check",
      words,
      dictionary:
        "id" in dictionary ? dictionaryFile(dictionary.id) : dictionary,
    });
  });
  router.post("/screenshots/read", async (req, res) => {
    await run(res, {
      kind: "screenshot",
      request: screenshotRequest.parse(req.body),
    });
  });
  router.post("/screenshots/infer-premiums", async (req, res) => {
    await run(res, {
      kind: "premium-inference",
      request: inferPremiumsRequest.parse(req.body),
    });
  });
  router.post("/analysis", async (req: Request, res) => {
    const { position, operation } = analysisRequest.parse(req.body);
    if ("gameId" in position) {
      const saved = store.getGame(position.gameId);
      if (!saved) throw new ApiError(404, "Game not found.");
      if (
        position.revision !== undefined &&
        saved.revision !== position.revision
      ) {
        res
          .status(409)
          .json({
            error: "This game was updated on another device.",
            game: saved,
          });
        return;
      }
      res.setHeader("X-Tilemaxx-Revision", String(saved.revision));
      const game = correctSuperLexulousCenter(saved);
      const review = [
        "position",
        "review-game",
        "review-turn",
        "policy",
        "policy-timeline",
      ].includes(operation.kind);
      const {
        template,
        board,
        rack,
        excludedRackSlots,
        requiredRackSlots,
        dictionaryId,
        solo,
      } = game;
      await run(res, {
        kind: "analysis",
        dictionary: dictionaryFile(dictionaryId),
        root,
        operation,
        position: {
          template,
          board,
          rack,
          excludedRackSlots,
          requiredRackSlots,
          dictionaryId,
          solo,
        },
        game: review ? game : undefined,
      });
    } else {
      await run(res, {
        kind: "analysis",
        dictionary: dictionaryFile(position.dictionaryId),
        position,
        operation,
        root,
      });
    }
  });
  return router;
}
