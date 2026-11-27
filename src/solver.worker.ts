import { unseenTiles } from "../shared/tile-pool";
import { SIMULATED_STYLE_LABELS, isSimulatedStyle, isSoloSimulatedStyle, type SimulatedStyle } from "../shared/simulated-styles";
import { createMasterSession } from "./parallel-master";
import { BINGO_HUNTER_SLICE_MS, createBingoHunterSession } from "./parallel-bingo-hunter";
import { dictionaryText } from "./word-list-cache";
import { Lexicon, parseWords } from "../shared/lexicon";
import {
  solvePositionWithBaseline,
  inspectBoard,
  SearchLimitError,
  type PremiumReply,
} from "../shared/solver";
import {
  BOARD_BINGO_BUDGET_MS,
  RackBingoIndex,
  checkBoardBingo,
  prepareBoardBingo,
  type BoardOdds,
  type BoardOddsResult,
} from "../shared/bingo-odds";
import { runCandidateJobs } from "./candidate-analysis-pool";
import { computeWorkerLimit } from "./compute-workers";
import { checkPremiumDefense } from "../shared/premium-defense";
import { extraReplyCandidates } from "../shared/reply-candidates";
import { REPLY_LIMIT } from "../shared/reply-analysis";
import { MOVE_CACHE_LIMIT, MoveResultIndex, profileQueryKey, type MoveQuery } from "../shared/move-results";
import { exchangeAdvicePlays } from "../shared/exchange-advice";
import {
  prepareEndgameEstimate,
  type EndgameEstimate,
} from "../shared/endgame-estimate";
import type { SolverMessage, SolverRequest } from "./solver-messages";
import { createPlayerProfiles, profileWordHash, usesLearnerPolicy, type PlayerProfile } from "../shared/player-profiles";
import { createLearnerLookahead } from "../shared/learner-lookahead";
import { loadProfileVocabulary } from "./word-frequencies";
import { rackComposition } from "../shared/rack-entry";
import { createSoloStyleSearch } from "../shared/solo-styles";
import type { HunterProgress } from "./parallel-bingo-hunter";
import { timingNow } from "./move-timing";

let activeHunter: { id: number; searchId: number; abort: AbortController; finished: Promise<unknown> } | undefined;
const hunterSessions = new Map<SimulatedStyle, { searchId: number; key: string; lastId?: number; session: ReturnType<typeof createBingoHunterSession> | ReturnType<typeof createMasterSession> | ReturnType<typeof soloSession> }>();
type SolveRequest = Extract<SolverRequest, { kind: "solve" }>;
type SolverResult = MoveResultIndex & {
  position: SolveRequest;
  lexicon: Lexicon;
  words: readonly string[];
  odds?: ReturnType<RackBingoIndex["calculate"]>;
};
type ProfileJob = { key: string; ready: Promise<void> };
const results = new Map<number, SolverResult>();
let profileJobs = new WeakMap<SolverResult, ProfileJob>();
let models: {
  lexicon: Lexicon;
  templateKey: string;
  choose: ReturnType<typeof createPlayerProfiles>;
  learner?: ReturnType<typeof createLearnerLookahead>;
} | undefined;
let activeSolve: { id: number; abort: AbortController } | undefined;
let activeEndgame: { id: number; abort: AbortController } | undefined;
let dictionary:
  | { id: string; lexicon: Lexicon; bingo: RackBingoIndex; words: readonly string[] }
  | undefined;

const post = (message: SolverMessage) => self.postMessage(message);
const yieldToQueries = () => new Promise((resolve) => setTimeout(resolve, 0));

const ENDGAME_ESTIMATE_TIME_MS = 2_500;
const ENDGAME_ESTIMATE_MOVES = 4_000;
const ENDGAME_ESTIMATE_MOVE_MS = 80;

