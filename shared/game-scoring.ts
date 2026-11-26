import {
  applyMove,
  archiveGame,
  bingoPoints,
  BOARD_EDIT_LABELS,
  coordinate,
  isBingo,
  letterBonuses,
  localDate,
  remember,
  restoreArchivedGame,
  trackedMoveHistory,
  tileScore,
  undo,
  redo,
  wordBonuses,
  type Board,
  type BoardlessTurn,
  type BoardTemplate,
  type Game,
  type GameOutcome,
  type GameScoring,
  type HistoryEntry,
  type ManualGameEnd,
  type Move,
  type Player,
  type PlayerScore,
  type Premium,
  type TrackedMove,
  type TurnPosition,
} from "./model";
import { recordedMoveNotation } from "./notation";
import { rackLetters, rackSlotsForMove, reorderRack } from "./rack-entry";
import { endgameOpponentRack, unseenTiles } from "./tile-pool";
import { PRESETS } from "./presets";
import {
  boardEditLabels,
  historyPremiums,
  IMPORTED_SCREENSHOT,
  REBUILT_SCORES,
  recoverUntrackedMoves,
  retainsTiles,
  splitOpponentTurns,
  type PendingOpponentTurn,
  type PendingOpponentTurns,
} from "./score-recovery";

export function emptyScoring(imported = false): GameScoring {
  const score = { points: 0, moves: 0, best: 0, bingos: 0 };
  return { you: { ...score }, opponent: { ...score }, imported };
}

export function isImportedPosition(game: Game): boolean {
  return (
    game.scoring?.imported ??
    game.past.some((entry) => entry.label === IMPORTED_SCREENSHOT)
  );
}

export function tracksScores(game: Game): boolean {
  return game.trackScores !== false && !isImportedPosition(game);
}

export function nextPlayerToMove(game: Game): Player | undefined {
  const { scoring } = game;
  if (
    !scoring ||
    game.solo ||
    scoring.end ||
    game.archived ||
    !tracksScores(game) ||
    !(scoring.you.moves || scoring.opponent.moves)
  )
    return;
  const last = trackedMoveHistory(game).at(-1);
  if (last && (!scoring.incomplete || last.action))
    return last.player === "you" ? "opponent" : "you";
}

export function gameScoreTotals(scoring: GameScoring | undefined) {
  const end = scoring?.end;
  if (end && "manual" in end && end.scores) return end.scores;
  const rackAdjustment =
    end && "out" in end ? end.rackPoints * (end.out === "you" ? 1 : -1) : 0;
  return {
    you: (scoring?.you.points ?? 0) + rackAdjustment,
    opponent: (scoring?.opponent.points ?? 0) - rackAdjustment,
  };
}

export function displayedGameScoring(game: Game): GameScoring | undefined {
  const archivedScore = game.archived ? game.archivedState?.scoring : undefined;
  const end = archivedScore?.end;
  return end && ("out" in end || end.scores) ? archivedScore : game.scoring;
}

export type GameScoreSummary = {
  you: number;
  opponent: number;
  solo?: true;
  outcome: "playing" | "archived" | "finished" | GameOutcome;
};

export function summarizeGameScore(
  game: Game,
  scoring = displayedGameScoring(game),
): GameScoreSummary | null {
  const end = scoring?.end;
  const manual = end && "manual" in end ? end : undefined;
  if (
    manual?.scores === undefined &&
    (!tracksScores(game) || scoring?.incomplete || manual)
  )
    return null;
  const { you, opponent } = gameScoreTotals(scoring);
  const outcome =
    (game.solo && end ? "finished" : manual?.outcome) ??
    (!end
      ? game.archived
        ? "archived"
        : "playing"
      : you === opponent
        ? "tie"
        : you > opponent
          ? "win"
          : "loss");
  return { you, opponent, outcome, ...(game.solo && { solo: game.solo }) };
}

export function setScoreTracking(game: Game, enabled: boolean): Game {
  if (tracksScores(game) === enabled) return game;
  const history = remember(
    game,
    enabled ? REBUILT_SCORES : "Paused score tracking",
  );
  const moves = trackedMoveHistory(game);
  const last = history.past.length - 1;
  history.past[last] = {
    ...history.past[last],
    trackScores: game.trackScores !== false,
    trackedMoves: moves,
  };
  const scoring = game.scoring ?? emptyScoring(isImportedPosition(game));
  const toggled = { ...game, ...history, trackScores: enabled };
  if (!enabled)
    return { ...toggled, scoring: { ...scoring, pendingBase: undefined } };

  const rebuilt = rebuildScoreHistory(game, moves);
  const result = {
    ...toggled,
    trackedMoves: rebuilt.moves,
    scoring: {
      ...rebuilt.scoring,
      imported: false,
      pendingBase: undefined,
    },
  };
  return result.scoring.incomplete ? result : backfillGameResult(result);
}

export function trackBoardEdit(
  game: Game,
  board: Board,
): Pick<Game, "scoring" | "trackedMoves"> {
  if (!tracksScores(game)) return { scoring: game.scoring };
  const base = game.scoring?.pendingBase ?? game.board;
  const corrections = rescoreBoardCorrections(game, board, base);
  const correctedCells = corrections?.cells;
  const correctedBase = correctedCells?.size
    ? base.map((tile, i) => (correctedCells.has(i) ? board[i] : tile))
    : base;
  // A blank toggle on an existing square is a correction even for positions
  // with no saved move to rescore. New tiles still belong to the pending play.
  const pendingBase =
    !displayedGameScoring(game)?.end &&
    board.some(
      (tile, i) => tile.toUpperCase() !== correctedBase[i].toUpperCase(),
    )
      ? correctedBase
      : undefined;
  let scoring = corrections
    ? updateScoreTotals(game, corrections.history, corrections.moves)
    : game.scoring;
  const end = scoring?.end;
  if (scoring && end && "out" in end && !game.archived) {
    const adjusted = rackOutResult({ ...game, board }, end.out);
    // Keep the recorded adjustment if an intermediate edit leaves the
    // inventory inconsistent. Once it balances, use the corrected rack.
    if (adjusted && "out" in adjusted && adjusted.rackPoints !== end.rackPoints)
      scoring = { ...scoring, end: { ...end, rackPoints: adjusted.rackPoints } };
  }
  return {
    scoring:
      scoring || pendingBase
        ? { ...(scoring ?? emptyScoring()), pendingBase }
        : undefined,
    trackedMoves: corrections?.moves,
  };
}

export function treatBoardEditAsCorrection(game: Game): Game {
  if (!game.scoring?.pendingBase) return game;
  return {
    ...game,
    ...remember(game, "Confirmed board correction"),
    scoring: { ...game.scoring, pendingBase: undefined },
  };
}

