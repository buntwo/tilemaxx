import { Router } from "express";
import { z } from "zod";
import { BoardEditHistory } from "../shared/board-entry";
import {
  correctSuperLexulousCenter,
  correctTrackedMove,
  endGameManually,
  playTrackedMove,
  recordBoardlessTurn,
  recordOpponentPlay,
  recordOpponentPlayForSearch,
  reopenSearchRecordedOpponentPlay,
  resetGameScoring,
  setScoreTracking,
  treatBoardEditAsCorrection,
} from "../shared/game-scoring";
import {
  archiveGame,
  emptyBoard,
  newGameFromSettings,
  redo,
  remember,
  restoreArchivedGame,
  undo,
  MAX_GAME_NOTES,
  type Game,
} from "../shared/model";
import {
  playOwnMoveWithRackCorrection,
  prepareOwnPlay,
  prepareOwnPlayRackCorrection,
} from "../shared/own-play";
import { boardLanguages, templateForLanguage } from "../shared/presets";
import {
  rackSlotsForMove,
  reorderRack,
  shuffledRackSlots,
} from "../shared/rack-entry";
import { basePremiums, importBoard } from "../shared/screenshot";
import { unseenTiles } from "../shared/tile-pool";
import { CLEARED_BOARD } from "../shared/score-recovery";
import { defaultDictionary } from "../shared/dictionaries";
import { sameStylePlacement, type StyleExplanation } from "../shared/style-explanation";
import { ApiError } from "./api-error";
import type { createStore } from "./store";
import {
  cell,
  exchangeCount,
  exchangeSlots,
  gameSchema,
  nameSchema,
  premiums,
  rack,
  rackSlots,
  styleExplanationSchema,
} from "./validation";

type Store = ReturnType<typeof createStore>;
export const id = z.string().min(1).max(100);
export const revision = z.number().int().nonnegative();
export const square = z.number().int().min(0).max(624);
const creationToken = z
  .string()
  .regex(/^[a-f0-9]{32}$/)
  .optional();
const details = {
  name: nameSchema.optional(),
  platform: z.union([nameSchema, z.literal("")]).optional(),
  startedOn: z.iso.date().optional(),
  notes: z.string().trim().max(MAX_GAME_NOTES).optional(),
};
const direction = z.enum(["across", "down"]);
const placement = z.object({
  index: square,
  letter: z.string().regex(/^[A-Za-z]$/),
});
const action = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("edit-details"),
    ...details,
    dictionaryId: id.optional(),
  }),
  z.strictObject({
    action: z.literal("rack"),
    rack,
    excludedRackSlots: rackSlots,
    requiredRackSlots: rackSlots,
  }),
  z.strictObject({ action: z.literal("shuffle-rack") }),
  z.strictObject({
    action: z.literal("edit-board"),
    edits: z
      .array(placement.extend({ letter: cell }))
      .min(1)
      .max(625),
  }),
  z.strictObject({
    action: z.literal("import-board"),
    board: z.array(cell).max(625),
    premiums: premiums.optional(),
    layoutOnly: z.boolean().optional(),
  }),
  z.strictObject({ action: z.literal("clear-board") }),
  z.strictObject({ action: z.literal("restore-premiums") }),
  z.strictObject({
    action: z.literal("play"),
    tiles: z.array(placement).min(1).max(10),
    direction,
    useRackMarks: z.boolean().default(true),
    confirmedLeave: rack.optional(),
    bagSize: z.number().int().nonnegative().optional(),
    styleExplanation: styleExplanationSchema.optional(),
  }),
  z.strictObject({
    action: z.literal("record-opponent"),
    forSearch: z.boolean().optional(),
  }),
  z.strictObject({
    action: z.literal("record-pass"),
    player: z.enum(["you", "opponent"]),
    styleExplanation: styleExplanationSchema.optional(),
  }),
  z.discriminatedUnion("player", [
    z.strictObject({
      action: z.literal("record-exchange"),
      player: z.literal("you"),
      slots: exchangeSlots,
      styleExplanation: styleExplanationSchema.optional(),
    }),
    z.strictObject({
      action: z.literal("record-exchange"),
      player: z.literal("opponent"),
      count: exchangeCount.optional(),
    }),
  ]),
  z.strictObject({ action: z.literal("reopen-opponent") }),
  z.strictObject({ action: z.literal("keep-board-correction") }),
  z.strictObject({ action: z.literal("score-tracking"), enabled: z.boolean() }),
  z.strictObject({
    action: z.literal("correct-score"),
    index: z.number().int().nonnegative(),
    insert: z.boolean().default(false),
    player: z.enum(["you", "opponent"]),
    word: z.string().regex(/^[A-Z]{2,25}$/),
    score: z.number().int().nonnegative(),
    bingo: z.boolean().optional(),
  }),
  z.strictObject({
    action: z.literal("end"),
    scores: z
      .object({ you: z.number().int(), opponent: z.number().int() })
      .optional(),
    outcome: z.enum(["win", "loss", "tie"]).optional(),
    archive: z.boolean().optional(),
  }),
  z.strictObject({ action: z.literal("archive") }),
  z.strictObject({ action: z.literal("unarchive") }),
  z.strictObject({ action: z.literal("restore-archived-position") }),
  z.strictObject({ action: z.literal("undo") }),
  z.strictObject({ action: z.literal("redo") }),
]);

