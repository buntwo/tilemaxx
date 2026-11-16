import { z } from "zod";
import { validateCrop } from "../shared/screenshot";
import { MAX_TILE_COUNT, TILE_SYMBOLS } from "../shared/tile-pool";
import { MAX_GAME_NOTES, RULE_NAMES } from "../shared/model";
export const nameSchema = z.string().trim().min(1).max(80);
const cell = z.string().regex(/^[a-zA-Z]?$/);
const premium = z.enum(["", "DL", "TL", "QL", "DW", "TW", "QW"]);
const premiums = z.array(premium).max(625);
export const screenshotExampleSchema = z
  .object({
    size: z.number().int().min(5).max(25),
    crop: z.object({
      left: z.number(),
      top: z.number(),
      width: z.number(),
      height: z.number(),
    }),
    sourceWidth: z.number().int().positive(),
    sourceHeight: z.number().int().positive(),
    recognized: z.object({
      board: z.array(cell).max(625),
      uncertain: z.array(z.number().int().min(0).max(624)).max(625),
      candidates: z.number().int().min(0).max(625),
      premiums: z
        .object({
          style: z.enum(["wordfeud", "scrabble-go"]),
          squares: z.array(premium.nullable()).max(625),
          fixed: premiums.optional(),
        })
        .optional(),
    }),
    corrected: z.array(cell).max(625),
    correctedPremiums: z.array(premium.nullable()).max(625).optional(),
    croppedPng: z
      .string()
      .min(32)
      .max(12_100_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .refine((example) => {
    try {
      validateCrop(
        example.crop,
        example.sourceWidth,
        example.sourceHeight,
        example.size,
      );
    } catch {
      return false;
    }
    const cells = example.size ** 2;
    return (
      example.sourceWidth * example.sourceHeight <= 32_000_000 &&
      example.recognized.board.length === cells &&
      example.corrected.length === cells &&
      (!example.correctedPremiums ||
        example.correctedPremiums.length === cells) &&
      (!example.recognized.premiums ||
        (example.recognized.premiums.squares.length === cells &&
          (!example.recognized.premiums.fixed ||
            example.recognized.premiums.fixed.length === cells))) &&
      example.recognized.candidates <= cells &&
      example.recognized.uncertain.every((index) => index < cells)
    );
  }, "The example must match the cropped board.");
const rack = z
  .string()
  .regex(/^[A-Z?.]*$/)
  .max(10);
const excludedRackSlots = z
  .array(z.number().int().min(0).max(9))
  .max(10)
  .optional();
export const templateSchema = z
  .object({
    id: z.string().max(100),
    name: nameSchema,
    size: z.number().int().min(5).max(25),
    premiums,
    start: z.number().int().min(0),
    rackSize: z.number().int().min(1).max(10),
    bingo: z.number().int().min(0).max(200),
    additionalBonuses: z
      .record(z.string().regex(/^[1-9]$/), z.number().int().min(1).max(200))
      .optional(),
    rules: z.enum(Object.keys(RULE_NAMES) as (keyof typeof RULE_NAMES)[]),
    tileCounts: z
      .record(z.enum(TILE_SYMBOLS), z.number().int().min(0).max(MAX_TILE_COUNT))
      .optional(),
    builtin: z.boolean().optional(),
  })
  .refine(
    (t) => t.premiums.length === t.size * t.size && t.start < t.size * t.size,
    "Invalid board dimensions",
  )
  .refine(
    (t) =>
      Object.keys(t.additionalBonuses ?? {}).every(
        (count) => Number(count) < t.rackSize,
      ),
    {
      path: ["additionalBonuses"],
      message: "Additional bonuses must use fewer tiles than the rack size.",
    },
  );
const score = z.object({
  points: z.number().int().nonnegative(),
  moves: z.number().int().nonnegative(),
  best: z.number().int().nonnegative(),
  bingos: z.number().int().nonnegative(),
});
const endedOn = z.iso.date().optional();
const scoringSchema = z.object({
  you: score,
  opponent: score,
  pendingBase: z.array(cell).max(625).optional(),
  imported: z.boolean().optional(),
  historyStart: z.number().int().nonnegative().optional(),
  incomplete: z.boolean().optional(),
  end: z
    .union([
      z.object({
        out: z.enum(["you", "opponent"]),
        rackPoints: z.number().int().nonnegative(),
        endedOn,
      }),
      z
        .object({
          manual: z.literal(true),
          scores: z
            .object({ you: z.number().int(), opponent: z.number().int() })
            .optional(),
          outcome: z.enum(["win", "loss", "tie"]).optional(),
          endedOn,
        })
        .refine((end) => !end.outcome || !!end.scores),
    ])
    .optional(),
});
const review = z
  .object({
    board: z.array(cell).max(625),
    rack: rack.optional(),
    observerRack: rack.optional(),
    excludedRackSlots,
    dictionaryId: z.string().max(100),
    premiums: premiums.optional(),
    tiles: z
      .array(
        z.object({
          index: z.number().int().min(0).max(624),
          letter: z.string().regex(/^[a-zA-Z]$/),
        }),
      )
      .min(1)
      .max(10),
    direction: z.enum(["across", "down"]).optional(),
  })
  .optional();
const trackedMoves = z
  .array(
    z.object({
      player: z.enum(["you", "opponent"]),
      word: z.string().regex(/^[A-Z]{2,25}$/),
      score: z.number().int().nonnegative(),
      bingo: z.boolean().optional(),
      at: z.string().max(50),
      review,
    }),
  )
  .optional();
const historySchema = z.object({
  premiums: premiums.optional(),
  board: z.array(cell).max(625),
  rack,
  excludedRackSlots,
  label: z.string().max(100),
  score: z.number().optional(),
  bingo: z.boolean().optional(),
  player: z.enum(["you", "opponent"]).optional(),
  trackScores: z.boolean().optional(),
  scoring: scoringSchema.optional(),
  trackedMoves,
  review,
  at: z.string().max(50),
});
const gameProgress = z.object({
  trackScores: z.boolean().optional(),
  scoring: scoringSchema.optional(),
  trackedMoves,
  rack,
  excludedRackSlots,
  past: z.array(historySchema).max(100),
  future: z.array(historySchema).max(100),
});
export const gameSchema = gameProgress
  .extend({
    id: z.string().max(100),
    profileId: z.string().max(100),
    name: nameSchema,
    platform: nameSchema.optional(),
    startedOn: z.iso.date().optional(),
    notes: z.string().trim().max(MAX_GAME_NOTES).optional(),
    template: templateSchema,
    originalPremiums: premiums.optional(),
    dictionaryId: z.string().max(100),
    board: z.array(cell).max(625),
    revision: z.number().int().min(0),
    updatedAt: z.string().max(50),
    archived: z.boolean(),
    archivedBoard: z.array(cell).max(625).optional(),
    archivedState: gameProgress
      .extend({ premiums: premiums.optional() })
      .optional(),
  })
  .refine((g) => {
    const size = g.template.size ** 2;
    const validRack = (rack: string, slots: number[] = []) =>
      rack.length <= g.template.rackSize &&
      new Set(slots).size === slots.length &&
      slots.every((slot) => slot < rack.length && rack[slot] !== ".");
    const validReview = (position: z.infer<typeof review>) =>
      !position ||
      (position.board.length === size &&
        (!position.premiums || position.premiums.length === size) &&
        validRack(position.rack ?? "", position.excludedRackSlots) &&
        validRack(position.observerRack ?? "") &&
        position.tiles.every(
          (tile) => tile.index < size && !position.board[tile.index],
        ) &&
        new Set(position.tiles.map((tile) => tile.index)).size ===
          position.tiles.length);
    const validProgress = (progress: z.infer<typeof gameProgress>) =>
      (progress.trackedMoves?.every((move) => validReview(move.review)) ??
        true) &&
      [progress, ...progress.past, ...progress.future].every(
        (entry) =>
          validRack(entry.rack, entry.excludedRackSlots) &&
          (!entry.scoring?.pendingBase ||
            entry.scoring.pendingBase.length === size),
      ) &&
      [...progress.past, ...progress.future].every(
        (entry) =>
          entry.board.length === size &&
          (!entry.premiums || entry.premiums.length === size) &&
          validReview(entry.review) &&
          (entry.trackedMoves?.every((move) => validReview(move.review)) ??
            true),
      );
    return (
      g.board.length === size &&
      (!g.originalPremiums || g.originalPremiums.length === size) &&
      (!g.archivedBoard || g.archivedBoard.length === size) &&
      validProgress(g) &&
      (!g.archivedState ||
        (g.archived &&
          !!g.archivedBoard &&
          (!g.archivedState.premiums ||
            g.archivedState.premiums.length === size) &&
          validProgress(g.archivedState)))
    );
  }, "Invalid position dimensions");
