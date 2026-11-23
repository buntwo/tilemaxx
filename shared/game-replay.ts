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
import { rackLetters, rackSlotsForMove } from "./rack-entry";

export type ReplayFrame = {
  board?: Board;
  template: BoardTemplate;
  move?: TrackedMove;
  position?: TurnPosition;
  rack?: string;
  scores: Record<Player, number>;
};

function replaySource(game: Game) {
  return game.archivedState ? restoreArchivedGame(game) : game;
}

export function hasRecordedMoves(game: Game) {
  return trackedMoveHistory(replaySource(game)).length > 0;
}

function rackAfterPlay(move: TrackedMove, position: TurnPosition) {
  if (move.player === "opponent") return position.observerRack;
  if (position.rack === undefined) return;
  const slots = rackSlotsForMove(
    { ...position, rack: position.rack },
    position.tiles,
  );
  if (!slots) return;
  const remaining = [...position.rack];
  for (const slot of slots) remaining[slot] = ".";
  return rackLetters(remaining.join(""));
}

export function gameReplayFrames(game: Game): ReplayFrame[] {
  const source = replaySource(game);
  const turns = reviewTurns(source);
  if (!turns.length) return [];
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
  const scoreStart = currentScoreStart(
    source,
    turns.map(({ move }) => move),
  );
  let scores = zero;
  for (const turn of turns) {
    const { move, index } = turn;
    const position = savedPosition(turn.position);
    if (index === scoreStart) scores = zero;
    scores = { ...scores, [move.player]: scores[move.player] + move.score };
    frames.push({
      board: position?.board,
      template: boardTemplate(position),
      move,
      position,
      rack: position && rackAfterPlay(move, position),
      scores,
    });
  }
  return frames;
}
