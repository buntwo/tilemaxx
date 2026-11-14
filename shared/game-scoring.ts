import {
  applyMove,
  coordinate,
  letterBonuses,
  remember,
  trackedMoveHistory,
  tileScore,
  wordBonuses,
  type Board,
  type BoardTemplate,
  type Game,
  type GameScoring,
  type Move,
  type Player,
  type TrackedMove,
  type TurnPosition,
} from "./model";
import { rackSlotsForMove } from "./rack-entry";

export function emptyScoring(imported = false): GameScoring {
  const score = { points: 0, moves: 0, best: 0, bingos: 0 };
  return { you: { ...score }, opponent: { ...score }, imported };
}

export function isImportedPosition(game: Game): boolean {
  return (
    game.scoring?.imported ??
    game.past.some((entry) => entry.label === "Imported screenshot")
  );
}

export function tracksScores(game: Game): boolean {
  return game.trackScores !== false && !isImportedPosition(game);
}

export function setScoreTracking(game: Game, enabled: boolean): Game {
  const scoring = game.scoring ?? emptyScoring(isImportedPosition(game));
  return {
    ...game,
    trackScores: enabled,
    scoring: {
      ...scoring,
      imported: enabled ? false : scoring.imported,
      pendingBase: undefined,
    },
  };
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
  const pendingBase = board.some(
    (tile, i) => tile.toUpperCase() !== correctedBase[i].toUpperCase(),
  )
    ? correctedBase
    : undefined;
  const scoring = corrections
    ? updateScoreTotals(game, corrections.history, corrections.moves)
    : game.scoring;
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
  const bingo = placed.length === template.rackSize;
  return {
    word: words[0].word,
    score: words.reduce(
      (sum, word) => sum + word.score,
      bingo ? template.bingo : 0,
    ),
    bingo,
    words,
    bonus: bingo ? template.bingo : 0,
  };
}

export function reviewTurns(game: Game) {
  const used = new Set<number>();
  return trackedMoveHistory(game).map((move, index) => {
    const snapshot = move.review;
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
    const before =
      move.player === "you" ? entry.board : entry.scoring?.pendingBase;
    if (!before) return { move, index };
    const after =
      move.player === "opponent"
        ? entry.board
        : (game.past[pastIndex + 1]?.board ?? game.board);
    const breakdown = scorePlacement(before, after, game.template);
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
      dictionaryId: game.dictionaryId,
      tiles: after.flatMap((letter, i) =>
        letter && !before[i] ? [{ index: i, letter }] : [],
      ),
    };
    return { move, index, position };
  });
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
    const oldPlay = scorePlacement(
      position.board,
      original,
      game.template,
      position.direction,
    );
    const play = scorePlacement(
      before,
      after,
      game.template,
      position.direction,
    );
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

