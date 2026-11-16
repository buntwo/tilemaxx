import { Lexicon, parseWords } from "../shared/lexicon";
import {
  compareReplyBoards,
  prepareReplyAnalysis,
  REPLY_SAMPLES,
  replyEndgameLine,
  sampleReplyRacks,
  type ReplyRequest,
  type ReplyResult,
} from "../shared/reply-analysis";
import type { EndgameLine } from "../shared/endgame";
import { SearchLimitError } from "../shared/solver";
import type { CandidateResult } from "./candidate-analysis-jobs";
import { runCandidateJobs } from "./candidate-analysis-pool";

let dictionary: { id: string; lexicon: Lexicon } | undefined;
let summary: Extract<ReplyRequest, { kind: "reply-summary" }> | undefined;
let detail: Exclude<ReplyRequest, { kind: "reply-summary" }> | undefined;
let running = false;
const yieldToMessages = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

self.onmessage = (event: MessageEvent<ReplyRequest>) => {
  if (event.data.kind === "reply-summary") summary = event.data;
  else detail = event.data;
  if (!running) void run();
};

async function getDictionary(id: string) {
  if (dictionary?.id !== id) {
    const response = await fetch(`/api/dictionaries/${encodeURIComponent(id)}`);
    if (!response.ok)
      throw new Error("Could not load the word list for replies.");
    dictionary = {
      id,
      lexicon: new Lexicon(parseWords(await response.text())),
    };
  }
  return dictionary.lexicon;
}

async function run() {
  running = true;
  try {
    while (summary || detail) {
      const request = detail ?? summary!;
      if (request.kind === "reply-summary") summary = undefined;
      else detail = undefined;
      const { id, kind, reference } = request;
      try {
        const lexicon = await getDictionary(request.dictionaryId);
        if (kind === "reply-summary") {
          if (request.bagSize) {
            await runHistograms(lexicon, request);
          } else {
            // Empty-bag rows show a single known-rack reply. The separate
            // exact-line precompute uses the candidate workers.
            let deadline = performance.now() + 5_000;
            const analyze = prepareReplyAnalysis(
              lexicon,
              request,
              reference,
              REPLY_SAMPLES,
              () => deadline,
            );
            for (const move of request.candidates) {
              deadline = performance.now() + 5_000;
              let result: ReplyResult | undefined;
              try {
                result = analyze(move);
              } catch (error) {
                if (!(error instanceof SearchLimitError)) throw error;
              }
              self.postMessage({ id, kind, moveId: move.id, result });
              await betweenReplies();
            }
          }
          self.postMessage({ id, kind, done: true });
        } else {
          await runDetail(request);
        }
      } catch (error) {
        postError(id, kind, error);
      }
    }
  } finally {
    running = false;
  }
}

async function betweenReplies() {
  await yieldToMessages();
  if (detail) {
    const next = detail;
    detail = undefined;
    await runDetail(next);
  }
}

async function runHistograms(
  lexicon: Lexicon,
  request: Extract<ReplyRequest, { kind: "reply-summary" }>,
) {
  const {
    id,
    kind,
    candidates,
    reference,
    dictionaryId: _,
    workerLimit,
    ...position
  } = request;
  if (!candidates.length) return;
  const samples = sampleReplyRacks(position, REPLY_SAMPLES);
  type Histogram = Extract<CandidateResult, { kind: "histogram" }>["board"];
  let baseline: Histogram | undefined;
  const ready = new Map<string, Histogram | undefined>();
  const publishReference = candidates.some(({ id }) => id === reference.id);
  const moves = [
    reference,
    ...candidates.filter(({ id }) => id !== reference.id),
  ];
  await runCandidateJobs(
    lexicon,
    moves.map((move) => ({
      kind: "histogram",
      position,
      move,
      samples,
    })),
    async ({ move }, result) => {
      if (result.kind !== "histogram" && result.kind !== "limit")
        throw new Error(
          result.kind === "error"
            ? result.message
            : "Unexpected histogram result.",
        );
      if (move.id === reference.id) {
        if (result.kind === "limit") throw new Error(result.message);
        baseline = result.board;
        if (publishReference) {
          const result = compareReplyBoards(baseline, baseline, samples);
          self.postMessage({ id, kind, moveId: move.id, result });
        }
      } else {
        ready.set(
          move.id,
          result.kind === "histogram" ? result.board : undefined,
        );
      }
      if (baseline) {
        for (const [moveId, board] of ready) {
          const result = board && compareReplyBoards(board, baseline, samples);
          self.postMessage({ id, kind, moveId, result });
        }
        ready.clear();
      }
      await betweenReplies();
    },
    workerLimit,
  );
}

async function runDetail(
  request: Exclude<ReplyRequest, { kind: "reply-summary" }>,
) {
  const { id, kind, candidate, reference } = request;
  try {
    const lexicon = await getDictionary(request.dictionaryId);
    if (kind === "reply-line") {
      const line: EndgameLine = replyEndgameLine(
        lexicon,
        request,
        candidate,
        2_500,
      );
      self.postMessage({ id, kind, line });
    } else {
      const deadline = performance.now() + 25_000;
      const analyze = prepareReplyAnalysis(
        lexicon,
        request,
        reference,
        request.samples,
        () => deadline,
        request.captureHeatmap,
      );
      self.postMessage({ id, kind, result: analyze(candidate) });
    }
  } catch (error) {
    postError(id, kind, error);
  }
}

function postError(id: number, kind: ReplyRequest["kind"], error: unknown) {
  self.postMessage({
    id,
    kind,
    done: true,
    error:
      error instanceof SearchLimitError
        ? "The reply search reached its time or complexity limit."
        : error instanceof Error
          ? error.message
          : "Reply analysis stopped unexpectedly.",
  });
}
