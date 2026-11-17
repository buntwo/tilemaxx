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
import { MOVE_CACHE_LIMIT, MoveResultIndex } from "../shared/move-results";
import { exchangeAdvicePlays } from "../shared/exchange-advice";
import {
  prepareEndgameEstimate,
  type EndgameEstimate,
} from "../shared/endgame-estimate";
import type { SolverMessage, SolverRequest } from "./solver-messages";

const results = new Map<number, MoveResultIndex>();
let activeSolve: { id: number; abort: AbortController } | undefined;
let activeEndgame: { id: number; abort: AbortController } | undefined;
let dictionary:
  | { id: string; lexicon: Lexicon; bingo: RackBingoIndex }
  | undefined;

const post = (message: SolverMessage) => self.postMessage(message);
const yieldToQueries = () => new Promise((resolve) => setTimeout(resolve, 0));

const ENDGAME_ESTIMATE_TIME_MS = 2_500;
const ENDGAME_ESTIMATE_MOVES = 4_000;
const ENDGAME_ESTIMATE_MOVE_MS = 80;

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

self.onmessage = async (event: MessageEvent<SolverRequest>) => {
  const request = event.data;
  switch (request.kind) {
    case "discard":
      results.delete(request.searchId);
      return;
    case "cancel":
      if (activeSolve?.id === request.searchId) activeSolve.abort.abort();
      return;
    case "cancel-endgame":
      if (activeEndgame?.id === request.id) activeEndgame.abort.abort();
      return;
    case "page":
      post({
        id: request.id,
        kind: "page",
        page: results.get(request.searchId)?.page(request.query),
      });
      return;
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
    const result = new MoveResultIndex(moves, template);
    const exchangePlays = warnings.length
      ? undefined
      : exchangeAdvicePlays(request, template, moves);
    const replyCandidatesPending = moves.length > REPLY_LIMIT;
    results.set(id, result);
    if (results.size > MOVE_CACHE_LIMIT + 1)
      results.delete(results.keys().next().value!);
    post({
      id,
      kind: "moves",
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
    const oddsStart = performance.now();
    let odds: ReturnType<RackBingoIndex["calculate"]>;
    try {
      odds = bingo.calculate(lexicon, request, template, moves);
    } catch {
      odds = {
        byLeave: {},
        exact: false,
        bagSize: 0,
        error: "Bingo draw odds could not be calculated.",
      };
    }
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
