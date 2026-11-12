import { Lexicon, parseWords } from "../shared/lexicon";
import { solve, inspectBoard } from "../shared/solver";
import type { Board, BoardTemplate } from "../shared/model";
let activeId = "",
  lexicon: Lexicon | undefined;
self.onmessage = async (
  event: MessageEvent<{
    id: number;
    dictionaryId: string;
    board: Board;
    rack: string;
    template: BoardTemplate;
  }>,
) => {
  const { id, dictionaryId, board, rack, template } = event.data;
  try {
    if (!lexicon || activeId !== dictionaryId) {
      self.postMessage({ id, status: "Loading dictionary…" });
      const response = await fetch(
        `/api/dictionaries/${encodeURIComponent(dictionaryId)}`,
      );
      if (!response.ok)
        throw new Error(
          "Could not load the dictionary. Check your connection to Tilewise.",
        );
      lexicon = new Lexicon(parseWords(await response.text()));
      activeId = dictionaryId;
    }
    self.postMessage({ id, status: "Finding every move…" });
    const start = performance.now(),
      warnings = inspectBoard(lexicon, board, template);
    const moves = solve(lexicon, board, rack, template);
    self.postMessage({
      id,
      moves,
      warnings,
      elapsed: performance.now() - start,
    });
  } catch (error) {
    self.postMessage({
      id,
      error:
        error instanceof Error ? error.message : "The solver could not finish.",
    });
  }
};