async function prepareProfile(
  result: SolverResult,
  profile: PlayerProfile,
  query: MoveQuery,
  current: () => boolean,
) {
  const start = timingNow();
  const { profileBagSize: bagSize = 0, profileSeed: playerSeed = 0, profileSample = 0 } = query;
  const { position, lexicon } = result;
  const { template } = position;
  const [frequencies, vocabulary] = await loadProfileVocabulary(
    template.rules, { id: position.dictionaryId, words: result.words }, profile,
  );
  if (!current()) return;

  const templateKey = JSON.stringify([template, profile]);
  if (models?.lexicon !== lexicon || models.templateKey !== templateKey) {
    models = { lexicon, templateKey, choose: createPlayerProfiles(lexicon, template, frequencies, undefined, vocabulary) };
  }
  const positionKey = `${position.board.join(".")}:${rackComposition(position.rack)}`;
  const seed = profileWordHash(profileSample ? `${positionKey}:${profileSample}` : positionKey);
  const profilePosition = {
    ...position, bagSize, seed, playerSeed, scorelessTurns: query.profileScorelessTurns,
    scoreSpread: query.profileScoreSpread,
  };
  const { considered, learnerSlate } = models.choose(result.moves, profile, profilePosition, {
    all: true, learnerSlate: usesLearnerPolicy(profile),
  });

  if (!usesLearnerPolicy(profile)) {
    result.setProfile(query, considered ?? [], { start, end: timingNow() });
    return;
  }

  const evaluate = models.learner ??= createLearnerLookahead(lexicon, template, models.choose, profile);
  const steps = evaluate(profilePosition, considered ?? [], learnerSlate ?? []);
  let slice = performance.now();
  let step = steps.next();
  while (!step.done) {
    if (performance.now() - slice >= 12) {
      await yieldToQueries();
      if (!current()) return;
      slice = performance.now();
    }
    step = steps.next();
  }
  result.setProfile(query, step.value.ranked, { start, end: timingNow() }, {
    rack: position.rack,
    advice: step.value.exchange,
  });
}

async function fetchPage({ id, searchId, query }: Extract<SolverRequest, { kind: "page" }>) {
  const result = results.get(searchId);
  const { profile } = query;
  if (result && profile && !isSimulatedStyle(profile)) {
    const key = profileQueryKey(query);
    const pending = profileJobs.get(result);
    if (pending && pending.key !== key) profileJobs.delete(result);
    if (!result.hasProfile(query)) {
      let job = profileJobs.get(result);
      if (!job) {
        const task: ProfileJob = {
          key,
          ready: prepareProfile(result, profile, query,
            () => results.get(searchId) === result && profileJobs.get(result) === task),
        };
        profileJobs.set(result, task);
        job = task;
      }
      try {
        await job.ready;
      } catch (error) {
        if (profileJobs.get(result) !== job || results.get(searchId) !== result)
          return post({ id, kind: "page" });
        const page = { ...result.page(query), rows: [], head: [], total: 0, bingoCount: 0,
          error: error instanceof Error ? error.message : "The playing style could not be loaded." };
        return post({ id, kind: "page", page });
      } finally {
        if (profileJobs.get(result) === job) profileJobs.delete(result);
      }
      if (results.get(searchId) !== result || !result.hasProfile(query))
        return post({ id, kind: "page" });
    }
  }
  post({ id, kind: "page", page: result?.page(query) });
}