export function boardWordsAt(game: Game, index: number) {
  const { board, template, past, scoring } = game;
  if (!board[index]) return [];
  const words = (["across", "down"] as const).flatMap((direction) => {
    const step = direction === "across" ? 1 : template.size;
    const cells = wordCells(board, template.size, index, step);
    if (cells.length < 2) return [];
    return [
      {
        direction,
        cells,
        word: cells.map((i) => board[i].toUpperCase()).join(""),
        score: cells.reduce(
          (sum, i) => sum + tileScore(board[i], template.rules),
          0,
        ),
        fromPlay: false,
      },
    ];
  });
  const unresolved = new Set(words);
  function useReview({
    board: base,
    tiles,
    direction,
  }: NonNullable<TrackedMove["review"]>) {
    if (
      ![...unresolved].some(({ cells }) =>
        tiles.some(({ index }) => cells.includes(index)),
      )
    )
      return;
    const played = [...base];
    for (const tile of tiles) played[tile.index] = tile.letter;
    fillScores(base, played, direction);
  }
  function fillScores(
    base: Board,
    after: Board,
    direction?: Move["direction"],
  ) {
    const play = scorePlacement(base, after, template, direction);
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
      unresolved.delete(word);
    }
  }
  if (unresolved.size && scoring?.pendingBase)
    fillScores(scoring.pendingBase, board);
  const moves = trackedMoveHistory(game);
  const firstEligible = replacementBoundaries(
    game,
    new Set(words.flatMap(({ cells }) => cells)),
    currentScoreStart(game, moves),
  );
  const recordedTurns = new Set<string>();
  for (let i = moves.length - 1; i >= currentScoreStart(game, moves); i--) {
    const { review, at, player } = moves[i];
    if (!review) continue;
    recordedTurns.add(
      `${player}:${at}:${review.tiles.map(({ index }) => index).join(",")}`,
    );
    for (const word of unresolved) {
      if (word.cells.some((cell) => i < (firstEligible.get(cell) ?? 0)))
        unresolved.delete(word);
    }
    if (unresolved.size) useReview(review);
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
      if (!recordedTurns.has(key)) useReview(entry.review);
    } else if (entry.score !== undefined) {
      fillScores(
        entry.player === "opponent"
          ? (entry.scoring?.pendingBase ?? entry.board)
          : entry.board,
        entry.player === "opponent" ? entry.board : after,
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
  return tracksScores(game) && base
    ? scorePlacement(base, game.board, game.template)
    : null;
}

function addScore(
  scoring: GameScoring,
  player: Player,
  play: ScoredPlay,
): GameScoring {
  const previous = scoring[player];
  return {
    ...scoring,
    pendingBase: undefined,
    [player]: {
      points: previous.points + play.score,
      moves: previous.moves + 1,
      best: Math.max(previous.best, play.score),
      bingos: previous.bingos + Number(play.bingo),
    },
  };
}

export function recordOpponentPlay(game: Game): Game {
  const play = pendingOpponentPlay(game);
  if (!play) return game;
  const base = game.scoring!.pendingBase!;
  return {
    ...game,
    ...remember(game, play.word, play.score, "opponent", play.bingo, {
      board: base.map((tile, index) => (tile ? game.board[index] : "")),
      dictionaryId: game.dictionaryId,
      tiles: game.board.flatMap((letter, index) =>
        letter && !base[index] ? [{ index, letter }] : [],
      ),
    }),
    scoring: addScore(game.scoring!, "opponent", play),
  };
}

export function playTrackedMove(game: Game, move: Move): Game {
  if (!tracksScores(game)) return applyMove(game, move);
  const previous = recordOpponentPlay(game);
  const pendingBase = previous.scoring?.pendingBase;
  if (
    pendingBase &&
    game.board.some((tile, index) => tile && !pendingBase[index])
  ) {
    throw new Error(
      "The new board tiles could not be scored as one opponent move. Fix the entry or choose Keep as correction under Game scores, then play your move.",
    );
  }
  const result = applyMove(previous, move, "you");
  return {
    ...result,
    scoring: addScore(previous.scoring ?? emptyScoring(), "you", {
      word: move.word,
      score: move.score,
      bingo: move.tiles.length === game.template.rackSize,
    }),
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

  const previous = insert ? undefined : moves[index];
  const next = [...moves];
  next.splice(index, insert ? 0 : 1, {
    ...previous,
    ...change,
    at: previous?.at ?? new Date().toISOString(),
  });

  // A screenshot import or clearing the board resets the score while retaining the log.
  const scoring = updateScoreTotals(game, moves, next, index);
  const history = remember(
    game,
    insert ? "Added missed move" : "Corrected tracked move",
  );
  const past = [...history.past];
  past[past.length - 1] = { ...past[past.length - 1], trackedMoves: moves };
  return { ...game, ...history, past, trackedMoves: next, scoring };
}

function currentScoreStart(game: Game, moves: readonly TrackedMove[]) {
  const { scoring } = game;
  return scoring
    ? Math.max(0, moves.length - scoring.you.moves - scoring.opponent.moves)
    : 0;
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
