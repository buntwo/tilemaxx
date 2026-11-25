import { currentScoreStart, reviewTurns, scorePlacement } from "./game-scoring";
import {
  emptyBoard,
  restoreArchivedGame,
  trackedMoveHistory,
  type Board,
  type BoardTemplate,
  type Game,
  type Player,
  type RecoveredReplayTurn,
  type ReplayDraw,
  type TrackedMove,
  type TurnPosition,
} from "./model";
import { rackComposition, rackLetters, rackSlotsForLetters, rackSlotsForMove, sortedRackSlots } from "./rack-entry";
import { endgameOpponentRack, unseenTiles } from "./tile-pool";

export type ReplayFrame = {
  board?: Board;
  template: BoardTemplate;
  move?: TrackedMove;
  position?: TurnPosition;
  rack?: string;
  playedSlots?: number[];
  afterRack?: string;
  draw?: ReplayDraw;
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

function recordedMoveKey({ player, word, score, at }: TrackedMove) {
  return JSON.stringify([player, word, score, at]);
}

function recoverPlacement(
  move: TrackedMove,
  before: Board,
  after: Board,
  template: BoardTemplate,
  dictionaryId: string,
): TurnPosition | undefined {
  if (before.length !== after.length ||
      before.some((tile, index) => tile !== "" && tile !== after[index]))
    return;
  const tiles = after.flatMap((letter, index) =>
    letter && !before[index] ? [{ index, letter }] : [],
  );
  if (!tiles.length || tiles.length > template.rackSize) return;
  const directions = new Set<NonNullable<TurnPosition["direction"]>>();
  for (const direction of ["across", "down"] as const) {
    if (direction === "across" && tiles.some(({ index }) =>
      Math.floor(index / template.size) !== Math.floor(tiles[0].index / template.size)))
      continue;
    const result = scorePlacement(before, after, template, direction);
    if (result?.word === move.word && result.score === move.score &&
        (move.bingo === undefined || result.bingo === move.bingo))
      directions.add(result.words[0].direction);
  }
  if (!directions.size) return;
  return {
    board: before,
    tiles,
    dictionaryId,
    premiums: template.premiums,
    direction: directions.size === 1 ? directions.values().next().value : undefined,
  };
}

function replayRefill(
  { position, rack, playedSlots, template, bag, unseen }: ReplayFrame,
  next: Pick<ReplayFrame, "board" | "rack">,
  saved?: RecoveredReplayTurn | null,
): Pick<ReplayFrame, "afterRack" | "draw"> {
  if (!position || rack === undefined || !playedSlots?.length) return {};
  const afterBoard = boardAfter(position);
  const matching = next.rack !== undefined && next.board && matchesBoardAfter(position, next.board)
    ? rackLetters(next.rack)
    : undefined;
  const leave = rackComposition([...rack].filter((_, slot) => !playedSlots.includes(slot)).join(""));
  if (bag?.count === 0) {
    return !bag.invalid && (unseen?.total === 0 || !bag.estimated || (matching !== undefined && rackComposition(matching) === leave))
      ? { afterRack: leave }
      : {};
  }

  const count = bag && !bag.invalid ? Math.min(playedSlots.length, bag.count) : undefined;
  const unknown = { draw: { tiles: "", count } };
  // Recheck saved refill evidence against the original placement and bag.
  const after = matching ?? saved?.afterRack ??
    (saved?.draw?.tiles ? leave + saved.draw.tiles : undefined);
  if (after === undefined) return unknown;
  const kept = rackSlotsForLetters({ rack: after }, leave);
  if (!kept || bag?.invalid || after.length > template.rackSize ||
      unseenTiles({ board: afterBoard, rack: after }, template).excess.length)
    return unknown;
  const tiles = rackComposition([...after].filter((_, slot) => !kept.includes(slot)).join(""));
  if (tiles.length > (count ?? playedSlots.length)) return unknown;
  if (!tiles && count === undefined) return {};
  return {
    draw: { tiles, count: count ?? tiles.length },
    ...(tiles.length === count && { afterRack: rackComposition(after) }),
  };
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

function recoverReplay(
  source: Game,
  useFinal: boolean,
  saved: readonly (RecoveredReplayTurn | null)[] = [],
): { frames: ReplayFrame[]; scoreStart: number; recovery: (RecoveredReplayTurn | null)[] } {
  const turns = reviewTurns(source);
  if (!turns.length) return { frames: [], scoreStart: 0, recovery: [] };
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
  const savedTurns = turns.map(({ move, index }) =>
    saved[index]?.move === recordedMoveKey(move) ? saved[index] : undefined,
  );
  const corrections = source.past.filter(({ label }) =>
    label === "Confirmed board correction" || label === "Imported screenshot",
  );
  const correctionAfter = turns.map(({ move, index }) => {
    const nextAt = turns[index + 1]?.move.at;
    return !!savedTurns[index]?.correctionAfter || corrections.some(({ at }) =>
      at > move.at && (nextAt === undefined || at < nextAt),
    );
  });
  const anchors = turns.map(({ position, index }) =>
    savedPosition(position) ?? savedPosition(savedTurns[index]?.position),
  );
  const positions = anchors.map((position, index) => {
    if (position || index === 0) return position;
    if (correctionAfter[index - 1] || correctionAfter[index]) return;
    const previous = anchors[index - 1];
    const next = anchors[index + 1];
    const after = next?.board ??
      (useFinal && index === anchors.length - 1 && !source.scoring?.pendingBase ? source.board : undefined);
    if (!previous || !after) return;
    const beforeTemplate = boardTemplate(previous);
    const afterTemplate = boardTemplate(next);
    if (beforeTemplate.premiums.some((premium, cell) => premium !== afterTemplate.premiums[cell]))
      return;
    return recoverPlacement(
      turns[index].move, boardAfter(previous), after, beforeTemplate, source.dictionaryId,
    );
  });
  const solo = !!source.solo;
  const ownRacks: (string | undefined)[] = [];
  let laterBoard = source.board;
  let laterRack = useFinal ? source.rack : undefined;
  for (let i = turns.length - 1; i >= 0; i--) {
    const position = positions[i];
    const opponent = turns[i].move.player === "opponent";
    let own = opponent ? position?.observerRack : position?.rack;
    if (!solo && opponent && position && own === undefined && !correctionAfter[i]) {
      // The opponent's endgame placements must fit the exact remaining pool.
      // Across matching boards, our rack could not refill during their turn.
      const candidate = (laterRack !== undefined && matchesBoardAfter(position, laterBoard)
        ? laterRack
        : savedTurns[i]?.observerRack);
      if (candidate && rackLetters(candidate) && candidate.length <= template.rackSize) {
        const atTurn = boardTemplate(position);
        const pool = unseenTiles({ board: position.board, rack: candidate }, atTurn);
        if (exactOpponentRack(position.board, position.tiles, atTurn, pool))
          own = candidate;
      }
    }
    ownRacks[i] = own;
    laterBoard = position?.board ?? [];
    laterRack = own;
  }
  const first = positions[0];
  const firstTemplate = boardTemplate(first);
  const firstRack = ownRacks[0];
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
  const recovery: (RecoveredReplayTurn | null)[] = [];
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
      ...(position && replayPlacement(move.player, position, frameTemplate, solo, ownRacks[index])),
      scores,
    };
    const savedTurn = savedTurns[index];
    if (move.player === "you") {
      const next = correctionAfter[index] ? {} :
        index + 1 < turns.length
          ? { board: positions[index + 1]?.board, rack: ownRacks[index + 1] }
          : useFinal ? source : {};
      Object.assign(frame, replayRefill(frame, next, correctionAfter[index] ? undefined : savedTurn));
    } else if (ownRacks[index] !== undefined) {
      frame.afterRack = rackComposition(ownRacks[index]!);
    }
    const recoveredPosition = position && !savedPosition(move.review) ? position : undefined;
    const observerRack = move.player === "opponent" && position?.observerRack === undefined
      ? ownRacks[index] : undefined;
    const draw = frame.draw?.tiles ? frame.draw : undefined;
    recovery.push(correctionAfter[index] || recoveredPosition || observerRack !== undefined || frame.afterRack !== undefined || draw
      ? {
          move: recordedMoveKey(move),
          correctionAfter: correctionAfter[index] ? true : undefined,
          position: recoveredPosition,
          observerRack,
          afterRack: frame.afterRack,
          draw,
        }
      : null);
    frames.push(frame);
  }
  return { frames, scoreStart, recovery };
}