type ScoredPlay = { word: string; score: number; bingo: boolean };

function wordCells(board: Board, size: number, index: number, step: number) {
  const along = (i: number, by: number) =>
    i + by >= 0 &&
    i + by < board.length &&
    (step === size || Math.floor(i / size) === Math.floor((i + by) / size));
  let start = index;
  while (along(start, -step) && board[start - step]) start -= step;
  const cells = [];
  for (let i = start; ; i += step) {
    cells.push(i);
    if (!along(i, step) || !board[i + step]) break;
  }
  return cells;
}

export function scorePlacement(
  base: Board,
  board: Board,
  template: BoardTemplate,
  direction?: Move["direction"],
) {
  const { size, premiums, rules } = template;
  const placed: number[] = [];
  for (const [index, tile] of board.entries()) {
    // Blank corrections can coexist with a play. Use the corrected tile value.
    if (base[index] && tile.toUpperCase() !== base[index].toUpperCase())
      return null;
    if (tile && !base[index]) placed.push(index);
  }
  if (!placed.length || placed.length > template.rackSize) return null;
  const row = (i: number) => Math.floor(i / size);
  const first = placed[0];
  const across = direction
    ? direction === "across"
    : placed.every((i) => row(i) === row(first));
  if (!across && !placed.every((i) => i % size === first % size)) return null;
  const step = across ? 1 : size;
  function wordAt(index: number, stride: number) {
    const cells = wordCells(board, size, index, stride);
    let word = "",
      sum = 0,
      multiplier = 1,
      newTiles = 0,
      touchesExisting = false;
    const tiles = [];
    for (const i of cells) {
      word += board[i].toUpperCase();
      const points = tileScore(board[i], rules);
      const premium = base[i] ? "" : premiums[i];
      const letterMultiplier = letterBonuses[premium] ?? 1;
      tiles.push({
        letter: board[i].toUpperCase(),
        square: coordinate(i, size),
        blank: board[i] === board[i].toLowerCase(),
        points,
        premium,
        letterMultiplier,
      });
      if (base[i]) {
        sum += points;
        touchesExisting = true;
      } else {
        sum += points * letterMultiplier;
        multiplier *= wordBonuses[premiums[i]] ?? 1;
        newTiles++;
      }
    }
    return {
      word,
      score: sum * multiplier,
      newTiles,
      touchesExisting,
      tiles,
      sum,
      multiplier,
      cells,
      direction: stride === 1 ? ("across" as const) : ("down" as const),
    };
  }
  const main = wordAt(first, step);
  if (main.newTiles !== placed.length) return null;
  const words = [
    main,
    ...placed.map((i) => wordAt(i, across ? size : 1)),
  ].filter(({ word }) => word.length >= 2);
  if (!words.length) return null;
  const connected = base.some(Boolean)
    ? words.some((word) => word.touchesExisting)
    : Boolean(board[template.start]);
  if (!connected) return null;
  const bonus = bingoPoints(template, placed.length);
  return {
    word: words[0].word,
    score: words.reduce((sum, word) => sum + word.score, bonus),
    bingo: isBingo(template, placed.length),
    words,
    bonus,
  };
}

export function reviewTurns(game: Game) {
  const used = new Set<number>();
  const historicalPremiums = historyPremiums(game);
  return trackedMoveHistory(game).map((move, index) => {
    // Analyze historical positions with the game’s selected word list without
    // rewriting the original snapshot or its recorded score.
    const snapshot = move.review
      ? { ...move.review, dictionaryId: game.dictionaryId }
      : undefined;
    if (move.action) return { move, index, position: snapshot };
    if (snapshot && (move.player === "opponent" || snapshot.excludedRackSlots))
      return { move, index, position: snapshot };
    const pastIndex = game.past.findIndex(
      (entry, i) =>
        !used.has(i) &&
        entry.at === move.at &&
        entry.player === move.player &&
        entry.label === move.word &&
        entry.score === move.score &&
        (!snapshot ||
          (entry.rack === snapshot.rack &&
            entry.board.every((tile, cell) => tile === snapshot.board[cell]))),
    );
    if (pastIndex < 0) return { move, index, position: snapshot };
    used.add(pastIndex);
    const entry = game.past[pastIndex];
    if (snapshot) {
      // Older snapshots can recover held slots from their original undo entry.
      const position = entry.excludedRackSlots
        ? { ...snapshot, excludedRackSlots: entry.excludedRackSlots }
        : snapshot;
      return { move, index, position };
    }
    // Older opponent score entries captured the board after typing the move.
    const pendingBase =
      move.player === "opponent" ? entry.scoring?.pendingBase : undefined;
    const before = pendingBase ?? entry.board;
    const after = pendingBase
      ? entry.board
      : (game.past[pastIndex + 1]?.board ?? game.board);
    const breakdown = scorePlacement(before, after, {
      ...game.template,
      premiums: historicalPremiums[pastIndex],
    });
    if (
      !breakdown ||
      breakdown.score !== move.score ||
      !breakdown.words.some((word) => word.word === move.word)
    )
      return { move, index };
    const position: TurnPosition = {
      board: before.map((tile, i) => (tile ? after[i] : "")),
      rack: move.player === "you" ? entry.rack : undefined,
      excludedRackSlots:
        move.player === "you" ? entry.excludedRackSlots : undefined,
      ...(move.player === "you" && entry.requiredRackSlots?.length && {
        requiredRackSlots: entry.requiredRackSlots,
      }),
      dictionaryId: game.dictionaryId,
      premiums: historicalPremiums[pastIndex],
      tiles: after.flatMap((letter, i) =>
        letter && !before[i] ? [{ index: i, letter }] : [],
      ),
    };
    return { move, index, position };
  });
}

export function scoreHistoryMoves(
  turns: readonly { move: TrackedMove; position?: TurnPosition; index: number }[],
  game: Game,
) {
  const { template } = game;
  const final = game.archived ? restoreArchivedGame(game) : game;
  const end = final.scoring?.end;
  const last = turns.at(-1);
  // A recorded rack-out establishes a complete short rack only for the play
  // that emptied it and produced the saved final board.
  const ownRackOut = end && "out" in end && end.out === "you" &&
    !rackLetters(final.rack) && last?.move.player === "you" &&
    last.position && emptiedRack(last.position) &&
    placementMatchesBoard(last.position, final.board);
  const totals = { you: 0, opponent: 0 };
  return turns.map(({ move, position, index }) => ({
    ...move,
    position,
    rackOut: !!ownRackOut && index === last?.index,
    notation: recordedMoveNotation(move, position, template.size),
    bingo: move.bingo ?? (!!position && isBingo(template, position.tiles.length)),
    number: index + 1,
    total: (totals[move.player] += move.score),
  }));
}

