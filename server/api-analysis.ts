import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { parallelOpponentEndgame } from "../src/parallel-opponent-endgame";
import { createBingoHunterSession } from "../src/parallel-bingo-hunter";
import { createMasterSession } from "../src/parallel-master";
import { RackBingoIndex, checkBoardBingo } from "../shared/bingo-odds";
import { validEndgameStreak } from "../shared/endgame";
import {
  prepareEndgameEstimate,
  type EndgameEstimate,
} from "../shared/endgame-estimate";
import { simulateExchange } from "../shared/exchange";
import {
  exchangeAdvicePlays,
  recommendExchange,
} from "../shared/exchange-advice";
import {
  boardWordsAt,
  boardWordsThrough,
  displayedGameScoring,
  lastRecordedBoardPlay,
  nextPlayerToMove,
  scoreTotalsAtPosition,
} from "../shared/game-scoring";
import { Lexicon } from "../shared/lexicon";
import { scorePlacement } from "../shared/game-scoring";
import type { Move, Rules } from "../shared/model";
import {
  ANALYSIS_TRIALS,
  analyzeMoves,
  placeTiles,
  randomGenerator,
  REFINED_TRIALS,
} from "../shared/move-analysis";
import { MoveResultIndex } from "../shared/move-results";
import { analyzeOpponentPolicy } from "../shared/opponent-policy";
import { optimizeExchange } from "../shared/optimal-exchange";
import {
  samplePlayerExchange,
  screenPlayerExchange,
} from "../shared/player-exchange";
import {
  createPlayerProfiles,
  profileWordHash,
  type PlayerProfile,
} from "../shared/player-profiles";
import { checkPremiumDefense } from "../shared/premium-defense";
import { rackComposition } from "../shared/rack-entry";
import {
  prepareReplyAnalysis,
  replyEndgameLine,
  replyPosition,
  REPLY_DETAIL_TIME_MS,
  REPLY_REFINED_SAMPLES,
  REPLY_SAMPLES,
} from "../shared/reply-analysis";
import {
  isSimulatedStyle,
  isSoloSimulatedStyle,
} from "../shared/simulated-styles";
import { createSoloStyleSearch } from "../shared/solo-styles";
import {
  inspectBoard,
  SearchLimitError,
  solvePositionWithBaseline,
} from "../shared/solver";
import { unseenTiles } from "../shared/tile-pool";
import { reviewGame, reviewTurn, reviewTurns } from "../shared/turn-review";
import {
  decodeWordFrequencies,
  englishCasualVocabularyUrl,
  wordFrequencyLanguage,
  wordFrequencyUrl,
} from "../shared/word-familiarity";
import type { Computation } from "./api-computation";
import { ApiError } from "./api-error";

type Request = Extract<Computation, { kind: "analysis" }>;

function profiles(
  root: string,
  lexicon: Lexicon,
  template: Request["position"]["template"],
  profile: PlayerProfile,
) {
  const language = wordFrequencyLanguage(template.rules);
  const read = (path: string) =>
    gunzipSync(readFileSync(join(root, "public", path)));
  const casual = language === "en" && profile === "casual";
  const frequencies = casual
    ? new Map<string, number>()
    : decodeWordFrequencies(read(wordFrequencyUrl(language)), language);
  const vocabulary = casual
    ? new Set(
        read(englishCasualVocabularyUrl).toString("utf8").trimEnd().split("\n"),
      )
    : undefined;
  return createPlayerProfiles(
    lexicon,
    template,
    frequencies,
    undefined,
    vocabulary,
  );
}

function checkBag(
  rules: Rules,
  scorelessTurns: number,
  bagSize: number,
  total: number,
  maximumOpponentRack: number,
) {
  if (bagSize < Math.max(0, total - maximumOpponentRack) || bagSize > total)
    throw new ApiError(422, "Bag size disagrees with the entered tiles.");
  if (!validEndgameStreak(rules, scorelessTurns))
    throw new ApiError(
      422,
      "Enter a valid number of prior passes or scoreless turns.",
    );
}

