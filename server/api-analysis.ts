import { parallelOpponentEndgame } from "../src/parallel-opponent-endgame";
import { parallelOptimalExchange } from "../src/parallel-exchange";
import { createBingoHunterSession, type HunterSummary } from "../src/parallel-bingo-hunter";
import { createMasterSession } from "../src/parallel-master";
import { runCandidateJobs } from "../src/candidate-analysis-pool";
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
import { explainStyleExchange, explainStylePlay, styleCandidate } from "../shared/style-explanation";
import { analyzeOpponentPolicy, type OpponentPolicyResult } from "../shared/opponent-policy";
import {
  samplePlayerExchange,
  screenPlayerExchange,
  type PlayerExchangeAdvice,
} from "../shared/player-exchange";
import { profileWordHash, usesLearnerPolicy } from "../shared/player-profiles";
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
import { decodeProfileVocabulary } from "../shared/profile-vocabulary";
import type { Computation } from "./api-computation";
import { ApiError } from "./api-error";
import { forecastLearner } from "./api-learner-forecast";
import { apiPlayerProfiles as profiles } from "./api-player-profiles";

type Request = Extract<Computation, { kind: "analysis" }>;

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

async function gameReview(
  lexicon: Lexicon,
  game: Request["game"],
  operation: Request["operation"],
  workerLimit: number,
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
        !move.action && move.player === "you" && position?.rack
          ? [{ move, index, position }]
          : [],
      ),
      game.template,
      () => lexicon,
      game.solo,
    );

  function policyInput(turn: (typeof turns)[number]) {
    const { move, position } = turn;
    if (!position || move.action) return;
    return {
      position: {
        board: position.board,
        tiles: position.tiles,
        observerRack: move.player === "opponent" ? position.observerRack : undefined,
      },
      template: templateForTurn(position),
      word: move.word,
    };
  }

  function unavailablePolicy(turn: (typeof turns)[number]): OpponentPolicyResult {
    return {
      kind: "unavailable",
      reason: turn.move.action ? "This turn did not place a word." : "No board snapshot was recorded for this turn.",
    };
  }

  if (operation.kind === "policy-timeline") {
    const available = turns.filter(
      ({ move }) => !move.action && move.player === operation.player,
    );
    const deadline = performance.timeOrigin + performance.now() + 25_000;
    const page = available.slice(operation.offset, operation.offset + 10);
    const policies = new Map<number, OpponentPolicyResult>();
    const jobs = page.flatMap((turn) => {
      const input = policyInput(turn);
      if (input) return [{ kind: "policy-turn" as const, key: String(turn.index), input, deadline, maxMs: 4_000 }];
      policies.set(turn.index, unavailablePolicy(turn));
      return [];
    });
    await runCandidateJobs(lexicon, jobs, (job, result) => {
      if (result.kind !== job.kind) throw new Error(
        result.kind === "error" ? result.message : "Could not analyze the recorded turn.",
      );
      if (result.policy) policies.set(Number(job.key), result.policy);
    }, workerLimit);
    const rows = [];
    for (const turn of page) {
      const policy = policies.get(turn.index);
      if (!policy) break;
      rows.push({ index: turn.index, move: turn.move, policy });
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
    if (operation.kind === "policy") {
      const input = policyInput(turn);
      return { policy: input
        ? analyzeOpponentPolicy(lexicon, input, { maxMs: operation.refined ? 15_000 : undefined })
        : unavailablePolicy(turn) };
    }
    const { position } = turn;
    return {
      ...turn,
      moves: position && !turn.move.action
        ? reviewTurn(lexicon, position, templateForTurn(position)).slice(0, 30)
        : [],
    };
  }
}