export function lastRecordedBoardPlay(game: Game) {
  const moves = trackedMoveHistory(game);
  const index = moves.length - 1;
  const move = moves[index];
  if (
    !move ||
    index < currentScoreStart(game, moves) ||
    (!move.action && !game.board.some(Boolean))
  )
    return;
  if (move.action) return { move, bingo: false };
  const position = move.review ?? reviewTurns(game)[index]?.position;
  if (!position) return { move, bingo: move.bingo };
  if (position.tiles.some(({ index, letter }) => game.board[index] !== letter))
    return;

  const after = [...position.board];
  for (const { index, letter } of position.tiles) after[index] = letter;
  const breakdown = scorePlacement(
    position.board,
    after,
    { ...game.template, premiums: position.premiums ?? game.template.premiums },
    position.direction,
  );
  // Either word can be the main word of a single-tile play.
  const main = breakdown?.words.find(
    ({ word }) => word === move.word.toUpperCase(),
  );
  return {
    move,
    bingo: move.bingo ?? breakdown?.bingo,
    main,
    breakdown: main && breakdown?.score === move.score ? breakdown : undefined,
  };
}

// Find the last time a previous edit broke the connection to a recorded tile.
function replacementBoundaries(game: Game, cells: Set<number>, start: number) {
  const firstEligible = new Map<number, number>();
  if (!game.scoring) return firstEligible;
  for (const [i, entry] of game.past.entries()) {
    if (entry.player || entry.trackedMoves || !entry.scoring) continue;
    const next = game.past[i + 1] ?? game;
    const before = entry.scoring.pendingBase ?? entry.board;
    const after = next.scoring?.pendingBase ?? next.board;
    const count = entry.scoring.you.moves + entry.scoring.opponent.moves;
    for (const cell of cells) {
      if (
        before[cell] &&
        before[cell].toUpperCase() !== after[cell].toUpperCase()
      ) {
        firstEligible.set(cell, start + count);
      }
    }
  }
  return firstEligible;
}

function rescoreBoardCorrections(game: Game, board: Board, base: Board) {
  const candidates = new Set(
    board.flatMap((letter, index) =>
      letter &&
      letter !== game.board[index] &&
      base[index] &&
      (!game.board[index] ||
        base[index].toUpperCase() === game.board[index].toUpperCase())
        ? [index]
        : [],
    ),
  );
  if (!candidates.size) return;

  const history = trackedMoveHistory(game);
  const start = currentScoreStart(game, history);
  if (start === history.length) return;
  const firstEligible = replacementBoundaries(game, candidates, start);
  const turns = reviewTurns(game);
  const cells = new Set<number>();
  let moves: TrackedMove[] | undefined;
  // Pending replacements from an earlier edit are not the same physical tile.
  // Walk backward through the saved positions so a correction stops at that
  // tile's placement, or at a position where the square held something else.
  for (let i = history.length - 1; i >= start && candidates.size; i--) {
    const { move, position } = turns[i];
    if (!position) continue;
    const original = [...position.board];
    for (const { index, letter } of position.tiles) original[index] = letter;
    const changes = new Set<number>();
    for (const index of candidates) {
      const previous = original[index];
      if (
        i < (firstEligible.get(index) ?? start) ||
        previous.toUpperCase() !== base[index].toUpperCase()
      ) {
        candidates.delete(index);
        continue;
      }
      if (previous !== board[index]) changes.add(index);
      if (!position.board[index]) candidates.delete(index);
    }
    if (!changes.size) continue;
    const before = position.board.map((letter, index) =>
      letter && changes.has(index) ? board[index] : letter,
    );
    const after = original.map((letter, index) =>
      changes.has(index) ? board[index] : letter,
    );
    if (move.action) {
      for (const index of changes) cells.add(index);
      moves ??= [...history];
      moves[i] = { ...move, review: { ...position, board: before } };
      continue;
    }
    const template = position.premiums
      ? { ...game.template, premiums: position.premiums }
      : game.template;
    const oldPlay = scorePlacement(
      position.board,
      original,
      template,
      position.direction,
    );
    const play = scorePlacement(before, after, template, position.direction);
    if (!oldPlay || !play) continue;
    const review: TurnPosition = {
      ...position,
      board: before,
      tiles: position.tiles.map((tile) =>
        changes.has(tile.index) ? { ...tile, letter: board[tile.index] } : tile,
      ),
    };
    if (
      position.rack &&
      position.tiles.some((tile) => changes.has(tile.index))
    ) {
      const rack = [...position.rack];
      const slots = rackSlotsForMove(
        { ...position, rack: position.rack },
        position.tiles,
      );
      if (slots) {
        for (const [i, { letter }] of review.tiles.entries()) {
          rack[slots[i]] = letter === letter.toUpperCase() ? letter : "?";
        }
        review.rack = rack.join("");
      } else if (
        !rackSlotsForMove({ ...review, rack: position.rack }, review.tiles)
      ) {
        delete review.rack;
        delete review.excludedRackSlots;
        delete review.requiredRackSlots;
      }
    }
    // One-tile plays can have either crossing word as their recorded name.
    const wordIndex = oldPlay.words.findIndex(({ word }) => word === move.word);
    const word = play.words[wordIndex]?.word ?? move.word;
    const scoredCells = new Set(play.words.flatMap(({ cells }) => cells));
    for (const index of changes) cells.add(index);
    moves ??= [...history];
    moves[i] = {
      ...move,
      word,
      score: [...changes].some((index) => scoredCells.has(index))
        ? play.score
        : move.score,
      bingo: move.bingo ?? play.bingo,
      review,
    };
  }
  if (moves) return { history, moves, cells };
}

type BoardWord = {
  direction: Move["direction"];
  cells: number[];
  word: string;
};

type BoardWordScore = BoardWord & {
  score: number;
  fromPlay: boolean;
  player?: Player;
  bingo?: boolean;
};

export function boardWordsThrough(board: Board, size: number, index: number) {
  if (!board[index]) return [];
  return (["across", "down"] as const).flatMap<BoardWord>(
    (direction) => {
      const step = direction === "across" ? 1 : size;
      const cells = wordCells(board, size, index, step);
      if (cells.length < 2) return [];
      return [
        {
          direction,
          cells,
          word: cells.map((i) => board[i].toUpperCase()).join(""),
        },
      ];
    },
  );
}

export function boardWordScoreSignature(board: Board) {
  return board.map((tile) => tile || ".").join("");
}