function gameReview(
  lexicon: Lexicon,
  game: Request["game"],
  operation: Request["operation"],
) {
  if (!game) throw new ApiError(422, "Use a saved game for review.");
  const turns = reviewTurns(game);
  const templateForTurn = (
    position: NonNullable<(typeof turns)[number]["position"]>,
  ) =>
    position.premiums
      ? { ...game.template, premiums: position.premiums }
      : game.template;
  if (operation.kind === "review-game")
    return reviewGame(
      turns.flatMap(({ move, index, position }) =>
        move.player === "you" && position?.rack
          ? [{ move, index, position }]
          : [],
      ),
      game.template,
      () => lexicon,
      game.solo,
    );

  function policy(turn: (typeof turns)[number], maxMs?: number) {
    const { move, position } = turn;
    if (!position)
      return {
        kind: "unavailable",
        reason: "No board snapshot was recorded for this turn.",
      };
    return analyzeOpponentPolicy(
      lexicon,
      {
        position: {
          board: position.board,
          tiles: position.tiles,
          observerRack:
            move.player === "opponent" ? position.observerRack : undefined,
        },
        template: templateForTurn(position),
        word: move.word,
      },
      { maxMs },
    );
  }

  if (operation.kind === "policy-timeline") {
    const available = turns.filter(
      ({ move }) => move.player === operation.player,
    );
    const deadline = performance.now() + 25_000;
    const rows = [];
    for (const turn of available.slice(
      operation.offset,
      operation.offset + 10,
    )) {
      const remaining = deadline - performance.now();
      if (remaining < 50) break;
      rows.push({
        index: turn.index,
        move: turn.move,
        policy: policy(turn, Math.min(4_000, remaining)),
      });
    }
    return {
      rows,
      total: available.length,
      nextOffset:
        operation.offset + rows.length < available.length
          ? operation.offset + rows.length
          : null,
    };
  }

  if (operation.kind === "policy" || operation.kind === "review-turn") {
    const turn = turns[operation.index];
    if (!turn) throw new ApiError(404, "Turn not found.");
    if (operation.kind === "policy")
      return { policy: policy(turn, operation.refined ? 15_000 : undefined) };
    const { position } = turn;
    return {
      ...turn,
      moves: position
        ? reviewTurn(lexicon, position, templateForTurn(position)).slice(0, 30)
        : [],
    };
  }
}