export async function analyzePosition(
  lexicon: Lexicon,
  words: string[],
  { position, operation, root, game, profileVocabulary, savedScoreSpread }: Request,
  workerLimit = 0,
) {
  const { template, board, solo } = position;
  const vocabulary = profileVocabulary && decodeProfileVocabulary(profileVocabulary, words);
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
    return gameReview(lexicon, game, operation, workerLimit);

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
    return parallelOptimalExchange(
      lexicon,
      new RackBingoIndex(words),
      { ...settings, bag: bagSize },
      () => {},
      workerLimit,
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
      workerLimit,
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
    const scoreSpread = usesLearnerPolicy(style) && !solo && bagSize === 0
      ? operation.scoreSpread ?? savedScoreSpread
      : undefined;
    const profileQuery = {
      profile: style,
      profileBagSize: bagSize,
      profileSeed: seed,
      profileSample: sample,
      profileScorelessTurns: settings.scorelessTurns,
      profileScoreSpread: scoreSpread,
    };
    let styleSummary: Omit<HunterSummary, "canContinue"> & { incomplete: boolean } | undefined;
    let exchangeAdvice: PlayerExchangeAdvice | undefined;
    if (style && !isSimulatedStyle(style)) {
      const positionKey = `${board.join(".")}:${rackComposition(position.rack)}`;
      const profilePosition = {
        ...settings,
        seed: profileWordHash(sample ? `${positionKey}:${sample}` : positionKey),
        playerSeed: seed,
        scoreSpread,
        solo: solo ? true as const : undefined,
      };
      const choose = profiles(root, lexicon, template, vocabulary);
      if (usesLearnerPolicy(style)) {
        const result = await forecastLearner(lexicon, template, choose, style, moves, profilePosition,
          { root, vocabulary: profileVocabulary, workerLimit });
        index.setProfile(profileQuery, result.ranked);
        exchangeAdvice = result.exchange;
      } else {
        const ranking = choose(moves, style, profilePosition, { all: true });
        index.setProfile(profileQuery, ranking.considered ?? []);
      }
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
            ? createMasterSession(lexicon, settings, moves, workerLimit)
            : createBingoHunterSession(
                lexicon,
                settings,
                moves,
                odds,
                workerLimit,
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
    const passExplanation = styleSummary?.passExplanation;
    const rows = page.rows.slice(offset - page.offset).map((move) => {
      const utility = page.utilities?.[move.id];
      const explanation = style && utility && explainStylePlay(
        style, styleCandidate(move, utility), page.styleLeaders ?? [],
        styleSummary && (styleSummary.incomplete || styleSummary.limited),
      );
      const preferred = passExplanation ? "pass" as const : exchangeAdvice ? "exchange" as const : undefined;
      return {
        ...move,
        scoreRank: page.scoreRanks[move.id],
        utility,
        styleExplanation: explanation && (preferred ? { ...explanation, recommended: false, preferred } : explanation),
        estimate: page.endgame?.[move.id],
        bingoDrawChance: rackOdds?.byLeave[move.leave],
        breakdown: scorePlacement(board, placeTiles(board, move), template, move.direction),
      };
    });
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
      exchangeAdvice,
      exchangeExplanation: exchangeAdvice && explainStyleExchange(exchangeAdvice, position.rack, exchangeAdvice.slots),
      passExplanation,
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
    if (usesLearnerPolicy(operation.style) && !solo) {
      const choose = profiles(root, lexicon, template, vocabulary);
      const result = await forecastLearner(lexicon, template, choose, operation.style, moves, {
        ...settings,
        solo: undefined,
        seed: profileWordHash(`${board.join(".")}:${rackComposition(position.rack)}`),
        playerSeed: operation.seed,
      }, { root, vocabulary: profileVocabulary, workerLimit,
        reference: operation.move ? find(operation.move) : undefined });
      const advice = result.exchange;
      return { advice, styleExplanation: advice && explainStyleExchange(advice, position.rack, advice.slots) };
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
        profiles(root, lexicon, template),
        comparison,
      );
    const selected = sampled ? sampled.advice : advice;
    return { advice: selected, styleExplanation: selected && explainStyleExchange(selected, position.rack, selected.slots) };
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
        profiles(root, lexicon, template, vocabulary),
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
