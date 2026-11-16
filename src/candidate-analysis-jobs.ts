import { EndgameSearchLimitError, type EndgameLine } from "../shared/endgame";
import type { Lexicon } from "../shared/lexicon";
import type { Move } from "../shared/model";
import {
  replyEndgameLine,
  summarizeReplyBoard,
  type ReplyPosition,
  type sampleReplyRacks,
} from "../shared/reply-analysis";
import { SearchLimitError } from "../shared/solver";

export type CandidateJob = {
  position: ReplyPosition;
  move: Move;
} & (
  | { kind: "histogram"; samples: ReturnType<typeof sampleReplyRacks> }
  | { kind: "endgame" }
);

export type CandidateResult =
  | { kind: "histogram"; board: ReturnType<typeof summarizeReplyBoard> }
  | { kind: "endgame"; line: EndgameLine; elapsed: number }
  | { kind: "limit"; message: string; elapsed: number }
  | { kind: "error"; message: string };

export type CandidateRequest = {
  job: CandidateJob;
  dictionary?: Parameters<typeof Lexicon.fromIndex>[0];
};

export function analyzeCandidate(
  lexicon: Lexicon,
  { position, move, ...job }: CandidateJob,
): CandidateResult {
  const started = performance.now();
  try {
    if (job.kind === "histogram") {
      const deadline = started + 5_000;
      return {
        kind: "histogram",
        board: summarizeReplyBoard(
          lexicon,
          position,
          move,
          job.samples,
          () => deadline,
        ),
      };
    }
    const line = replyEndgameLine(lexicon, position, move, 5_000, Infinity);
    return { kind: "endgame", line, elapsed: performance.now() - started };
  } catch (error) {
    const message =
      error instanceof SearchLimitError
        ? "The reply search reached its time or complexity limit."
        : error instanceof Error
          ? error.message
          : "Candidate analysis stopped unexpectedly.";
    if (
      error instanceof SearchLimitError ||
      error instanceof EndgameSearchLimitError
    )
      return { kind: "limit", message, elapsed: performance.now() - started };
    return { kind: "error", message };
  }
}
