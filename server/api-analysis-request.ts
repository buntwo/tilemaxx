import { z } from "zod";
import { id, revision, square } from "./api-games";
import { cell, rack, rackSlots, templateSchema } from "./validation";
import { PLAYER_PROFILES } from "../shared/player-profiles";
import { SIMULATED_STYLES } from "../shared/simulated-styles";

const boardSize = z.number().int().min(5).max(25);
const moveId = z.string().min(1).max(100);
const seed = z.number().int().min(0).max(0xffffffff);
const slots = z.array(z.number().int().min(0).max(9)).min(1).max(10);
const player = z.enum(["you", "opponent"]);

export const boardPosition = z
  .strictObject({
    template: templateSchema,
    board: z.array(cell).max(625),
    rack,
    excludedRackSlots: rackSlots,
    requiredRackSlots: rackSlots,
    dictionaryId: id,
    solo: z.boolean().optional(),
  })
  .refine(
    ({
      template,
      board,
      rack,
      excludedRackSlots = [],
      requiredRackSlots = [],
    }) => {
      const marks = [...excludedRackSlots, ...requiredRackSlots];
      return (
        board.length === template.size ** 2 &&
        rack.length <= template.rackSize &&
        new Set(marks).size === marks.length &&
        marks.every((index) => index < rack.length && rack[index] !== ".")
      );
    },
    "Invalid board, rack or rack marks.",
  );

export const savedPosition = z.strictObject({
  gameId: id,
  revision: revision.optional(),
});
const position = z.union([savedPosition, boardPosition]);
const replyOptions = {
  bagSize: z.number().int().nonnegative().optional(),
  scorelessTurns: z.number().int().min(0).max(15).default(0),
  opponentHasFinalTurn: z.boolean().default(true),
};
const profile = z.enum(PLAYER_PROFILES);
const turnIndex = z.number().int().nonnegative();
const offset = z.number().int().nonnegative().default(0);

export const analysisRequest = z.strictObject({
  position,
  operation: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("position"), square: square.optional() }),
    z.strictObject({
      kind: z.literal("moves"),
      ...replyOptions,
      offset,
      word: z
        .string()
        .regex(/^[a-zA-Z]{0,25}$/)
        .default(""),
      squares: z.array(square).max(25).optional(),
      sort: z
        .enum([
          "score",
          "shortlist",
          "word",
          "position",
          "length",
          "tiles",
          "leave",
          "blanks",
          "equity",
          "playing-style",
          "endgame",
          "bingo-draw",
        ])
        .optional(),
      reversed: z.boolean().optional(),
      style: z.enum([...PLAYER_PROFILES, ...SIMULATED_STYLES]).optional(),
      seed: seed.default(0),
      sample: seed.default(0),
      budgetMs: z.number().int().min(1_000).max(25_000).default(10_000),
    }),
    z.strictObject({
      kind: z.literal("compare"),
      ...replyOptions,
      moves: z.array(moveId).min(1).max(3),
      opponent: profile.optional(),
      previousBoard: z.array(cell).max(625).optional(),
      seed: seed.default(8017),
      refined: z.boolean().optional(),
      endgameBudgetMultiplier: z.number().int().min(1).max(100).optional(),
    }),
    z.strictObject({
      kind: z.literal("reply"),
      ...replyOptions,
      move: moveId,
      reference: moveId.optional(),
      refined: z.boolean().optional(),
      heatmap: z.boolean().optional(),
    }),
    z.strictObject({
      kind: z.literal("endgame-line"),
      ...replyOptions,
      move: moveId,
      budgetMs: z.number().int().min(1_000).max(30_000).default(10_000),
    }),
    z.strictObject({ kind: z.literal("opponent-endgame"), ...replyOptions }),
    z.strictObject({
      kind: z.literal("bingo-odds"),
      ...replyOptions,
      moves: z.array(moveId).min(1).max(20),
      boardBased: z.boolean().optional(),
    }),
    z.strictObject({
      kind: z.literal("premium-defense"),
      moves: z.array(moveId).min(1).max(20).optional(),
    }),
    z.strictObject({
      kind: z.literal("exchange"),
      ...replyOptions,
      slots,
      seed: seed.default(8017),
    }),
    z.strictObject({
      kind: z.literal("optimal-exchange"),
      ...replyOptions,
      seed: seed.default(8017),
    }),
    z.strictObject({
      kind: z.literal("exchange-advice"),
      ...replyOptions,
      style: profile.optional(),
      seed: seed.default(8017),
      move: moveId.optional(),
    }),
    z.strictObject({ kind: z.literal("review-turn"), index: turnIndex }),
    z.strictObject({ kind: z.literal("review-game") }),
    z.strictObject({
      kind: z.literal("policy"),
      index: turnIndex,
      refined: z.boolean().optional(),
    }),
    z.strictObject({ kind: z.literal("policy-timeline"), player, offset }),
  ]),
});

export const screenshotRequest = z.strictObject({
  image: z.base64().min(4).max(15_000_000),
  format: z.enum(["png", "jpeg", "webp", "heif"]),
  size: boardSize,
  crop: z
    .object({
      left: z.number(),
      top: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
});

export const wordCheck = z.strictObject({
  words: z
    .array(z.string().regex(/^[a-zA-Z]{2,25}$/))
    .min(1)
    .max(100),
  dictionary: z.union([
    z.strictObject({ id }),
    z.strictObject({ text: z.string().min(1).max(12_000_000) }),
  ]),
});

export const inferPremiumsRequest = z
  .strictObject({
    template: templateSchema,
    board: z.array(cell).max(625),
    squares: z
      .array(z.enum(["", "DL", "TL", "QL", "DW", "TW", "QW"]).nullable())
      .max(625),
    sequence: z.number().int().nonnegative().optional(),
    scores: z
      .array(z.number().int().nonnegative().nullable())
      .min(1)
      .max(2)
      .optional(),
  })
  .refine(
    ({ board, squares, template }) =>
      board.length === template.size ** 2 && squares.length === board.length,
    "The board and premiums must match the template.",
  );