export function boardWordsAt(game: Game, index: number) {
  const { board, template, past, scoring } = game;
  const words: BoardWordScore[] = boardWordsThrough(board, template.size, index).map((word) => ({
    ...word,
    score: word.cells.reduce(
      (sum, i) => sum + tileScore(board[i], template.rules),
      0,
    ),
    fromPlay: false,
  }));
  const unresolved = new Set(words);
  const saved = game.savedBoardWordScores;
  if (saved && saved.board === boardWordScoreSignature(board)) {
    for (const word of words) {
      const score = saved.words.find(
        (item) => item.start === word.cells[0] && item.direction === word.direction,
      );
      if (!score) continue;
      word.score = score.score;
      word.fromPlay = score.fromPlay;
      if (score.player !== undefined) word.player = score.player;
      if (score.bingo !== undefined) word.bingo = score.bingo;
      unresolved.delete(word);
    }
    if (!unresolved.size) return words;
  }
  function useReview(
    { board: base, tiles, direction, premiums }: NonNullable<TrackedMove["review"]>,
    player: Player | undefined,
  ) {
    if (
      ![...unresolved].some(({ cells }) =>
        tiles.some(({ index }) => cells.includes(index)),
      )
    )
      return;
    const played = [...base];
    for (const tile of tiles) played[tile.index] = tile.letter;
    fillScores(base, played, player, direction, premiums);
  }
  function fillScores(
    base: Board,
    after: Board,
    player: Player | undefined,
    direction?: Move["direction"],
    premiums = template.premiums,
  ) {
    const play = scorePlacement(
      base,
      after,
      { ...template, premiums },
      direction,
    );
    if (!play) return;
    for (const word of unresolved) {
      const match = play.words.find(
        (scored) =>
          scored.direction === word.direction &&
          scored.cells[0] === word.cells[0] &&
          scored.cells.length === word.cells.length &&
          word.cells.every((i) => after[i] === board[i]),
      );
      if (!match) continue;
      word.score = match.score + (match === play.words[0] ? play.bonus : 0);
      word.fromPlay = true;
      if (player) word.player = player;
      if (match === play.words[0] && play.bingo) word.bingo = true;
      unresolved.delete(word);
    }
  }
  if (unresolved.size && scoring?.pendingBase) {
    for (const turn of pendingOpponentTurns(game).reverse()) {
      fillScores(turn.base, turn.board, "opponent");
    }
  }
  const moves = trackedMoveHistory(game);
  const firstEligible = replacementBoundaries(
    game,
    new Set(words.flatMap(({ cells }) => cells)),
    currentScoreStart(game, moves),
  );
  const recordedTurns = new Set<string>();
  for (let i = moves.length - 1; i >= currentScoreStart(game, moves); i--) {
    const { review, at, player, action } = moves[i];
    if (!review || action) continue;
    recordedTurns.add(
      `${player}:${at}:${review.tiles.map(({ index }) => index).join(",")}`,
    );
    for (const word of unresolved) {
      if (word.cells.some((cell) => i < (firstEligible.get(cell) ?? 0)))
        unresolved.delete(word);
    }
    if (unresolved.size) useReview(review, player);
  }
  for (let i = past.length - 1; i >= 0 && unresolved.size; i--) {
    const entry = past[i];
    if (
      entry.label === "Imported screenshot" ||
      entry.label === "Cleared board and rack"
    )
      return words;
    const after = past[i + 1]?.board ?? board;
    if (entry.review) {
      const key = `${entry.player}:${entry.at}:${entry.review.tiles.map(({ index }) => index).join(",")}`;
      if (!recordedTurns.has(key)) useReview(entry.review, entry.player);
    } else if (entry.score !== undefined) {
      fillScores(
        entry.player === "opponent"
          ? (entry.scoring?.pendingBase ?? entry.board)
          : entry.board,
        entry.player === "opponent" ? entry.board : after,
        entry.player,
      );
    }
    // A replacement or removal breaks the link to any older play.
    for (const word of unresolved) {
      const step = word.direction === "across" ? 1 : template.size;
      if (
        word.cells.some(
          (cell) =>
            entry.board[cell].toUpperCase() !== board[cell].toUpperCase(),
        ) ||
        wordCells(entry.board, template.size, index, step).length !==
          word.cells.length
      )
        unresolved.delete(word);
    }
  }
  return words;
}

export function pendingOpponentPlay(game: Game) {
  const base = game.scoring?.pendingBase;
  return !game.solo && tracksScores(game) && base
    ? scorePlacement(base, game.board, game.template)
    : null;
}

export function scoreTotalsAtPosition(game: Game) {
  const scoring = game.scoring;
  if (!scoring || !tracksScores(game) || scoring.incomplete) return;
  const pending = pendingOpponentTurns(game);
  if (scoring.pendingBase && !pending.length) return;
  return {
    you: scoring.you.points,
    opponent: pending.reduce(
      (points, turn) => points + turn.play.score,
      scoring.opponent.points,
    ),
  };
}

export function unplayedRackPoints(game: Game) {
  if (game.template.rules === "crossplay") return;
  const { total, excess, tiles } = unseenTiles(game, game.template);
  if (excess.length || total > (game.solo ? 0 : game.template.rackSize)) return;
  return {
    you: [...rackLetters(game.rack)].reduce(
      (points, tile) => points + tileScore(tile, game.template.rules),
      0,
    ),
    opponent: tiles.reduce((points, tile) => points + tile.count * tile.score, 0),
  };
}

function canRecordRackOut(game: Game) {
  return (
    tracksScores(game) &&
    !game.archived &&
    !game.scoring?.end &&
    (game.solo || game.template.rules !== "crossplay")
  );
}

function rackOutResult(game: Game, out: Player): GameScoring["end"] {
  const rack = rackLetters(game.rack);
  if (out === "you" ? rack : !rack) return;
  const { total, excess, tiles } = unseenTiles(game, game.template);
  if (excess.length) return;
  if (game.solo)
    return out === "you" && !total ? { out, rackPoints: 0 } : undefined;
  if (out === "you") {
    if (!total || total > game.template.rackSize) return;
    return {
      out,
      rackPoints: tiles.reduce(
        (points, tile) => points + tile.count * tile.score,
        0,
      ),
    };
  }
  if (total) return;
  return {
    out,
    rackPoints: [...rack].reduce(
      (total, tile) => total + tileScore(tile, game.template.rules),
      0,
    ),
  };
}

function finishTime() {
  const now = new Date();
  return { endedOn: localDate(now), endedAt: now.toISOString() };
}

function opponentRackOut(game: Game) {
  if (game.scoring?.pendingBase && canRecordRackOut(game)) {
    const end = rackOutResult(game, "opponent");
    if (end) return { ...end, ...finishTime() };
  }
}

