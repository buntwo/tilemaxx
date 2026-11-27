import { z } from "zod";
import { validateCrop } from "../shared/screenshot";
import { MAX_TILE_COUNT, TILE_SYMBOLS } from "../shared/tile-pool";
import { MAX_GAME_NOTES, RULE_NAMES } from "../shared/model";
export const nameSchema = z.string().trim().min(1).max(80);
export const cell = z.string().regex(/^[a-zA-Z]?$/);
const premium = z.enum(["", "DL", "TL", "QL", "DW", "TW", "QW"]);
export const premiums = z.array(premium).max(625);
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
export const rack = z
  .string()
  .regex(/^[A-Z?.]*$/)
  .max(10);
export const rackSlots = z.array(z.number().int().min(0).max(9)).max(10).optional();
export const exchangeSlots = rackSlots.unwrap().min(1);
export const exchangeCount = z.number().int().min(1).max(10);
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
const finishTime = {
  endedOn: z.iso.date().optional(),
  endedAt: z.iso.datetime().optional(),
};
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
        ...finishTime,
      }),
      z
        .object({
          manual: z.literal(true),
          scores: z
            .object({ you: z.number().int(), opponent: z.number().int() })
            .optional(),
          outcome: z.enum(["win", "loss", "tie"]).optional(),
          ...finishTime,
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
    excludedRackSlots: rackSlots,
    requiredRackSlots: rackSlots,
    dictionaryId: z.string().max(100),
    premiums: premiums.optional(),
    tiles: z
      .array(
        z.object({
          index: z.number().int().min(0).max(624),
          letter: z.string().regex(/^[a-zA-Z]$/),
        }),
      )
      .max(10),
    direction: z.enum(["across", "down"]).optional(),
  })
  .optional();
const boardlessTurn = z.union([
  z.strictObject({ kind: z.literal("pass") }),
  z.strictObject({
    kind: z.literal("exchange"),
    slots: exchangeSlots,
  }),
  z.strictObject({
    kind: z.literal("exchange"),
    count: exchangeCount.optional(),
  }),
]).optional();
const moveServerVersion = z.string().max(40).regex(/^\d+\.\d+\.\d+$/).optional();
const trackedMoves = z
  .array(
    z.object({
      player: z.enum(["you", "opponent"]),
      word: z.string().regex(/^[A-Z]{2,25}$/),
      score: z.number().int().nonnegative(),
      bingo: z.boolean().optional(),
      action: boardlessTurn,
      at: z.string().max(50),
      serverVersion: moveServerVersion,
      review,
    }),
  )
  .optional();
