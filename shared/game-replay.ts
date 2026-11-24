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
  scores: Record<Player, number>;
};

function replaySource(game: Game) {
  return game.archivedState ? restoreArchivedGame(game) : game;
}

export function hasRecordedMoves(game: Game) {
  return trackedMoveHistory(replaySource(game)).length > 0;
}

function replayRack(
  player: Player,
  position: TurnPosition,
  template: BoardTemplate,
): Pick<ReplayFrame, "rack" | "playedSlots"> {
  const { board, tiles, observerRack } = position;
  if (player === "you") {
    const { rack } = position;
    if (rack === undefined) return {};
    return {
      rack,
      playedSlots: rackSlotsForMove({ ...position, rack }, tiles) ?? undefined,
    };
  }
  if (observerRack === undefined) return {};
  const pool = unseenTiles({ board, rack: observerRack }, template);
  // With tiles in the bag the opponent would have a full rack, so a pool
  // no larger than a full rack can only be their rack.
  if (pool.excess.length || pool.total > template.rackSize) return {};
  const rack = pool.tiles
    .map(({ symbol, count }) => symbol.repeat(count))
    .join("");
  const playedSlots = rackSlotsForMove({ board, rack }, tiles);
  return playedSlots ? { rack, playedSlots } : {};
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
  const zero = { you: 0, opponent: 0 };
  const frames: ReplayFrame[] = [
    {
      board: first?.board,
      template: boardTemplate(first),
      rack: turns[0].move.player === "you" ? first?.rack : first?.observerRack,
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
      ...(position && replayRack(move.player, position, frameTemplate)),
      scores,
    });
  }
  return { frames, scoreStart };
}