export function recordOpponentRackOut(game: Game) {
  const end = opponentRackOut(game);
  if (end) return recordOpponentPlay(game, end);
  // The rack can be refilled after searching. If it now accounts for all
  // remaining tiles, the opponent's already recorded move ended the game.
  if (canRecordRackOut(game) && lastSearchRecordedOpponentTurn(game)) {
    const result = rackOutResult(game, "opponent");
    if (result)
      return {
        ...game,
        scoring: { ...game.scoring!, end: { ...result, ...finishTime() } },
      };
  }
  return game;
}

function opponentEntryStart(game: Game, base: Board): number | undefined {
  for (let i = game.past.length - 1; i >= 0; i--) {
    const entry = game.past[i];
    // Preserve separate history for score corrections and unrelated edits.
    if (
      !boardEditLabels.has(entry.label) ||
      entry.player ||
      entry.premiums ||
      entry.trackedMoves
    )
      return;
    const pending = entry.scoring?.pendingBase;
    if (!pending) {
      if (base.every((tile, index) => tile === entry.board[index])) return i;
      return;
    }
    if (
      !base.every(
        (tile, index) =>
          tile === pending[index] && (!tile || tile === entry.board[index]),
      )
    )
      return;
  }
}

export function pendingOpponentTurns(game: Game): PendingOpponentTurns {
  const base = game.scoring?.pendingBase;
  if (game.solo || !base || !tracksScores(game)) return [];
  const { board, template, past } = game;
  const play = pendingOpponentPlay(game);
  if (play) return [{ base, board, play }];

  // A pass or exchange can leave two typed opponent plays pending. Only split
  // at a saved entry boundary, with additive edits and a unique order of play.
  const start = opponentEntryStart(game, base);
  if (start === undefined) return [];
  return splitOpponentTurns(scorePlacement, base, board, template, past, start);
}

export function addMoveToPlayerScore(
  previous: PlayerScore,
  score: number,
  bingo: boolean,
): PlayerScore {
  return {
    points: previous.points + score,
    moves: previous.moves + 1,
    best: Math.max(previous.best, score),
    bingos: previous.bingos + Number(bingo),
  };
}

function addScore(
  scoring: GameScoring,
  player: Player,
  play: ScoredPlay,
): GameScoring {
  return {
    ...scoring,
    pendingBase: undefined,
    [player]: addMoveToPlayerScore(scoring[player], play.score, play.bingo),
  };
}

/** A pending, scoreable opponent placement precedes the next turn action. */
export function boardActionPlayer(game: Game): Player | undefined {
  if (game.solo || pendingOpponentTurns(game).length) return "you";
  return nextPlayerToMove(game);
}

export function recordBoardlessTurn(
  game: Game,
  player: Player,
  action: BoardlessTurn,
): Game {
  if (!tracksScores(game) || game.archived || game.scoring?.end)
    throw new Error("Turn recording is available in an active game with score tracking on.");
  const expected = boardActionPlayer(game);
  if (expected && player !== expected)
    throw new Error("The active player changed.");
  const previous = recordOpponentPlay(game);
  if (previous.scoring?.end) return previous;
  if (previous.scoring?.pendingBase)
    throw new Error("Finish the board entry or keep it as a correction under Game scores before recording this turn.");

  const own = player === "you";
  let next: Game = previous;
  if (action.kind === "exchange") {
    if (own && "slots" in action) {
      const selected = new Set(action.slots);
      if (
        !selected.size || selected.size !== action.slots.length ||
        action.slots.some((slot) =>
          !Number.isInteger(slot) || !previous.rack[slot] || previous.rack[slot] === ".",
        )
      )
        throw new Error("Select occupied rack tiles to exchange.");
      const kept = [...previous.rack].flatMap((letter, slot) =>
        letter !== "." && !selected.has(slot) ? [slot] : [],
      );
      const rack = reorderRack(previous, kept);
      next = {
        ...previous,
        rack: rack.rack,
        excludedRackSlots: rack.excludedRackSlots.length ? rack.excludedRackSlots : undefined,
        requiredRackSlots: rack.requiredRackSlots.length ? rack.requiredRackSlots : undefined,
      };
    } else if (
      own || "slots" in action ||
      (action.count !== undefined &&
        (!Number.isInteger(action.count) || action.count < 1 || action.count > game.template.rackSize))
    ) {
      throw new Error("Enter a valid exchange tile count.");
    }
  }
  const word = action.kind === "pass" ? "PASS" : "EXCHANGE";
  return {
    ...next,
    ...remember(previous, word, 0, player, false, {
      board: previous.board,
      ...(own
        ? {
            rack: previous.rack,
            excludedRackSlots: previous.excludedRackSlots,
            requiredRackSlots: previous.requiredRackSlots,
          }
        : { observerRack: previous.rack }),
      dictionaryId: previous.dictionaryId,
      premiums: previous.template.premiums,
      tiles: [],
    }, action),
    scoring: addScore(previous.scoring ?? emptyScoring(), player, { word, score: 0, bingo: false }),
  };
}

export function recordOpponentPlay(
  game: Game,
  end: GameScoring["end"] | null = opponentRackOut(game),
): Game {
  const [first, second] = pendingOpponentTurns(game);
  if (!first) return game;
  if (!second) return recordOpponentTurn(game, first, end);

  const boundary = game.past[second.split];
  const recorded = recordOpponentTurn(
    {
      ...game,
      board: first.board,
      rack: boundary.rack,
      excludedRackSlots: boundary.excludedRackSlots,
      requiredRackSlots: boundary.requiredRackSlots,
      past: game.past.slice(0, second.split),
    },
    first,
  );
  return recordOpponentTurn(
    {
      ...game,
      // The second turn's undo snapshot includes the first turn's new score.
      past: [...recorded.past, { ...boundary, scoring: recorded.scoring }],
      trackedMoves: recorded.trackedMoves,
      scoring: recorded.scoring,
    },
    second,
    end,
  );
}

export function recordOpponentPlayForSearch(game: Game): Game {
  // A search from an undone position must leave Redo available.
  if (game.archived || game.scoring?.end || game.future.length) return game;
  const recorded = recordOpponentPlay(game);
  if (recorded === game || recorded.scoring?.end) return recorded;
  const past = [...recorded.past];
  past[past.length - 1] = { ...past.at(-1)!, recordedOnSearch: true };
  return { ...recorded, past };
}

