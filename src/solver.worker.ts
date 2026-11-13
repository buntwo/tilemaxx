import { Lexicon, parseWords } from "../shared/lexicon";
import { solvePosition, inspectBoard } from "../shared/solver";
import { RackBingoIndex, checkBoardBingo } from "../shared/bingo-odds";
import type { BoardTemplate, Move, Position } from "../shared/model";

type SolverRequest = Position & {
  id: number;
  dictionaryId: string;
  template: BoardTemplate;
} & (
    | { kind?: "solve" }
    | { kind: "board-odds"; candidates: Move[]; bagSize: number }
  );

let dictionary:
  | { id: string; lexicon: Lexicon; bingo: RackBingoIndex }
  | undefined;
self.onmessage = async (event: MessageEvent<SolverRequest>) => {
  const request = event.data;
  const { id, dictionaryId, board, template } = request;
  try {
    if (dictionary?.id !== dictionaryId) {
      if (request.kind !== "board-odds")
        self.postMessage({ id, status: "Loading dictionary…" });
      const response = await fetch(
        `/api/dictionaries/${encodeURIComponent(dictionaryId)}`,
      );
      if (!response.ok)
        throw new Error(
          "Could not load the dictionary. Check your connection to Tilemaxx.",
        );
      const words = parseWords(await response.text());
      dictionary = {
        id: dictionaryId,
        lexicon: new Lexicon(words),
        bingo: new RackBingoIndex(words),
      };
    }
    const { lexicon, bingo } = dictionary;
    if (request.kind === "board-odds") {
      const boardOdds = checkBoardBingo(
        lexicon,
        request,
        template,
        request.candidates,
        request.bagSize,
        (checked) => {
          self.postMessage({ id, boardOddsProgress: checked });
        },
      );
      self.postMessage({ id, boardOdds });
      return;
    }

    self.postMessage({ id, status: "Finding every move…" });
    const start = performance.now();
    const warnings = inspectBoard(lexicon, board, template);
    const moves = solvePosition(lexicon, request, template);
    self.postMessage({
      id,
      moves,
      warnings,
      elapsed: performance.now() - start,
      rackOddsPending: moves.length > 0,
    });
    if (moves.length) {
      try {
        self.postMessage({
          id,
          rackOdds: bingo.calculate(lexicon, request, template, moves),
        });
      } catch {
        self.postMessage({
          id,
          rackOddsError: "Bingo draw odds could not be calculated.",
        });
      }
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The solver could not finish.";
    self.postMessage(
      request.kind === "board-odds"
        ? { id, boardOddsError: message }
        : { id, error: message },
    );
  }
};
