import type { Dictionary, Game, TrackedMove, TurnPosition } from "./model";

export interface GameExport {
  format: "tilemaxx-game";
  version: 1;
  game: Omit<Game, "id" | "profileId" | "revision" | "updatedAt">;
  wordLists: Pick<Dictionary, "id" | "name" | "builtin">[];
}

export function createGameExport(
  game: Game,
  dictionaries: readonly Dictionary[],
): GameExport {
  const { id, profileId, revision, updatedAt, ...snapshot } = game;
  const wordListIds = new Set([game.dictionaryId]);

  function includeReview(review: TurnPosition | undefined) {
    if (review) wordListIds.add(review.dictionaryId);
  }

  function includeMoves(moves: readonly TrackedMove[] | undefined) {
    for (const move of moves ?? []) includeReview(move.review);
  }

  for (const position of [game, game.archivedState]) {
    if (!position) continue;
    includeMoves(position.trackedMoves);
    for (const entry of [...position.past, ...position.future]) {
      includeReview(entry.review);
      includeMoves(entry.trackedMoves);
    }
  }

  return {
    format: "tilemaxx-game",
    version: 1,
    game: snapshot,
    wordLists: dictionaries
      .filter(({ id }) => wordListIds.has(id))
      .map(({ id, name, builtin }) => ({ id, name, builtin })),
  };
}