export const gameActionRequest = z.strictObject({ revision, command: action });
export const newGameRequest = z.strictObject({
  profileId: id,
  templateId: id,
  ...details,
  name: nameSchema,
  dictionaryId: id.optional(),
  language: z.enum(["en", "en-US", "en-GB", "fr", "it"]).optional(),
  solo: z.boolean().default(false),
  trackScores: z.boolean().default(true),
  creationToken,
});

function validateStyleAlternative(game: Game, explanation?: StyleExplanation) {
  const other = explanation?.alternative?.move;
  if (!other) return;
  const { placement, missing } = prepareOwnPlay(game, editedBoard(game, other.tiles, true), other.direction);
  if (!placement || missing.size || !sameStylePlacement(placement, other) ||
    !rackSlotsForMove(game, other.tiles) ||
    placement.word !== other.word || placement.score !== other.score ||
    placement.row !== other.row || placement.col !== other.col || placement.direction !== other.direction)
    throw new ApiError(422, "The style alternative does not match this position.");
}

function editedBoard(
  game: Game,
  edits: { index: number; letter: string }[],
  onlyEmpty = false,
) {
  const board = [...game.board];
  const seen = new Set<number>();
  for (const { index, letter } of edits) {
    if (index >= board.length || seen.has(index))
      throw new ApiError(
        422,
        "Each square must be on the board and appear once.",
      );
    if (onlyEmpty && board[index])
      throw new ApiError(422, "Plays must place tiles on empty squares.");
    seen.add(index);
    board[index] = letter;
  }
  return board;
}