export function lastSearchRecordedOpponentTurn(game: Game) {
  if (
    !game.scoring ||
    game.scoring.pendingBase ||
    game.scoring.end ||
    game.archived ||
    !tracksScores(game)
  )
    return;
  let index = game.past.length - 1;
  // A correction keeps the recorded turn and adds its own undo step.
  while (index >= 0) {
    const entry = game.past[index];
    if (!boardEditLabels.has(entry.label)) break;
    index--;
  }
  const entry = game.past[index];
  if (!entry?.recordedOnSearch || entry.player !== "opponent" || !entry.review)
    return;
  const moves = trackedMoveHistory(game);
  const last = moves.at(-1);
  if (last?.player !== "opponent" || last.at !== entry.at) return;
  const review = last.review ?? entry.review;
  const after = [...review.board];
  for (const { index, letter } of review.tiles) after[index] = letter;
  if (game.board.every((tile, i) => tile === after[i]))
    return { entry, review, moves, corrected: index !== game.past.length - 1 };
}

export function reopenSearchRecordedOpponentPlay(
  game: Game,
  board?: Board,
): Game {
  const last = lastSearchRecordedOpponentTurn(game);
  if (
    !last ||
    (board && !last.review.tiles.some(({ index }) => !board[index]))
  )
    return game;
  if (board || last.corrected) {
    // Keep the recorded turn as an undo checkpoint. An erase can be followed
    // by a replacement, in which case its original review and time are reused.
    const trackedMoves = last.moves.slice(0, -1);
    const history = remember(
      game,
      board ? BOARD_EDIT_LABELS.erase : BOARD_EDIT_LABELS.enter,
    );
    history.past[history.past.length - 1].trackedMoves = last.moves;
    return {
      ...game,
      ...history,
      trackedMoves,
      scoring: {
        ...updateScoreTotals(game, last.moves, trackedMoves),
        pendingBase: last.review.board,
      },
    };
  }
  const previous = undo(game);
  let past = previous.past;
  // A folded entry is the undo boundary for the letters too. Restore that
  // boundary as a regular board edit so the revised turn can fold into it again.
  if (!previous.scoring?.pendingBase) {
    const { board, rack, excludedRackSlots, requiredRackSlots, scoring, at } =
      last.entry;
    past = [
      ...past,
      {
        board,
        rack,
        excludedRackSlots,
        requiredRackSlots,
        scoring,
        at,
        label: BOARD_EDIT_LABELS.enter,
      },
    ];
  }
  return {
    ...game,
    past,
    future: [],
    trackedMoves: previous.trackedMoves,
    scoring: {
      ...(previous.scoring ?? emptyScoring()),
      pendingBase: last.review.board,
    },
  };
}

export function trackReenteredTiles(
  game: Game,
  board: Board,
): Pick<Game, "scoring" | "trackedMoves"> | undefined {
  if (!tracksScores(game) || !board.some((tile, i) => tile && !game.board[i]))
    return;
  const finished = Boolean(displayedGameScoring(game)?.end);
  let original = game;
  while (original.past.length) {
    const entry = original.past.at(-1)!;
    if (!boardEditLabels.has(entry.label) || entry.player) return;
    // Walk back with the board, scores, and move log from the same checkpoint.
    original = undo(original);
    if (entry.label !== BOARD_EDIT_LABELS.erase) {
      if (entry.trackedMoves && !finished) return;
      continue;
    }

    // A reopened opponent turn saves its original log in the erase step.
    // Finished games also need the pre-erase board because they have no pending base.
    if (!entry.trackedMoves && !finished) continue;
    if (!entry.scoring || entry.scoring.pendingBase) return;
    if (!board.every((tile, i) => Boolean(tile) === Boolean(entry.board[i]))) {
      // A finished position may have been erased in several separate edits.
      if (finished) continue;
      return;
    }
    if (!finished && !lastSearchRecordedOpponentTurn(original)) return;
    const corrected = trackBoardEdit(original, board);
    if (corrected.scoring?.pendingBase) return;
    return {
      scoring: corrected.scoring,
      trackedMoves: corrected.trackedMoves ?? original.trackedMoves,
    };
  }
}

function recordOpponentTurn(
  game: Game,
  { base, play }: PendingOpponentTurn,
  end?: GameScoring["end"] | null,
): Game {
  const start = opponentEntryStart(game, base);
  const physicalRack = (rack: string) => [...rackLetters(rack)].sort().join("");
  const rack = physicalRack(game.rack);
  const boardBefore = base.map((tile, index) => (tile ? game.board[index] : ""));
  const tiles = game.board.flatMap((letter, index) =>
    letter && !base[index] ? [{ index, letter }] : [],
  );
  const { template } = game;
  const endgameRack = rack && rack.length < template.rackSize
    ? endgameOpponentRack(unseenTiles({ board: boardBefore, rack }, template), template.rackSize)
    : undefined;
  // A stable rack is usable if it is full or accounts for the endgame tile pool.
  // Verified opponent rack-outs also establish the rack after a delayed refill.
  const observerRack =
    (end && "out" in end && end.out === "opponent") ||
    ((rack.length === template.rackSize ||
      (endgameRack !== undefined && rackSlotsForMove({ board: boardBefore, rack: endgameRack }, tiles))) &&
      start !== undefined &&
      game.past
        .slice(start)
        .every((entry) => physicalRack(entry.rack) === rack))
      ? rack
      : undefined;
  const history = remember(
    game,
    play.word,
    play.score,
    "opponent",
    play.bingo,
    {
      board: boardBefore,
      ...(observerRack !== undefined && { observerRack }),
      dictionaryId: game.dictionaryId,
      premiums: template.premiums,
      tiles,
    },
  );
  if (start !== undefined) {
    const { label, player, score, bingo, review, at } = history.past.at(-1)!;
    history.past = [
      ...game.past.slice(0, start),
      { ...game.past[start], label, player, score, bingo, review, at },
    ];
  }
  return {
    ...game,
    ...history,
    scoring: {
      ...addScore(game.scoring!, "opponent", play),
      ...(end && { end }),
    },
  };
}

export function endGameManually(game: Game, result: ManualGameEnd): Game {
  if (game.archived || game.scoring?.end) return game;
  const recorded = recordOpponentPlay(game, null);
  return {
    ...recorded,
    ...remember(recorded, "Ended game"),
    scoring: {
      ...(recorded.scoring ?? emptyScoring(isImportedPosition(recorded))),
      pendingBase: undefined,
      end: { ...result, ...finishTime() },
    },
  };
}