export async function analyzePosition(
  lexicon: Lexicon,
  words: string[],
  { position, operation, root, game }: Request,
) {
  const { template, board, solo } = position;
  const pool = unseenTiles(position, template);
  if (operation.kind === "position") {
    const { square } = operation;
    if (square !== undefined && square >= board.length)
      throw new ApiError(422, "The square is outside the board.");
    return {
      warnings: inspectBoard(lexicon, board, template),
      unseen: pool,
      estimatedBagSize: Math.max(
        0,
        pool.total - (solo ? 0 : template.rackSize),
      ),
      words:
        square === undefined
          ? undefined
          : game
            ? boardWordsAt(game, square)
            : boardWordsThrough(board, template.size, square),
      score: game && displayedGameScoring(game),
      totals: game && scoreTotalsAtPosition(game),
      nextPlayer: game && nextPlayerToMove(game),
      lastPlay: game && lastRecordedBoardPlay(game),
    };
  }
  if (
    operation.kind === "review-game" ||
    operation.kind === "review-turn" ||
    operation.kind === "policy" ||
    operation.kind === "policy-timeline"
  )
    return gameReview(lexicon, game, operation);

  const maximumOpponentRack = solo ? 0 : template.rackSize;
  const minimumBag = Math.max(0, pool.total - maximumOpponentRack);
  const settings = {
    ...position,
    bagSize:
      "bagSize" in operation && operation.bagSize !== undefined
        ? operation.bagSize
        : minimumBag,
    scorelessTurns:
      "scorelessTurns" in operation ? operation.scorelessTurns : 0,
    opponentHasFinalTurn:
      "opponentHasFinalTurn" in operation
        ? operation.opponentHasFinalTurn
        : true,
  };
  const { bagSize } = settings;
  if (operation.kind !== "moves" && operation.kind !== "premium-defense") {
    if (pool.excess.length)
      throw new ApiError(
        422,
        "Some entered tiles exceed the starting tile counts.",
      );
    checkBag(
      template.rules,
      settings.scorelessTurns,
      bagSize,
      pool.total,
      maximumOpponentRack,
    );
  }
  if (operation.kind === "exchange")
    return simulateExchange(
      lexicon,
      { ...settings, slots: operation.slots, bag: bagSize },
      undefined,
      randomGenerator(operation.seed),
    );

  if (operation.kind === "optimal-exchange")
    return optimizeExchange(
      lexicon,
      new RackBingoIndex(words),
      { ...settings, bag: bagSize },
      undefined,
      { seed: operation.seed, maxMs: 30_000 },
    );

  if (operation.kind === "opponent-endgame") {
    if (solo || bagSize)
      throw new ApiError(
        422,
        "Opponent endgame analysis requires two players and an empty bag.",
      );
    return parallelOpponentEndgame(
      lexicon,
      { ...settings, opponentRack: replyPosition(settings).pool.join("") },
      1,
      () => {},
    );
  }

  const { moves, topScore } = solvePositionWithBaseline(
    lexicon,
    position,
    template,
  );
  const find = (id: string) => {
    const move = moves.find((entry) => entry.id === id);
    if (!move)
      throw new ApiError(
        422,
        `Move ${id} is unavailable in this position with these rack marks.`,
      );
    return move;
  };
  if (operation.kind === "moves") {
    const { word, squares, offset, reversed, style, seed, sample, budgetMs } =
      operation;
    if (squares?.some((index) => index >= board.length))
      throw new ApiError(422, "A filter square is outside the board.");
    if (
      style ||
      operation.sort === "endgame" ||
      operation.sort === "bingo-draw"
    )
      checkBag(
        template.rules,
        settings.scorelessTurns,
        bagSize,
        pool.total,
        maximumOpponentRack,
      );
    const index = new MoveResultIndex(moves, template);
    const profileQuery = {
      profile: style,
      profileBagSize: bagSize,
      profileSeed: seed,
      profileSample: sample,
      profileScorelessTurns: settings.scorelessTurns,
    };
    let styleSummary;
    if (style && !isSimulatedStyle(style)) {
      const positionKey = `${board.join(".")}:${rackComposition(position.rack)}`;
      const ranking = profiles(root, lexicon, template, style)(
        moves,
        style,
        {
          ...settings,
          seed: profileWordHash(
            sample ? `${positionKey}:${sample}` : positionKey,
          ),
          playerSeed: seed,
          solo: solo ? true : undefined,
        },
        { all: true },
      );
      index.setProfile(profileQuery, ranking.considered ?? []);
    } else if (style) {
      if (isSoloSimulatedStyle(style) !== !!solo)
        throw new ApiError(
          422,
          "This playing style is unavailable for this game.",
        );
      if (isSoloSimulatedStyle(style)) {
        const search = createSoloStyleSearch(lexicon, settings, moves, style);
        const deadline = performance.now() + budgetMs;
        let done = false;
        while (!done && performance.now() < deadline)
          done = !!search.steps.next().done;
        const { ranked, limited } = search.result();
        index.setProfile(profileQuery, ranked);
        styleSummary = { checked: ranked.length, incomplete: !done, limited };
      } else {
        const odds =
          style === "bingo-hunter"
            ? new RackBingoIndex(words).calculate(
                lexicon,
                position,
                template,
                moves,
                bagSize,
              )
            : undefined;
        const session =
          style === "master"
            ? createMasterSession(lexicon, settings, moves, 8)
            : createBingoHunterSession(
                lexicon,
                settings,
                moves,
                odds,
                8,
                style,
              );
        const { ranked, summary } = await session.run(
          new AbortController().signal,
          () => {},
          budgetMs,
        );
        index.setProfile(profileQuery, ranked);
        const { canContinue, ...rest } = summary;
        styleSummary = { ...rest, incomplete: !!canContinue };
      }
    }
    let endgameId: number | undefined;
    if (operation.sort === "endgame") {
      if (solo || bagSize)
        throw new ApiError(
          422,
          "Endgame ranking requires two players and an empty bag.",
        );
      const deadline = performance.now() + 2_500;
      const estimate = prepareEndgameEstimate(lexicon, settings, deadline);
      const estimates = new Map<string, EndgameEstimate>();
      for (const move of moves.slice(0, 4_000)) {
        const now = performance.now();
        if (now >= deadline) break;
        try {
          estimates.set(move.id, estimate(move, Math.min(deadline, now + 80)));
        } catch (error) {
          if (!(error instanceof SearchLimitError)) throw error;
        }
      }
      endgameId = 1;
      index.setEndgame(endgameId, estimates);
    }
    const rackOdds =
      operation.sort === "bingo-draw"
        ? new RackBingoIndex(words).calculate(
            lexicon,
            position,
            template,
            moves,
            bagSize,
          )
        : undefined;
    const sort = operation.sort ?? (style ? "playing-style" : "score");
    const summary = index.summary(0, topScore);
    const page = index.page({
      ...profileQuery,
      filter: word,
      sort,
      reversed,
      requiredSquares: squares && { size: template.size, indices: squares },
      offset,
      endgameId,
      rackOdds,
    });
    const rows = page.rows.slice(offset - page.offset).map((move) => ({
      ...move,
      scoreRank: page.scoreRanks[move.id],
      utility: page.utilities?.[move.id],
      estimate: page.endgame?.[move.id],
      bingoDrawChance: rackOdds?.byLeave[move.leave],
      breakdown: scorePlacement(
        board,
        placeTiles(board, move),
        template,
        move.direction,
      ),
    }));
    return {
      rows,
      offset,
      nextOffset:
        offset + rows.length < page.total ? offset + rows.length : null,
      total: page.total,
      bingoCount: page.bingoCount,
      allMoves: summary.total,
      allBingos: summary.bingoCount,
      topScore,
      styleSummary,
      styleChoice: page.styleChoice?.move,
    };
  }
  if (operation.kind === "premium-defense")
    return checkPremiumDefense(
      lexicon,
      position,
      template,
      operation.moves?.map(find) ?? moves.slice(0, 20),
    );

  if (operation.kind === "bingo-odds") {
    const candidates = operation.moves.map(find);
    return {
      draw: new RackBingoIndex(words).calculate(
        lexicon,
        position,
        template,
        candidates,
        bagSize,
      ),
      board: operation.boardBased
        ? checkBoardBingo(lexicon, position, template, candidates, bagSize)
        : undefined,
    };
  }

  if (operation.kind === "exchange-advice") {
    if (!operation.style) {
      const plays = exchangeAdvicePlays(position, template, moves);
      return {
        advice:
          plays &&
          recommendExchange(
            lexicon,
            { ...settings, plays },
            { seed: operation.seed },
          ),
      };
    }
    const { comparison, advice } = screenPlayerExchange({
      ...settings,
      profile: operation.style,
      playerSeed: operation.seed,
      move: operation.move ? find(operation.move) : moves[0],
    });
    const sampled =
      comparison &&
      samplePlayerExchange(
        lexicon,
        profiles(root, lexicon, template, operation.style),
        comparison,
      );
    return { advice: sampled ? sampled.advice : advice };
  }

  if (solo)
    throw new ApiError(422, "Opponent reply analysis requires two players.");
  if (operation.kind === "compare") {
    if (
      operation.previousBoard &&
      operation.previousBoard.length !== board.length
    )
      throw new ApiError(
        422,
        "The earlier board must match the board dimensions.",
      );
    return analyzeMoves(
      lexicon,
      {
        ...settings,
        candidates: operation.moves.map(find),
        trials: operation.refined ? REFINED_TRIALS : ANALYSIS_TRIALS,
        seed: operation.seed,
        previousBoard: operation.previousBoard,
        endgameBudgetMultiplier: operation.endgameBudgetMultiplier,
      },
      operation.opponent &&
        profiles(root, lexicon, template, operation.opponent),
    );
  }

  const move = find(operation.move);
  if (operation.kind === "endgame-line")
    return replyEndgameLine(lexicon, settings, move, operation.budgetMs);

  const reference = operation.reference ? find(operation.reference) : moves[0];
  const deadline = performance.now() + REPLY_DETAIL_TIME_MS;
  return prepareReplyAnalysis(
    lexicon,
    settings,
    reference,
    operation.refined ? REPLY_REFINED_SAMPLES : REPLY_SAMPLES,
    () => deadline,
    operation.heatmap,
  )(move);
}