function applyAction(game: Game, command: z.infer<typeof action>): Game {
  switch (command.action) {
    case "edit-details": {
      const { action: _action, ...fields } = command;
      return {
        ...game,
        ...fields,
        ...("platform" in fields && { platform: fields.platform || undefined }),
      };
    }
    case "rack":
      return {
        ...game,
        rack: command.rack,
        excludedRackSlots: command.excludedRackSlots,
        requiredRackSlots: command.requiredRackSlots,
      };
    case "shuffle-rack":
      return { ...game, ...reorderRack(game, shuffledRackSlots(game.rack)) };
    case "edit-board": {
      const board = editedBoard(game, command.edits);
      const kind = command.edits.some(({ letter }) => !letter)
        ? "erase"
        : command.edits.every(
              ({ index, letter }) =>
                game.board[index].toUpperCase() === letter.toUpperCase(),
            )
          ? "blank"
          : "enter";
      return new BoardEditHistory().apply(game, board, kind);
    }
    case "import-board":
      if (command.layoutOnly && !command.premiums)
        throw new ApiError(
          422,
          "Provide premium squares for a layout-only import.",
        );
      return importBoard(
        game,
        command.board,
        command.premiums,
        command.layoutOnly,
      );
    case "clear-board":
      return {
        ...game,
        ...remember(game, CLEARED_BOARD),
        board: emptyBoard(game.template.size),
        rack: "",
        excludedRackSlots: undefined,
        requiredRackSlots: undefined,
        scoring: resetGameScoring(game),
      };
    case "restore-premiums": {
      const previous = game.template.premiums;
      const original = basePremiums(game);
      if (previous.every((premium, index) => premium === original[index]))
        return game;
      const history = remember(game, "Restored original premium squares");
      const last = history.past.length - 1;
      history.past[last] = { ...history.past[last], premiums: previous };
      return {
        ...game,
        ...history,
        template: { ...game.template, premiums: original },
      };
    }
    case "play": {
      const board = editedBoard(game, command.tiles, true);
      const { placement, missing } = prepareOwnPlay(
        game,
        board,
        command.direction,
      );
      if (!placement)
        throw new ApiError(422, "The tiles do not form a connected play.");
      const { total } = unseenTiles(game, game.template);
      const minimumBag = game.solo
        ? total
        : Math.max(0, total - game.template.rackSize);
      if (command.confirmedLeave !== undefined) {
        if (command.styleExplanation)
          throw new ApiError(422, "Analyze the corrected rack before attaching a style explanation.");
        const correction = prepareOwnPlayRackCorrection(
          game,
          placement,
          command.confirmedLeave,
        );
        if ("error" in correction) throw new ApiError(422, correction.error);
        const min = game.solo
          ? correction.unseen
          : Math.max(0, correction.unseen - game.template.rackSize);
        if (
          command.bagSize !== undefined &&
          (command.bagSize < min || command.bagSize > correction.unseen)
        )
          throw new ApiError(
            422,
            "Bag size disagrees with the corrected rack.",
          );
        return playOwnMoveWithRackCorrection(game, correction, command.bagSize)
          .game;
      }
      const withMarks = command.useRackMarks;
      if (
        missing.size ||
        (withMarks && !rackSlotsForMove(game, placement.tiles))
      )
        throw new ApiError(
          422,
          "The rack and its marks cannot supply those tiles.",
        );
      const bag = command.bagSize ?? minimumBag;
      if (bag < minimumBag || bag > total)
        throw new ApiError(422, "Bag size disagrees with the entered tiles.");
      const explanation = command.styleExplanation;
      if (explanation) {
        if (explanation.kind !== "play" || explanation.played.move.word !== placement.word ||
          explanation.played.move.score !== placement.score ||
          explanation.played.move.direction !== placement.direction ||
          explanation.played.move.row !== placement.row || explanation.played.move.col !== placement.col ||
          !sameStylePlacement(explanation.played.move, placement))
          throw new ApiError(422, "The style explanation does not match this play.");
        validateStyleAlternative(game, explanation);
      }
      return playTrackedMove(game, placement, bag, withMarks, explanation);
    }
    case "record-opponent":
      return command.forSearch
        ? recordOpponentPlayForSearch(game)
        : recordOpponentPlay(game);
    case "record-pass": {
      const explanation = command.styleExplanation;
      if (explanation && (explanation.kind !== "pass" || command.player !== "you"))
        throw new ApiError(422, "The style explanation does not match this pass.");
      validateStyleAlternative(game, explanation);
      return recordBoardlessTurn(game, command.player, { kind: "pass" }, explanation);
    }
    case "record-exchange": {
      const explanation = command.player === "you" ? command.styleExplanation : undefined;
      if (explanation && (explanation.kind !== "exchange" || command.player !== "you" ||
        [...explanation.tiles].sort().join("") !== command.slots.map((slot) => game.rack[slot]).sort().join("")))
        throw new ApiError(422, "The style explanation does not match this exchange.");
      validateStyleAlternative(game, explanation);
      return recordBoardlessTurn(
        game,
        command.player,
        command.player === "you"
          ? { kind: "exchange", slots: command.slots }
          : { kind: "exchange", count: command.count },
        explanation,
      );
    }
    case "reopen-opponent":
      return reopenSearchRecordedOpponentPlay(game);
    case "keep-board-correction":
      return treatBoardEditAsCorrection(game);
    case "score-tracking":
      return setScoreTracking(game, command.enabled);
    case "correct-score":
      return correctTrackedMove(
        game,
        command.index,
        {
          player: command.player,
          word: command.word,
          score: command.score,
          bingo: command.bingo,
        },
        command.insert,
      );
    case "end": {
      if (command.outcome && (game.solo || !command.scores))
        throw new ApiError(422, "A head-to-head result requires both scores.");
      const ended = endGameManually(game, {
        manual: true,
        scores: command.scores,
        outcome: command.outcome,
      });
      return command.archive && !ended.archived ? archiveGame(ended) : ended;
    }
    case "archive":
      return game.archived ? game : archiveGame(game);
    case "unarchive":
      return game.archived
        ? {
            ...game,
            archived: false,
            archivedBoard: undefined,
            archivedState: undefined,
          }
        : game;
    case "restore-archived-position":
      return restoreArchivedGame(game);
    case "undo":
      return undo(game);
    case "redo":
      return redo(game);
  }
}

