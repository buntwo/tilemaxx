import { currentScoreStart, reviewTurns } from "./game-scoring";
import {
  restoreArchivedGame,
  trackedMoveHistory,
  type Board,
  type BoardTemplate,
  type Game,
  type Player,
  type TrackedMove,
  type TurnPosition,
} from "./model";
import { rackSlotsForMove } from "./rack-entry";
import { unseenTiles } from "./tile-pool";

export type ReplayFrame = {
  board?: Board;
  template: BoardTemplate;
  move?: TrackedMove;
  position?: TurnPosition;
  rack?: string;
  playedSlots?: number[];
  opponentPlayedTiles?: string;
  bag?: { count: number; estimated: boolean; invalid: boolean };
  scores: Record<Player, number>;
};

function replaySource(game: Game) {
  return game.archivedState ? restoreArchivedGame(game) : game;
}

export function hasRecordedMoves(game: Game) {
  return trackedMoveHistory(replaySource(game)).length > 0;
}

function replayBag(
  pool: ReturnType<typeof unseenTiles>,
  ownRack: string | undefined,
  template: BoardTemplate,
  solo: boolean,
): ReplayFrame["bag"] {
  const assumedRackTiles =
    (solo ? 0 : template.rackSize) + (ownRack === undefined ? template.rackSize : 0);
  return {
    count: Math.max(0, pool.total - assumedRackTiles),
    estimated: !solo || ownRack === undefined,
    invalid: pool.excess.length > 0,
  };
}

function replayPlacement(
  player: Player,
  position: TurnPosition,
  template: BoardTemplate,
  solo: boolean,
): Pick<ReplayFrame, "rack" | "playedSlots" | "opponentPlayedTiles" | "bag"> {
  const { board, tiles } = position;
  const ownRack = player === "you" ? position.rack : position.observerRack;
  const pool = unseenTiles({ board, rack: ownRack ?? "" }, template);
  const bag = replayBag(pool, ownRack, template, solo);
  if (player === "you") {
    return {
      bag,
      rack: ownRack,
      playedSlots: ownRack === undefined
        ? undefined
        : rackSlotsForMove({ ...position, rack: ownRack }, tiles) ?? undefined,
    };
  }
  const opponentPlayedTiles = tiles.length <= template.rackSize
    ? tiles.map(({ letter }) => letter === letter.toUpperCase() ? letter : "?").join("")
    : undefined;
  const details = { bag, opponentPlayedTiles };
  if (solo || ownRack === undefined) return details;
  // With tiles in the bag the opponent would have a full rack, so a pool
  // no larger than a full rack can only be their rack.
  if (pool.excess.length || pool.total > template.rackSize) return details;
  const rack = pool.tiles
    .map(({ symbol, count }) => symbol.repeat(count))
    .join("");
  const playedSlots = rackSlotsForMove({ board, rack }, tiles);
  return playedSlots ? { ...details, rack, playedSlots } : details;
}

export function gameReplayTimeline(game: Game): { frames: ReplayFrame[]; scoreStart: number } {
  const source = replaySource(game);
  const turns = reviewTurns(source);
  if (!turns.length) return { frames: [], scoreStart: 0 };
  const { template } = source;
  const size = template.size ** 2;
  function savedPosition(position: TurnPosition | undefined) {
    return position?.board.length === size &&
      position.tiles.length > 0 &&
      new Set(position.tiles.map(({ index }) => index)).size ===
        position.tiles.length &&
      position.tiles.every(
        ({ index, letter }) =>
          Number.isInteger(index) &&
          index >= 0 &&
          index < size &&
          !position.board[index] &&
          !!letter,
      )
      ? position
      : undefined;
  }
  function boardTemplate(position: TurnPosition | undefined) {
    return position?.premiums?.length === size
      ? { ...template, premiums: position.premiums }
      : template;
  }
  const first = savedPosition(turns[0].position);
  const firstTemplate = boardTemplate(first);
  const firstRack = turns[0].move.player === "you" ? first?.rack : first?.observerRack;
  const solo = !!source.solo;
  const zero = { you: 0, opponent: 0 };
  const frames: ReplayFrame[] = [
    {
      board: first?.board,
      template: firstTemplate,
      rack: firstRack,
      bag: first && replayBag(
        unseenTiles({ board: first.board, rack: firstRack ?? "" }, firstTemplate),
        firstRack,
        firstTemplate,
        solo,
      ),
      scores: zero,
    },
  ];
  const scoreStart = Math.min(
    turns.length,
    currentScoreStart(
      source,
      turns.map(({ move }) => move),
    ),
  );
  let scores = zero;
  for (const turn of turns) {
    const { move, index } = turn;
    const position = savedPosition(turn.position);
    const frameTemplate = boardTemplate(position);
    if (index === scoreStart) scores = zero;
    scores = { ...scores, [move.player]: scores[move.player] + move.score };
    frames.push({
      board: position?.board,
      template: frameTemplate,
      move,
      position,
      ...(position && replayPlacement(move.player, position, frameTemplate, solo)),
      scores,
    });
  }
  return { frames, scoreStart };
}