async function rankEndgame(
  request: Extract<SolverRequest, { kind: "endgame" }>,
  lexicon: Lexicon,
  signal: AbortSignal,
) {
  const { searchId, id } = request;
  const result = results.get(searchId);
  if (!result) return;
  let slice = performance.now();
  const deadline = slice + ENDGAME_ESTIMATE_TIME_MS;
  const estimate = prepareEndgameEstimate(lexicon, { ...request, bagSize: 0 }, deadline);
  const estimates = new Map<string, EndgameEstimate>();
  for (const move of result.moves.slice(0, ENDGAME_ESTIMATE_MOVES)) {
    if (signal.aborted || results.get(searchId) !== result) return;
    const now = performance.now();
    if (now >= deadline) break;
    try {
      estimates.set(
        move.id,
        estimate(move, Math.min(deadline, now + ENDGAME_ESTIMATE_MOVE_MS)),
      );
    } catch (error) {
      if (!(error instanceof SearchLimitError)) throw error;
    }
    if (performance.now() - slice >= 12) {
      await yieldToQueries();
      slice = performance.now();
    }
  }
  if (signal.aborted || results.get(searchId) !== result) return;
  return result.setEndgame(id, estimates);
}

async function boardBingoOdds(
  lexicon: Lexicon,
  request: Extract<SolverRequest, { kind: "board-odds" }>,
): Promise<BoardOddsResult> {
  const { id, board, template, candidates, bagSize } = request;
  const concurrency = Math.min(request.workerLimit ?? computeWorkerLimit(), candidates.length);
  const report = (checked: number, moveId: string, odds: BoardOdds) =>
    post({ id, kind: "board-odds-progress", checked, moveId, odds });
  if (concurrency <= 1)
    return checkBoardBingo(lexicon, request, template, candidates, bagSize, report);

  const total = candidates.length;
  const drawsFor = prepareBoardBingo(request, template, total, bagSize);
  const deadline = performance.timeOrigin + performance.now() + BOARD_BINGO_BUDGET_MS;
  const byMove: Record<string, BoardOdds> = Object.create(null);
  let checked = 0;
  await runCandidateJobs(
    lexicon,
    candidates.map((move, index) => ({
      kind: "board-bingo",
      board,
      template,
      move,
      draws: drawsFor(move),
      deadline,
      wavesRemaining: Math.ceil((total - index) / concurrency),
    })),
    (job, result) => {
      if (job.kind !== "board-bingo" || result.kind !== "board-bingo")
        throw new Error(result.kind === "error" ? result.message : "Unexpected board odds result.");
      if (!result.odds) return;
      byMove[job.move.id] = result.odds;
      report(++checked, job.move.id, result.odds);
    },
    concurrency,
  );
  return { byMove, checked, total, bagSize };
}

function soloSession(search: ReturnType<typeof createSoloStyleSearch>) {
  let done = false;
  return {
    async run(signal: AbortSignal, progress: (value: HunterProgress) => void, budget: number) {
      const deadline = performance.now() + budget;
      let lastProgress = -Infinity;
      let slice = performance.now();
      while (!done && !signal.aborted && performance.now() < deadline) {
        const step = search.steps.next();
        done = !!step.done;
        if (!done && step.value) {
          const now = performance.now();
          if (now - lastProgress >= 100 || step.value.done === 0 || step.value.done === step.value.total) {
            lastProgress = now;
            progress(step.value);
          }
        }
        if (performance.now() - slice >= 12) {
          await yieldToQueries();
          slice = performance.now();
        }
      }
      const { ranked, limited } = search.result();
      return { ranked, summary: { checked: ranked.length, canContinue: !done, limited } };
    },
  };
}

