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
import { rackComposition, rackLetters, rackSlotsForLetters, rackSlotsForMove } from "./rack-entry";
import { endgameOpponentRack, unseenTiles } from "./tile-pool";

export type ReplayFrame = {
  board?: Board;
  template: BoardTemplate;
  move?: TrackedMove;
  position?: TurnPosition;
  rack?: string;
  playedSlots?: number[];
  draw?: { tiles: string; count?: number };
  opponentPlayedTiles?: string;
  unseen?: ReturnType<typeof unseenTiles>;
  unseenRackUnknown?: boolean;
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
): NonNullable<ReplayFrame["bag"]> {
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

function boardAfter(position: TurnPosition) {
  const board = position.board.slice();
  for (const { index, letter } of position.tiles) board[index] = letter;
  return board;
}

function matchesBoardAfter(position: TurnPosition, after: Board) {
  const board = boardAfter(position);
  return board.length === after.length && board.every((tile, index) => tile === after[index]);
}

function replayDraw(
  { position, rack, playedSlots, template, bag }: ReplayFrame,
  next: Pick<ReplayFrame, "board" | "rack">,
): ReplayFrame["draw"] {
  if (!position || !rack || !playedSlots?.length || bag?.count === 0)
    return;

  // Use the positive two-player estimate to establish a full refill.
  // Solo replays can also establish how many tiles are left for a short draw.
  const played = playedSlots.length;
  const count = bag && !bag.invalid
    ? bag.count >= played ? played : !bag.estimated ? bag.count : undefined
    : undefined;
  const unknown = { tiles: "", count };
  if (next.rack === undefined || !next.board || !matchesBoardAfter(position, next.board))
    return unknown;
  const after = rackLetters(next.rack);
  const leave = [...rack].filter((tile, slot) => tile !== "." && !playedSlots.includes(slot));
  const kept = rackSlotsForLetters({ rack: after }, leave);
  if (!kept || after.length > template.rackSize || unseenTiles({ board: next.board, rack: after }, template).excess.length)
    return unknown;
  const tiles = rackComposition([...after].filter((_, slot) => !kept.includes(slot)).join(""));
  if (tiles.length > (count ?? played)) return unknown;
  if (!tiles && count === undefined) return;
  return { tiles, count: count ?? tiles.length };
}

function replayPlacement(
  player: Player,
  position: TurnPosition,
  template: BoardTemplate,
  solo: boolean,
  inferredObserverRack: string | undefined,
): Pick<ReplayFrame, "rack" | "playedSlots" | "opponentPlayedTiles" | "bag" | "unseen" | "unseenRackUnknown"> {
  const { board, tiles } = position;
  const ownRack = player === "you" ? position.rack : position.observerRack ?? inferredObserverRack;
  const pool = unseenTiles({ board, rack: ownRack ?? "" }, template);
  // The bag estimate is from before the play. The breakdown also checks the
  // visible placements, so an overdraw on this move is shown immediately.
  const unseenRackUnknown = ownRack === undefined;
  const unseen = player === "opponent" || unseenRackUnknown
    ? unseenTiles({ board: boardAfter(position), rack: ownRack ?? "" }, template)
    : pool;
  const bag = {
    ...replayBag(pool, ownRack, template, solo),
    invalid: unseen.excess.length > 0,
  };
  const details = { bag, unseen, unseenRackUnknown };
  if (player === "you") {
    return {
      ...details,
      rack: ownRack,
      playedSlots: ownRack === undefined
        ? undefined
        : rackSlotsForMove({ ...position, rack: ownRack }, tiles) ?? undefined,
    };
  }
  const opponentPlayedTiles = tiles.length <= template.rackSize
    ? tiles.map(({ letter }) => letter === letter.toUpperCase() ? letter : "?").join("")
    : undefined;
  const exact = solo || unseenRackUnknown
    ? undefined
    : exactOpponentRack(board, tiles, template, pool);
  return { ...details, opponentPlayedTiles, ...exact };
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
      unseen: firstPool,
      unseenRackUnknown: firstRack === undefined,
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
    const frame: ReplayFrame = {
      board: position?.board,
      template: frameTemplate,
      move,
      position,
      ...(position && replayPlacement(move.player, position, frameTemplate, solo, inferredRacks[index])),
      scores,
    };
    if (move.player === "you") {
      const next = positions[index + 1];
      if (index + 1 < turns.length) {
        frame.draw = replayDraw(frame, {
          board: next?.board,
          rack: turns[index + 1].move.player === "you" ? next?.rack : next?.observerRack,
        });
      } else if (!source.archived || game.archivedState) {
        frame.draw = replayDraw(frame, source);
      } else {
        frame.draw = replayDraw(frame, {});
      }
    }
    frames.push(frame);
  }
  return { frames, scoreStart };
}
