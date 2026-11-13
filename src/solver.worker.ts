import { Lexicon, parseWords } from "../shared/lexicon";
import { solvePosition, inspectBoard } from "../shared/solver";
import { RackBingoIndex, checkBoardBingo } from "../shared/bingo-odds";
import { checkPremiumDefense } from "../shared/premium-defense";
import { MOVE_CACHE_LIMIT, MoveResultIndex } from "../shared/move-results";
import type { SolverMessage, SolverRequest } from "./solver-messages";

const results = new Map<number, MoveResultIndex>();
let activeSolve: { id: number; abort: AbortController } | undefined;
let dictionary:
  | { id: string; lexicon: Lexicon; bingo: RackBingoIndex }
  | undefined;

const post = (message: SolverMessage) => self.postMessage(message);
const yieldToQueries = () => new Promise((resolve) => setTimeout(resolve, 0));

self.onmessage = async (event: MessageEvent<SolverRequest>) => {
  const request = event.data;
  switch (request.kind) {
    case "discard":
      results.delete(request.searchId);
      return;
    case "cancel":
      if (activeSolve?.id === request.searchId) activeSolve.abort.abort();
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
  const abort = request.kind === "solve" ? new AbortController() : undefined;
  if (abort) {
    activeSolve?.abort.abort();
    activeSolve = { id, abort };
  }
  try {
    let index = dictionary;
    if (index?.id !== dictionaryId) {
      if (request.kind === "solve")
        post({ id, kind: "solve-status", status: "Loading dictionary…" });
      const response = await fetch(
        `/api/dictionaries/${encodeURIComponent(dictionaryId)}`,
        { signal: abort?.signal },
      );
      if (!response.ok)
        throw new Error(
          "Could not load the dictionary. Check your connection to Tilemaxx.",
        );
      const text = await response.text();
      if (abort?.signal.aborted) return;
      const words = parseWords(text);
      dictionary = index = {
        id: dictionaryId,
        lexicon: new Lexicon(words),
        bingo: new RackBingoIndex(words),
      };
    }
    const { lexicon, bingo } = index;
    if (request.kind === "board-odds") {
      const odds = checkBoardBingo(
        lexicon,
        request,
        template,
        request.candidates,
        request.bagSize,
        (checked) => post({ id, kind: "board-odds-progress", checked }),
      );
      post({ id, kind: "board-odds", odds });
      return;
    }

    post({ id, kind: "solve-status", status: "Finding every move…" });
    const start = performance.now();
    const warnings = inspectBoard(lexicon, board, template);
    const moves = solvePosition(lexicon, request, template);
    const elapsed = performance.now() - start;
    const result = new MoveResultIndex(moves);
    results.set(id, result);
    if (results.size > MOVE_CACHE_LIMIT + 1)
      results.delete(results.keys().next().value!);
    post({
      id,
      kind: "moves",
      results: result.summary(id),
      warnings,
      elapsed,
    });
    if (!moves.length) return;
    await yieldToQueries();
    if (abort?.signal.aborted) return;
    try {
      const defense = checkPremiumDefense(
        lexicon,
        request,
        template,
        moves,
        (defense) => post({ id, kind: "defense", defense }),
        (checked) => post({ id, kind: "defense-progress", checked }),
      );
      post({ id, kind: "defense", defense, done: true });
    } catch {
      post({ id, kind: "defense", done: true });
    }
    await yieldToQueries();
    if (abort?.signal.aborted) return;
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
    post({ id, kind: "rack-odds", odds });
  } catch (error) {
    if (abort?.signal.aborted) return;
    const message =
      error instanceof Error ? error.message : "The solver could not finish.";
    post(
      request.kind === "board-odds"
        ? { id, kind: "board-odds", error: message }
        : { id, kind: "solve-error", error: message },
    );
  } finally {
    if (activeSolve?.id === id) activeSolve = undefined;
  }
};