async function hunt(request: Extract<SolverRequest, { kind: "bingo-hunter" }>) {
  const { id, searchId, bagSize, workerLimit, style = "bingo-hunter" } = request;
  const hunterSession = hunterSessions.get(style);
  const result = results.get(searchId);
  if (!result) {
    post({ id, kind: "bingo-hunter", error: "Find moves again to reload this position." });
    return;
  }
  if (isSoloSimulatedStyle(style) !== !!result.position.solo) {
    post({ id, kind: "bingo-hunter", error: "This playing style is unavailable for this game." });
    return;
  }
  const key = JSON.stringify([bagSize, request.scorelessTurns, request.opponentHasFinalTurn]);
  const previous = activeHunter;
  if (request.resumeFrom !== undefined &&
    (hunterSession?.searchId !== searchId || hunterSession.key !== key || hunterSession.lastId !== request.resumeFrom)) {
    post({ id, kind: "bingo-hunter", error: `This search has expired. Run ${SIMULATED_STYLE_LABELS[style]} again.` });
    return;
  }
  previous?.abort.abort();
  const abort = new AbortController();
  const started = performance.now();
  try {
    if (request.resumeFrom === undefined) {
      hunterSessions.set(style, {
        searchId, key,
        session: isSoloSimulatedStyle(style)
          ? soloSession(createSoloStyleSearch(result.lexicon, result.position, result.moves, style))
          : style === "master"
            ? createMasterSession(result.lexicon, { ...result.position, ...request },
              result.moves, computeWorkerLimit(workerLimit))
            : createBingoHunterSession(result.lexicon, { ...result.position, ...request },
              result.moves, result.odds, computeWorkerLimit(workerLimit), style),
      });
    }
    const current = hunterSessions.get(style)!;
    const finished = (async () => {
      await previous?.finished.catch(() => {});
      return current.session.run(abort.signal,
        (progress) => post({ id, kind: "bingo-hunter-progress", progress }),
        Math.max(0, BINGO_HUNTER_SLICE_MS - (performance.now() - started)),
      );
    })();
    activeHunter = { id, searchId, abort, finished };
    const { ranked, summary } = await finished;
    if (abort.signal.aborted || hunterSessions.get(style) !== current) return;
    current.lastId = id;
    result.setProfile({ profile: style, profileBagSize: bagSize, profileSeed: id }, ranked);
    post({ id, kind: "bingo-hunter", summary });
  } catch (error) {
    if (!abort.signal.aborted)
      post({ id, kind: "bingo-hunter", error: error instanceof Error ? error.message : `${SIMULATED_STYLE_LABELS[style]} stopped unexpectedly.` });
  } finally {
    if (activeHunter?.id === id) activeHunter = undefined;
  }
}

