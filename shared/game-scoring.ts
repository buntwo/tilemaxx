import {
  applyMove,
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
} from "./model";

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
): GameScoring | undefined {
  if (!tracksScores(game)) return game.scoring;
  const base = game.scoring?.pendingBase ?? game.board;
  if (board.some((tile, i) => tile !== base[i]))
    return { ...(game.scoring ?? emptyScoring()), pendingBase: base };
  return game.scoring ? { ...game.scoring, pendingBase: undefined } : undefined;
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

function scorePlacement(
  base: Board,
  board: Board,
  template: BoardTemplate,
): ScoredPlay | null {
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
  const across = placed.every((i) => row(i) === row(first));
  if (!across && !placed.every((i) => i % size === first % size)) return null;
  const step = across ? 1 : size;
  const along = (i: number, by: number) =>
    i + by >= 0 &&
    i + by < board.length &&
    (Math.abs(by) === size || row(i) === row(i + by));
  function wordAt(index: number, stride: number) {
    let start = index;
    while (along(start, -stride) && board[start - stride]) start -= stride;
    let word = "",
      sum = 0,
      multiplier = 1,
      newTiles = 0,
      touchesExisting = false;
    for (let i = start; ; i += stride) {
      word += board[i].toUpperCase();
      const points = tileScore(board[i], rules);
      if (base[i]) {
        sum += points;
        touchesExisting = true;
      } else {
        sum += points * (letterBonuses[premiums[i]] ?? 1);
        multiplier *= wordBonuses[premiums[i]] ?? 1;
        newTiles++;
      }
      if (!along(i, stride) || !board[i + stride]) break;
    }
    return { word, score: sum * multiplier, newTiles, touchesExisting };
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
  };
}

export function pendingOpponentPlay(game: Game): ScoredPlay | null {
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
  return {
    ...game,
    ...remember(game, play.word, play.score, "opponent", play.bingo),
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
    ...change,
    at: previous?.at ?? new Date().toISOString(),
  });

  // A screenshot import or clearing the board resets the score while retaining the log.
  const scoring = game.scoring ?? emptyScoring(isImportedPosition(game));
  const sessionStart = game.scoring
    ? Math.max(0, moves.length - scoring.you.moves - scoring.opponent.moves)
    : 0;
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
  const history = remember(
    game,
    insert ? "Added missed move" : "Corrected tracked move",
  );
  const past = [...history.past];
  past[past.length - 1] = { ...past[past.length - 1], trackedMoves: moves };
  return { ...game, ...history, past, trackedMoves: next, scoring: corrected };
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