export function createGameCommands(store: Store) {
  const router = Router();
  const create = (
    game: Omit<Game, "id" | "revision" | "updatedAt">,
    token?: string,
  ) => {
    const input = gameSchema.parse({
      ...game,
      id: "",
      revision: 0,
      updatedAt: "",
    });
    const saved = token
      ? store.createGameOnce(input, token)
      : store.createGame(input);
    if (!saved) throw new ApiError(410, "This game was deleted on the server.");
    return saved;
  };
  const getGame = (id: string) => {
    const game = store.getGame(id);
    if (!game) throw new ApiError(404, "Game not found.");
    return game;
  };
  router.post("/games/new", (req, res) => {
    const request = newGameRequest.parse(req.body);
    const {
      profileId,
      templateId,
      name,
      platform,
      startedOn,
      notes,
      language,
      solo,
      trackScores,
    } = request;
    const { templates, dictionaries } = store.index();
    const layout = templates.find(({ id }) => id === templateId);
    if (!layout || !store.hasProfile(profileId))
      throw new ApiError(422, "Unknown profile or board template.");
    const languages = boardLanguages.get(templateId);
    if (language && !languages?.some(({ id }) => id === language))
      throw new ApiError(
        422,
        "This board template does not support that language.",
      );
    const selectedLanguage = language ?? languages?.[0].id;
    const template = selectedLanguage
      ? templateForLanguage(layout, selectedLanguage)
      : layout;
    const dictionaryId =
      request.dictionaryId ??
      defaultDictionary(
        dictionaries,
        undefined,
        template.rules,
        selectedLanguage,
      )?.id;
    if (!dictionaryId || !dictionaries.some(({ id }) => id === dictionaryId))
      throw new ApiError(422, "Select an installed word list.");
    const saved = create(
      {
        profileId,
        name,
        platform: platform || undefined,
        startedOn,
        notes,
        trackScores,
        ...(solo && { solo: true }),
        template,
        dictionaryId,
        board: emptyBoard(template.size),
        rack: "",
        past: [],
        future: [],
        archived: false,
      },
      request.creationToken,
    );
    res.status(201).json(saved);
  });
  router.post("/games/:id/rematch", (req, res) => {
    const { startedOn, creationToken: token } = z
      .strictObject({ startedOn: z.iso.date(), creationToken })
      .parse(req.body);
    res
      .status(201)
      .json(
        create(newGameFromSettings(getGame(req.params.id), startedOn), token),
      );
  });
  router.post("/games/:id/copy", (req, res) => {
    const { name, creationToken: token } = z
      .strictObject({ name: nameSchema.optional(), creationToken })
      .parse(req.body);
    const game = getGame(req.params.id);
    res.status(201).json(
      create(
        {
          ...game,
          name: name ?? `${game.name.slice(0, 65)} (copy)`,
          archived: false,
          archivedBoard: undefined,
          archivedState: undefined,
        },
        token,
      ),
    );
  });
  router.post("/games/:id/actions", (req, res) => {
    const request = gameActionRequest.parse(req.body);
    const game = getGame(req.params.id);
    const conflict = () =>
      res
        .status(409)
        .json({
          error: "This game was updated on another device.",
          game: store.getGame(game.id),
        });
    if (game.revision !== request.revision) {
      conflict();
      return;
    }
    let next: Game;
    try {
      next = applyAction(game, request.command);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error) throw new ApiError(422, error.message);
      throw error;
    }
    if (next === game) {
      res.json(game);
      return;
    }
    if (
      next.dictionaryId !== game.dictionaryId &&
      !store.dictionaries().some(({ id }) => id === next.dictionaryId)
    )
      throw new ApiError(422, "Select an installed word list.");
    if (game.archived && !game.archivedBoard && next.archived) {
      const baseline = archiveGame(game);
      next = {
        ...next,
        archivedBoard: baseline.archivedBoard,
        archivedState: baseline.archivedState,
      };
    }
    const saved = store.saveGame(
      gameSchema.parse(correctSuperLexulousCenter(next)),
    );
    if (!saved) {
      conflict();
      return;
    }
    res.json(saved);
  });
  return router;
}