self.onmessage = async (event: MessageEvent<SolverRequest>) => {
  const request = event.data;
  switch (request.kind) {
    case "bingo-hunter":
      return hunt(request);
    case "cancel-bingo-hunter":
      if (activeHunter?.id === request.id) activeHunter.abort.abort();
      return;
    case "discard":
      if (activeHunter?.searchId === request.searchId) activeHunter.abort.abort();
      for (const [style, session] of hunterSessions)
        if (session.searchId === request.searchId) hunterSessions.delete(style);
      results.delete(request.searchId);
      return;
    case "cancel":
      if (activeSolve?.id === request.searchId) activeSolve.abort.abort();
      return;
    case "cancel-endgame":
      if (activeEndgame?.id === request.id) activeEndgame.abort.abort();
      return;
    case "page":
      return fetchPage(request);
    case "shortlist":
      post({
        id: request.id,
        kind: "shortlist",
        shortlist: results.get(request.searchId)?.shortlist(request.options),
      });
      return;
  }
  const { id, dictionaryId, board, template } = request;
  const abort =
    request.kind === "board-odds" ? undefined : new AbortController();
  if (abort && request.kind === "solve") {
    activeSolve?.abort.abort();
    profileJobs = new WeakMap();
    activeSolve = { id, abort };
  } else if (abort && request.kind === "endgame") {
    activeEndgame?.abort.abort();
    activeEndgame = { id, abort };
  }
  try {
    let index = dictionary;
    let dictionaryElapsed: number | undefined;
    if (index?.id !== dictionaryId) {
      const started = performance.now();
      if (request.kind === "solve")
        post({ id, kind: "solve-status", status: "Loading dictionary…" });
      const text = await dictionaryText(dictionaryId);
      if (abort?.signal.aborted) return;
      const words = parseWords(text);
      dictionary = index = {
        id: dictionaryId,
        words,
        lexicon: new Lexicon(words),
        bingo: new RackBingoIndex(words),
      };
      dictionaryElapsed = performance.now() - started;
    }
    const { lexicon, bingo } = index;
    if (request.kind === "endgame") {
      const ranking = await rankEndgame(request, lexicon, abort!.signal);
      if (!abort?.signal.aborted) post({ id, kind: "endgame", ranking });
      return;
    }
    if (request.kind === "board-odds") {
      const odds = await boardBingoOdds(lexicon, request);
      post({ id, kind: "board-odds", odds });
      return;
    }

    post({ id, kind: "solve-status", status: "Finding every move…" });
    const start = performance.now();
    const warnings = inspectBoard(lexicon, board, template);
    const { moves, topScore } = solvePositionWithBaseline(
      lexicon,
      request,
      template,
    );
    const movesElapsed = performance.now() - start;
    const indexingStart = performance.now();
    const result = Object.assign(new MoveResultIndex(moves, template), { position: request, lexicon, words: index.words });
    const exchangePlays = request.solo || warnings.length
      ? undefined
      : exchangeAdvicePlays(request, template, moves);
    const replyCandidatesPending = !request.solo && moves.length > REPLY_LIMIT;
    results.set(id, result);
    if (results.size > MOVE_CACHE_LIMIT + 1)
      results.delete(results.keys().next().value!);
    post({
      id,
      kind: "moves",
      ...(request.solo && { solo: request.solo }),
      results: result.summary(id, topScore),
      warnings,
      replyCandidatesPending,
      stages: {
        dictionary: dictionaryElapsed,
        moves: movesElapsed,
        indexing: performance.now() - indexingStart,
      },
      exchange: exchangePlays && {
        dictionaryId,
        board,
        rack: request.rack,
        excludedRackSlots: request.excludedRackSlots,
        template,
        plays: exchangePlays,
      },
    });
    if (!moves.length) return;
    await yieldToQueries();
    if (abort?.signal.aborted) return;
    if (!request.solo) {
      const defenseStart = performance.now();
      let baseline: ReadonlyMap<number, PremiumReply> | undefined;
      try {
        const defense = checkPremiumDefense(
          lexicon,
          request,
          template,
          moves,
          (defense) => post({ id, kind: "defense", defense }),
          (checked) => post({ id, kind: "defense-progress", checked }),
          (replies) => { baseline = replies; },
        );
        post({
          id,
          kind: "defense",
          defense,
          replyCandidates: replyCandidatesPending
            ? extraReplyCandidates(request, moves, defense, baseline)
            : undefined,
          elapsed: performance.now() - defenseStart,
        });
      } catch {
        post({
          id,
          kind: "defense",
          replyCandidates: replyCandidatesPending ? [] : undefined,
          elapsed: performance.now() - defenseStart,
        });
      }
      await yieldToQueries();
      if (abort?.signal.aborted) return;
    }
    const oddsStart = performance.now();
    let odds: ReturnType<RackBingoIndex["calculate"]>;
    try {
      const bagSize = request.solo ? unseenTiles(request, template).total : undefined;
      odds = bingo.calculate(lexicon, request, template, moves, bagSize);
    } catch {
      odds = {
        byLeave: {},
        exact: false,
        bagSize: 0,
        error: "Bingo draw odds could not be calculated.",
      };
    }
    Object.assign(result, { odds });
    post({ id, kind: "rack-odds", odds, elapsed: performance.now() - oddsStart });
  } catch (error) {
    if (abort?.signal.aborted) return;
    const message =
      error instanceof Error ? error.message : "The solver could not finish.";
    post(
      request.kind === "endgame"
        ? { id, kind: "endgame" }
        : request.kind === "board-odds"
          ? { id, kind: "board-odds", error: message }
          : { id, kind: "solve-error", error: message },
    );
  } finally {
    if (activeSolve?.id === id) activeSolve = undefined;
    if (activeEndgame?.id === id) activeEndgame = undefined;
  }
};