const historySchema = z.object({
  premiums: premiums.optional(),
  board: z.array(cell).max(625),
  rack,
  excludedRackSlots: rackSlots,
  requiredRackSlots: rackSlots,
  label: z.string().max(100),
  score: z.number().optional(),
  bingo: z.boolean().optional(),
  action: boardlessTurn,
  player: z.enum(["you", "opponent"]).optional(),
  recordedOnSearch: z.literal(true).optional(),
  trackScores: z.boolean().optional(),
  scoring: scoringSchema.optional(),
  trackedMoves,
  review,
  at: z.string().max(50),
  serverVersion: moveServerVersion,
});
const savedBoardWordScores = z.object({
  board: z.string().max(625).regex(/^[a-zA-Z.]+$/),
  words: z.array(z.object({
    start: z.number().int().min(0).max(624),
    direction: z.enum(["across", "down"]),
    score: z.number().int().nonnegative(),
    fromPlay: z.boolean(),
    player: z.enum(["you", "opponent"]).optional(),
    bingo: z.boolean().optional(),
  })).max(1250),
}).optional();
const gameProgress = z.object({
  trackScores: z.boolean().optional(),
  scoring: scoringSchema.optional(),
  trackedMoves,
  rack,
  excludedRackSlots: rackSlots,
  requiredRackSlots: rackSlots,
  past: z.array(historySchema).max(100),
  future: z.array(historySchema).max(100),
  savedBoardWordScores,
});
const replayRecovery = z.array(z.object({
  move: z.string().min(1).max(512),
  correctionAfter: z.literal(true).optional(),
  position: review,
  observerRack: rack.optional(),
  afterRack: rack.optional(),
  draw: z.object({
    tiles: z.string().regex(/^[A-Z?]{1,10}$/),
    count: z.number().int().min(1).max(10).optional(),
  }).optional(),
}).nullable()).optional();
export const gameSchema = gameProgress
  .extend({
    id: z.string().max(100),
    profileId: z.string().max(100),
    name: nameSchema,
    solo: z.literal(true).optional(),
    platform: nameSchema.optional(),
    startedOn: z.iso.date().optional(),
    startedAt: z.iso.datetime().optional(),
    notes: z.string().trim().max(MAX_GAME_NOTES).optional(),
    template: templateSchema,
    originalPremiums: premiums.optional(),
    dictionaryId: z.string().max(100),
    board: z.array(cell).max(625),
    revision: z.number().int().min(0),
    updatedAt: z.string().max(50),
    archived: z.boolean(),
    replayRecovery,
    archivedBoard: z.array(cell).max(625).optional(),
    archivedState: gameProgress
      .extend({ premiums: premiums.optional(), replayRecovery })
      .optional(),
  })
  .refine((g) => {
    const size = g.template.size ** 2;
    const validRack = (rack: string, slots: number[] = []) =>
      rack.length <= g.template.rackSize &&
      new Set(slots).size === slots.length &&
      slots.every((slot) => slot < rack.length && rack[slot] !== ".");
    const validRackMarks = ({
      rack = "",
      excludedRackSlots = [],
      requiredRackSlots = [],
    }: {
      rack?: string;
      excludedRackSlots?: number[];
      requiredRackSlots?: number[];
    }) => validRack(rack, [...excludedRackSlots, ...requiredRackSlots]);
    const validReview = (position: z.infer<typeof review>, boardless = false) =>
      !position ||
      (position.board.length === size &&
        (boardless ? position.tiles.length === 0 : position.tiles.length > 0) &&
        (!position.premiums || position.premiums.length === size) &&
        validRackMarks(position) &&
        validRack(position.observerRack ?? "") &&
        position.tiles.every(
          (tile) => tile.index < size && !position.board[tile.index],
        ) &&
        new Set(position.tiles.map((tile) => tile.index)).size ===
          position.tiles.length);
    const validTurn = ({
      action, bingo, player, review: position, score,
    }: Pick<z.infer<typeof historySchema>, "action" | "bingo" | "player" | "review" | "score">, label: string) => {
      if (!action) return validReview(position);
      if (!player || (g.solo && player !== "you") || !position || score !== 0 || bingo ||
          label !== (action.kind === "pass" ? "PASS" : "EXCHANGE") || !validReview(position, true))
        return false;
      if (action.kind === "pass") return true;
      return "slots" in action
        ? player === "you" && validRack(position.rack ?? "", action.slots)
        : player === "opponent" && (action.count ?? 0) <= g.template.rackSize;
    };
    const validTrackedMoves = (moves: z.infer<typeof trackedMoves>) =>
      moves?.every((move) => validTurn(move, move.word)) ?? true;
    const validProgress = (progress: z.infer<typeof gameProgress>) =>
      validTrackedMoves(progress.trackedMoves) &&
      (!progress.savedBoardWordScores ||
        (progress.savedBoardWordScores.board.length === size &&
          progress.savedBoardWordScores.words.every(({ start }) => start < size))) &&
      [progress, ...progress.past, ...progress.future].every(
        (entry) =>
          validRackMarks(entry) &&
          (!entry.scoring?.pendingBase ||
            entry.scoring.pendingBase.length === size),
      ) &&
      [...progress.past, ...progress.future].every(
        (entry) =>
          entry.board.length === size &&
          (!entry.premiums || entry.premiums.length === size) &&
          validTurn(entry, entry.label) &&
          validTrackedMoves(entry.trackedMoves),
      );
    const validRecovery = (recovery: z.infer<typeof replayRecovery>) =>
      recovery?.every((turn) =>
        !turn ||
        (validReview(turn.position) &&
          validRack(turn.observerRack ?? "") &&
          validRack(turn.afterRack ?? "") &&
          (!turn.draw ||
            (validRack(turn.draw.tiles) &&
              (turn.draw.count === undefined ||
                (turn.draw.count >= turn.draw.tiles.length && turn.draw.count <= g.template.rackSize))))),
      ) ?? true;
    return (
      g.board.length === size &&
      (!g.originalPremiums || g.originalPremiums.length === size) &&
      (!g.archivedBoard || g.archivedBoard.length === size) &&
      validProgress(g) &&
      validRecovery(g.replayRecovery) &&
      (!g.archivedState ||
        (g.archived &&
          !!g.archivedBoard &&
          (!g.archivedState.premiums ||
            g.archivedState.premiums.length === size) &&
          validProgress(g.archivedState) &&
          validRecovery(g.archivedState.replayRecovery)))
    );
  }, "Invalid position dimensions");
