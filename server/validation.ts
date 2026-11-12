import { z } from "zod";
export const nameSchema = z.string().trim().min(1).max(80);
const cell = z.string().regex(/^[a-zA-Z]?$/);
const rack = z
  .string()
  .regex(/^[A-Z?]*$/)
  .max(10);
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
    builtin: z.boolean().optional(),
  })
  .refine(
    (t) => t.premiums.length === t.size * t.size && t.start < t.size * t.size,
    "Invalid board dimensions",
  );
const historySchema = z.object({
  board: z.array(cell).max(625),
  rack,
  label: z.string().max(100),
  score: z.number().optional(),
  at: z.string().max(50),
});
export const gameSchema = z
  .object({
    id: z.string().max(100),
    profileId: z.string().max(100),
    name: nameSchema,
    template: templateSchema,
    dictionaryId: z.string().max(100),
    board: z.array(cell).max(625),
    rack,
    past: z.array(historySchema).max(100),
    future: z.array(historySchema).max(100),
    revision: z.number().int().min(0),
    updatedAt: z.string().max(50),
    archived: z.boolean(),
  })
  .refine(
    (g) =>
      g.board.length === g.template.size ** 2 &&
      g.rack.length <= g.template.rackSize &&
      [...g.past, ...g.future].every(
        (h) =>
          h.board.length === g.template.size ** 2 &&
          h.rack.length <= g.template.rackSize,
      ),
    "Invalid position dimensions",
  );
