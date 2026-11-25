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
import { endgameOpponentRack, unseenTiles } from "./tile-pool";

export type ReplayFrame = {
  board?: Board;
  template: BoardTemplate;
  move?: TrackedMove;
  position?: TurnPosition;
  rack?: string;
  playedSlots?: number[];
  opponentPlayedTiles?: string;
  unseen?: ReturnType<typeof unseenTiles>;
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

function exactOpponentRack(
  board: Board,
  tiles: TurnPosition["tiles"],
  template: BoardTemplate,
  pool: ReturnType<typeof unseenTiles>,
) {
  const rack = endgameOpponentRack(pool, template.rackSize);
  if (rack === undefined) return;
  const playedSlots = rackSlotsForMove({ board, rack }, tiles);
  if (playedSlots) return { rack, playedSlots };
}

function matchesBoardAfter(position: TurnPosition, after: Board) {
  const board = position.board.slice();
  for (const { index, letter } of position.tiles) board[index] = letter;
  return board.length === after.length && board.every((tile, index) => tile === after[index]);
}

function replayPlacement(
  player: Player,
  position: TurnPosition,
  template: BoardTemplate,
  solo: boolean,
  inferredObserverRack: string | undefined,
): Pick<ReplayFrame, "rack" | "playedSlots" | "opponentPlayedTiles" | "bag" | "unseen"> {
  const { board, tiles } = position;
  const ownRack = player === "you" ? position.rack : position.observerRack ?? inferredObserverRack;
  const pool = unseenTiles({ board, rack: ownRack ?? "" }, template);
  const bag = replayBag(pool, ownRack, template, solo);
  const unseen = ownRack === undefined ? undefined : pool;
  if (player === "you") {
    return {
      bag,
      unseen,
      rack: ownRack,
      playedSlots: ownRack === undefined
        ? undefined
        : rackSlotsForMove({ ...position, rack: ownRack }, tiles) ?? undefined,
    };
  }
  const opponentPlayedTiles = tiles.length <= template.rackSize
    ? tiles.map(({ letter }) => letter === letter.toUpperCase() ? letter : "?").join("")
    : undefined;
  const details = { bag, unseen, opponentPlayedTiles };
  if (solo || ownRack === undefined) return details;
  return { ...details, ...exactOpponentRack(board, tiles, template, pool) };
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
  const positions = turns.map(({ position }) => savedPosition(position));
  const solo = !!source.solo;
  const inferredRacks: (string | undefined)[] = [];
  if (!solo) {
    // Consecutive opponent plays leave our rack unchanged once the bag is
    // empty. A later saved rack is evidence only across matching boards.
    let laterBoard = source.board;
    let laterRack = !source.archived || game.archivedState ? source.rack : undefined;
    for (let i = turns.length - 1; i >= 0; i--) {
      const position = positions[i];
      const opponent = turns[i].move.player === "opponent";
      let own = opponent ? position?.observerRack : position?.rack;
      if (
        opponent &&
        position &&
        own === undefined &&
        laterRack &&
        rackLetters(laterRack) &&
        matchesBoardAfter(position, laterBoard)
      ) {
        const atTurn = boardTemplate(position);
        const pool = unseenTiles({ board: position.board, rack: laterRack }, atTurn);
        if (exactOpponentRack(position.board, position.tiles, atTurn, pool))
          inferredRacks[i] = own = laterRack;
      }
      laterBoard = position?.board ?? [];
      laterRack = own;
    }
  }
  const first = positions[0];
  const firstTemplate = boardTemplate(first);
  const firstRack = turns[0].move.player === "you"
    ? first?.rack
    : first?.observerRack ?? inferredRacks[0];
  const firstPool = first && unseenTiles(
    { board: first.board, rack: firstRack ?? "" },
    firstTemplate,
  );
  const zero = { you: 0, opponent: 0 };
  const frames: ReplayFrame[] = [
    {
      board: first?.board,
      template: firstTemplate,
      rack: firstRack,
      bag: firstPool && replayBag(firstPool, firstRack, firstTemplate, solo),
      unseen: firstRack === undefined ? undefined : firstPool,
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
    const position = positions[index];
    const frameTemplate = boardTemplate(position);
    if (index === scoreStart) scores = zero;
    scores = { ...scores, [move.player]: scores[move.player] + move.score };
    frames.push({
      board: position?.board,
      template: frameTemplate,
      move,
      position,
      ...(position && replayPlacement(move.player, position, frameTemplate, solo, inferredRacks[index])),
      scores,
    });
  }
  return { frames, scoreStart };
}