export function captureArchiveReplay(game: Game) {
  const { recovery } = recoverReplay(game, true);
  if (recovery.some((turn) => turn !== null)) return recovery;
}

export function gameReplayTimeline(game: Game): { frames: ReplayFrame[]; scoreStart: number } {
  const source = replaySource(game);
  const snapshot = game.archivedBoard && game.archivedState;
  const { frames, scoreStart } = recoverReplay(
    source,
    !source.archived || !!snapshot,
    snapshot?.replayRecovery,
  );
  return { frames, scoreStart };
}

/** A disposable game at the beginning of the selected turn, from its player's perspective. */
export function replayGamePosition(
  source: Game,
  frame: ReplayFrame,
  scores: Record<Player, number>,
  index: number,
): Game {
  const rack = frame.rack ?? frame.opponentPlayedTiles ??
    (frame.move?.player === "you"
      ? frame.position?.tiles.map(({ letter }) => letter === letter.toUpperCase() ? letter : "?").join("")
      : undefined) ?? "";
  const opponent = frame.move?.player === "opponent";
  const slots = sortedRackSlots(rack);
  const used = new Set(frame.playedSlots ?? (frame.rack === undefined ? slots : []));
  const order = [...slots.filter((slot) => !used.has(slot)), ...slots.filter((slot) => used.has(slot))];
  const remap = (marks: number[] | undefined) =>
    marks?.map((slot) => order.indexOf(slot)).filter((slot) => slot >= 0);
  const score = (points: number) => ({ points, best: 0, moves: 0, bingos: 0 });
  return {
    ...source,
    id: `${source.id}:replay:${index}`,
    archived: false,
    archivedBoard: undefined,
    archivedState: undefined,
    savedBoardWordScores: undefined,
    originalPremiums: undefined,
    board: frame.board ?? emptyBoard(frame.template.size),
    template: frame.template,
    dictionaryId: frame.position?.dictionaryId ?? source.dictionaryId,
    rack: order.map((slot) => rack[slot]).join(""),
    excludedRackSlots: !opponent ? remap(frame.position?.excludedRackSlots) : undefined,
    requiredRackSlots: !opponent ? remap(frame.position?.requiredRackSlots) : undefined,
    past: [],
    future: [],
    trackedMoves: [],
    trackScores: true,
    scoring: {
      you: score(scores[opponent ? "opponent" : "you"]),
      opponent: score(scores[opponent ? "you" : "opponent"]),
    },
  };
}