export function playTrackedMove(
  game: Game,
  move: Move,
  bagSize?: number,
  useRackMarks = true,
): Game {
  if (displayedGameScoring(game)?.end) {
    if (game.archived) return applyMove(game, move, undefined, useRackMarks);
    throw new Error("This game has ended. Use Undo to continue.");
  }
  if (!tracksScores(game)) return applyMove(game, move, undefined, useRackMarks);
  const previous = recordOpponentPlay(game);
  if (!game.archived && previous.scoring?.end)
    throw new Error("This game has ended. Use Undo to continue.");
  const pendingBase = previous.scoring?.pendingBase;
  if (
    pendingBase &&
    game.board.some((tile, index) => tile && !pendingBase[index])
  ) {
    throw new Error(
      game.solo
        ? "Confirm the board edits under Game scores, or undo them and use Enter your play to score the move."
        : "Tilemaxx couldn't tell how to score the new board tiles. If you entered multiple opponent moves, undo to the first play and use Record opponent move under Game scores before entering the next. For other board edits, fix the entry or choose Keep as correction.",
    );
  }
  const result = applyMove(previous, move, "you", useRackMarks);
  const scoring = addScore(previous.scoring ?? emptyScoring(), "you", {
    word: move.word,
    score: move.score,
    bingo: isBingo(game.template, move.tiles.length),
  });
  if (canRecordRackOut(previous) && !rackLetters(result.rack) && !bagSize) {
    // In a solo game the unseen pool must also be empty.
    const end = rackOutResult(result, "you");
    if (end) scoring.end = { ...end, ...finishTime() };
  }
  return {
    ...result,
    scoring,
  };
}

function recoverFinishedPosition(game: Game): Game {
  const scoring = game.scoring;
  if (
    !scoring ||
    scoring.end ||
    scoring.incomplete ||
    !tracksScores(game) ||
    (!game.solo && game.template.rules === "crossplay")
  )
    return game;
  if (scoring.pendingBase) {
    if (game.solo || game.future.length) return game;
    const active = game.archived ? { ...game, archived: false } : game;
    const end = rackOutResult(active, "opponent");
    if (!end) return game;
    // A migration can recover the result without knowing when it happened.
    const finished = recordOpponentPlay(active, end);
    return finished === active
      ? game
      : { ...finished, archived: game.archived };
  }
  const last = trackedMoveHistory(game).at(-1);
  if (!last || !scoring[last.player].moves) return game;
  const end = rackOutResult(game, last.player);
  if (!end) return game;
  const position = last.review ?? reviewTurns(game).at(-1)?.position;
  if (!position?.tiles.length) return game;
  if (!placementMatchesBoard(position, game.board)) return game;
  if (last.player === "you" && !emptiedRack(position)) return game;
  return { ...game, scoring: { ...scoring, end } };
}

function placementMatchesBoard(position: TurnPosition, board: Board) {
  const after = [...position.board];
  for (const { index, letter } of position.tiles) after[index] = letter;
  return board.length === after.length && board.every((tile, index) => tile === after[index]);
}

function emptiedRack({ rack, tiles, ...position }: TurnPosition) {
  return !!rack && tiles.length > 0 && rackLetters(rack).length === tiles.length &&
    !!rackSlotsForMove({ ...position, rack }, tiles);
}

export function backfillGameResult(game: Game): Game {
  if (!game.archived || !game.archivedBoard)
    return recoverFinishedPosition(game);
  const savedBoard = game.archivedBoard;
  const currentMatches =
    game.board.every((tile, index) => tile === savedBoard[index]) &&
    (!game.archivedState || game.rack === game.archivedState.rack);
  const current = currentMatches ? recoverFinishedPosition(game) : game;
  if (!game.archivedState) return current;
  const baseline = restoreArchivedGame(game);
  const finished = recoverFinishedPosition(baseline);
  return finished === baseline
    ? current
    : { ...current, archivedState: archiveGame(finished).archivedState };
}

export function correctSuperLexulousCenter(game: Game): Game {
  if (game.template.id !== "super-lexulous") return game;
  const preset = PRESETS.find(({ id }) => id === game.template.id)!;
  const { start } = preset;
  if (game.template.size !== preset.size || game.template.start !== start)
    return game;

  // Match the old built-in layout exactly so custom premiums stay intact.
  function oldLayout(premiums?: Premium[]): boolean {
    return (
      premiums?.[start] === "" &&
      premiums.length === preset.premiums.length &&
      premiums.every(
        (square, i) => i === start || square === preset.premiums[i],
      )
    );
  }
  function correctedPremiums(premiums: Premium[] | undefined) {
    return oldLayout(premiums) ? preset.premiums : premiums;
  }
  function oldReview(move: Pick<TrackedMove, "review">) {
    return oldLayout(move.review?.premiums);
  }
  function oldStep(entry: HistoryEntry) {
    return (
      oldLayout(entry.premiums) ||
      oldReview(entry) ||
      entry.trackedMoves?.some(oldReview)
    );
  }
  function correctedPlay(
    word: string,
    score: number | undefined,
    review: TurnPosition | undefined,
  ) {
    if (!review?.premiums || !oldLayout(review.premiums))
      return { score, review };
    if (
      review.tiles.some(({ index }) => index === start) &&
      !review.board[start]
    ) {
      const after = [...review.board];
      for (const { index, letter } of review.tiles) after[index] = letter;
      const beforeFix = scorePlacement(
        review.board,
        after,
        { ...game.template, premiums: review.premiums },
        review.direction,
      );
      if (
        beforeFix?.score === score &&
        beforeFix?.words.some((entry) => entry.word === word)
      ) {
        score =
          scorePlacement(
            review.board,
            after,
            { ...game.template, premiums: preset.premiums },
            review.direction,
          )?.score ?? score;
      }
    }
    return { score, review: { ...review, premiums: preset.premiums } };
  }
  function correctedPosition(position: Game) {
    const premiums = correctedPremiums(position.template.premiums);
    const saved = trackedMoveHistory(position);
    const moves = saved.map((move) => {
      const corrected = correctedPlay(move.word, move.score, move.review);
      return corrected.review === move.review
        ? move
        : { ...move, ...corrected, score: corrected.score ?? move.score };
    });
    const start = currentScoreStart(position, saved);
    const scoring =
      position.scoring &&
      moves.some(
        (move, index) => index >= start && move.score !== saved[index].score,
      )
        ? updateScoreTotals(position, saved, moves)
        : position.scoring;
    return {
      ...position,
      template:
        premiums && premiums !== position.template.premiums
          ? { ...position.template, premiums }
          : position.template,
      scoring,
      trackedMoves: position.trackedMoves && moves,
    };
  }
  function correctedStep(entry: HistoryEntry, position: Game): HistoryEntry {
    const after = correctedPosition(position);
    return {
      ...entry,
      ...correctedPlay(entry.label, entry.score, entry.review),
      premiums: correctedPremiums(entry.premiums),
      scoring: after.scoring,
      trackedMoves: entry.trackedMoves && after.trackedMoves,
    };
  }
  function correctedTimeline(position: Game): Game {
    if (
      !oldLayout(position.template.premiums) &&
      !position.trackedMoves?.some(oldReview) &&
      !position.past.some(oldStep) &&
      !position.future.some(oldStep)
    )
      return position;

    // Each undo entry stores the position before its move, and each redo entry
    // stores the position after it. Reuse the game model to recover those logs.
    const past = [...position.past];
    const future = [...position.future];
    let cursor = position;
    for (let i = past.length - 1; i >= 0; i--) {
      cursor = undo(cursor);
      past[i] = correctedStep(past[i], cursor);
    }
    cursor = position;
    for (let i = future.length - 1; i >= 0; i--) {
      cursor = redo(cursor);
      future[i] = correctedStep(future[i], cursor);
    }
    return { ...correctedPosition(position), past, future };
  }

  const current = correctedTimeline(game);
  const originalPremiums = correctedPremiums(game.originalPremiums);
  const archived = game.archivedState ? restoreArchivedGame(game) : game;
  const correctedArchive =
    game.archivedState && archived !== game
      ? correctedTimeline(archived)
      : archived;
  if (
    current === game &&
    originalPremiums === game.originalPremiums &&
    correctedArchive === archived
  )
    return game;
  return {
    ...current,
    originalPremiums,
    archivedState:
      correctedArchive !== archived
        ? archiveGame(correctedArchive).archivedState
        : current.archivedState,
  };
}

