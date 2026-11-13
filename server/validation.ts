import { z } from "zod";
import { validateCrop } from "../shared/screenshot";
import { MAX_TILE_COUNT, TILE_SYMBOLS } from "../shared/tile-pool";
import { MAX_GAME_NOTES } from "../shared/model";
export const nameSchema = z.string().trim().min(1).max(80);
const cell = z.string().regex(/^[a-zA-Z]?$/);
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
    }),
    corrected: z.array(cell).max(625),
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
    premiums: z
      .array(z.enum(["", "DL", "TL", "QL", "DW", "TW", "QW"]))
      .max(625),
    start: z.number().int().min(0),
    rackSize: z.number().int().min(1).max(10),
    bingo: z.number().int().min(0).max(200),
    rules: z.enum(["scrabble", "wwf"]),
    tileCounts: z
      .record(z.enum(TILE_SYMBOLS), z.number().int().min(0).max(MAX_TILE_COUNT))
      .optional(),
    builtin: z.boolean().optional(),
  })
  .refine(
    (t) => t.premiums.length === t.size * t.size && t.start < t.size * t.size,
    "Invalid board dimensions",
  );
const score = z.object({
  points: z.number().int().nonnegative(),
  moves: z.number().int().nonnegative(),
  best: z.number().int().nonnegative(),
  bingos: z.number().int().nonnegative(),
});
const scoringSchema = z.object({
  you: score,
  opponent: score,
  pendingBase: z.array(cell).max(625).optional(),
  imported: z.boolean().optional(),
});
const review = z
  .object({
    board: z.array(cell).max(625),
    rack: rack.optional(),
    dictionaryId: z.string().max(100),
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
  board: z.array(cell).max(625),
  rack,
  excludedRackSlots,
  label: z.string().max(100),
  score: z.number().optional(),
  bingo: z.boolean().optional(),
  player: z.enum(["you", "opponent"]).optional(),
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
    dictionaryId: z.string().max(100),
    board: z.array(cell).max(625),
    revision: z.number().int().min(0),
    updatedAt: z.string().max(50),
    archived: z.boolean(),
    archivedBoard: z.array(cell).max(625).optional(),
    archivedState: gameProgress.optional(),
  })
  .refine((g) => {
    const size = g.template.size ** 2;
    const validReview = (position: z.infer<typeof review>) =>
      !position ||
      (position.board.length === size &&
        (position.rack?.length ?? 0) <= g.template.rackSize &&
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
          entry.rack.length <= g.template.rackSize &&
          (!entry.excludedRackSlots ||
            (new Set(entry.excludedRackSlots).size ===
              entry.excludedRackSlots.length &&
              entry.excludedRackSlots.every(
                (slot) => slot < entry.rack.length && entry.rack[slot] !== ".",
              ))) &&
          (!entry.scoring?.pendingBase ||
            entry.scoring.pendingBase.length === size),
      ) &&
      [...progress.past, ...progress.future].every(
        (entry) =>
          entry.board.length === size &&
          validReview(entry.review) &&
          (entry.trackedMoves?.every((move) => validReview(move.review)) ??
            true),
      );
    return (
      g.board.length === size &&
      (!g.archivedBoard || g.archivedBoard.length === size) &&
      validProgress(g) &&
      (!g.archivedState ||
        (g.archived && !!g.archivedBoard && validProgress(g.archivedState)))
    );
  }, "Invalid position dimensions");