export function correctTrackedMove(
  game: Game,
  index: number,
  change: Omit<TrackedMove, "at">,
  insert: boolean,
): Game {
  const moves = trackedMoveHistory(game);
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= moves.length + Number(insert)
  )
    throw new Error("That move position is no longer available.");
  if (
    !/^[A-Z]{2,25}$/.test(change.word) ||
    !Number.isSafeInteger(change.score) ||
    change.score < 0
  )
    throw new Error("Enter a word and a whole, nonnegative score.");

  if (game.solo && change.player !== "you")
    throw new Error("Solo move history only records your plays.");

  const previous = insert ? undefined : moves[index];
  if (previous?.action || change.action)
    throw new Error("Use Undo to change a recorded pass or exchange.");
  const next = [...moves];
  next.splice(index, insert ? 0 : 1, {
    ...previous,
    ...change,
    at: previous?.at ?? new Date().toISOString(),
  });

  // A screenshot import or clearing the board resets the score while retaining the log.
  const scoring = updateScoreTotals(game, moves, next, index);
  if (
    insert &&
    scoring.historyStart !== undefined &&
    index < scoring.historyStart
  )
    scoring.historyStart++;
  const history = remember(
    game,
    insert ? "Added missed move" : "Corrected tracked move",
  );
  const past = [...history.past];
  past[past.length - 1] = { ...past[past.length - 1], trackedMoves: moves };
  return { ...game, ...history, past, trackedMoves: next, scoring };
}

export function currentScoreStart(game: Game, moves: readonly TrackedMove[]) {
  const { scoring } = game;
  if (scoring?.historyStart !== undefined && !scoring.imported)
    return scoring.historyStart;
  return scoring
    ? Math.max(0, moves.length - scoring.you.moves - scoring.opponent.moves)
    : 0;
}

export function resetGameScoring(
  game: Game,
  importedBoard?: Board,
): GameScoring {
  const moves = trackedMoveHistory(game);
  const retainsBoard = importedBoard && retainsTiles(game.board, importedBoard);
  return {
    ...emptyScoring(!!importedBoard),
    historyStart: retainsBoard
      ? (game.scoring?.historyStart ?? currentScoreStart(game, moves))
      : moves.length,
    incomplete:
      importedBoard &&
      ((retainsBoard && game.scoring?.incomplete) ||
        importedBoard.some(
          (tile, i) => !!tile && (!retainsBoard || !game.board[i]),
        )),
  };
}

function rebuildScoreHistory(game: Game, saved: TrackedMove[]) {
  const counted = currentScoreStart(game, saved);
  const { moves, incomplete, start } = recoverUntrackedMoves(
    scorePlacement,
    game,
    saved,
    counted,
  );
  const scoring = {
    ...(game.scoring ?? emptyScoring()),
    historyStart: start,
    incomplete: incomplete || undefined,
  };
  for (const player of ["you", "opponent"] as const) {
    const old = summarizeMoves(
      saved.slice(counted).filter((move) => move.player === player),
    );
    const next = summarizeMoves(
      moves.slice(start).filter((move) => move.player === player),
    );
    const previous = scoring[player];
    // Some old saves have totals for turns whose entries aged out of undo.
    scoring[player] =
      previous.moves > old.moves
        ? {
            points: previous.points - old.points + next.points,
            moves: previous.moves - old.moves + next.moves,
            best: Math.max(previous.best, next.best),
            bingos: previous.bingos - old.bingos + next.bingos,
          }
        : next;
  }
  return { moves, scoring };
}

function updateScoreTotals(
  game: Game,
  moves: readonly TrackedMove[],
  next: readonly TrackedMove[],
  index = moves.length,
) {
  const scoring = game.scoring ?? emptyScoring(isImportedPosition(game));
  const sessionStart = currentScoreStart(game, moves);
  const corrected = { ...scoring };
  if (index >= sessionStart) {
    for (const player of ["you", "opponent"] as const) {
      const oldMoves = moves
        .slice(sessionStart)
        .filter((move) => move.player === player);
      const newMoves = next
        .slice(sessionStart)
        .filter((move) => move.player === player);
      const stats = game.scoring ? scoring[player] : summarizeMoves(oldMoves);
      const oldStats = summarizeMoves(oldMoves);
      const newStats = summarizeMoves(newMoves);
      corrected[player] = {
        points: stats.points - oldStats.points + newStats.points,
        moves: stats.moves - oldStats.moves + newStats.moves,
        best: Math.max(
          stats.moves > oldStats.moves ? stats.best : 0,
          newStats.best,
        ),
        bingos: Math.max(
          newStats.bingos,
          stats.bingos - oldStats.bingos + newStats.bingos,
        ),
      };
      if (!Number.isSafeInteger(corrected[player].points))
        throw new Error("The running score is too large.");
    }
  }
  return corrected;
}

function summarizeMoves(moves: readonly TrackedMove[]) {
  const result = { points: 0, moves: moves.length, best: 0, bingos: 0 };
  for (const move of moves) {
    result.points += move.score;
    result.best = Math.max(result.best, move.score);
    result.bingos += Number(move.bingo === true);
  }
  return result;
}
