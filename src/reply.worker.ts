import { dictionaryText } from "./word-list-cache";
import { Lexicon, parseWords } from "../shared/lexicon";
import {
  compareReplyBoards,
  prepareReplyAnalysis,
  REPLY_DETAIL_TIME_MS,
  REPLY_REFINED_SAMPLES,
  REPLY_SAMPLES,
  REPLY_SUMMARY_TIME_MS,
  replyEndgameLine,
  ReplySearchLimitError,
  sampleReplyRacks,
  summarizeReplyBoard,
  type ReplyRequest,
  type ReplyWorkerMessage,
} from "../shared/reply-analysis";
import type { EndgameLine } from "../shared/endgame";
import { SearchLimitError } from "../shared/solver";
import type { CandidateResult } from "./candidate-analysis-jobs";
import { runCandidateJobs } from "./candidate-analysis-pool";

let dictionary: { id: string; lexicon: Lexicon } | undefined;
let summary: Extract<ReplyRequest, { kind: "reply-summary" }> | undefined;
let detail: Exclude<ReplyRequest, { kind: "reply-summary" }> | undefined;
let running = false;
type Histogram = ReturnType<typeof summarizeReplyBoard>;
let sampledBaseline: {
  referenceId: string;
  samples: ReturnType<typeof sampleReplyRacks>;
  board: Histogram;
} | undefined;
const yieldToMessages = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

function publish(message: ReplyWorkerMessage) {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<ReplyRequest>) => {
  if (event.data.kind === "reply-summary") summary = event.data;
  else detail = event.data;
  if (!running) void run();
};

async function getDictionary(id: string) {
  if (dictionary?.id !== id) {
    dictionary = {
      id,
      lexicon: new Lexicon(parseWords(await dictionaryText(id))),
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
            let deadline = performance.now() + REPLY_SUMMARY_TIME_MS;
            const analyze = prepareReplyAnalysis(
              lexicon,
              request,
              reference,
              REPLY_SAMPLES,
              () => deadline,
            );
            for (const move of request.candidates) {
              deadline = performance.now() + REPLY_SUMMARY_TIME_MS;
              try {
                publish({ id, kind, moveId: move.id, result: analyze(move) });
              } catch (error) {
                if (!(error instanceof ReplySearchLimitError)) throw error;
                publish({ id, kind, moveId: move.id, limit: error.limit });
              }
              await betweenReplies();
            }
          }
          publish({ id, kind, done: true });
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
  const cached = sampledBaseline?.referenceId === reference.id ? sampledBaseline : undefined;
  const samples = cached?.samples ?? sampleReplyRacks(position, REPLY_SAMPLES);
  type HistogramResult = Extract<CandidateResult, { kind: "histogram" | "limit" }>;
  let baseline = cached?.board;
  const ready = new Map<string, HistogramResult>();
  const publishReference = candidates.some(({ id }) => id === reference.id);
  if (baseline && publishReference)
    publish({ id, kind, moveId: reference.id, result: compareReplyBoards(baseline, baseline, samples) });
  const moves = [
    ...(baseline ? [] : [reference]),
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
        if (result.kind === "limit") {
          if (result.replyLimit)
            throw new ReplySearchLimitError(result.replyLimit);
          throw new Error(result.message);
        }
        baseline = result.board;
        sampledBaseline = { referenceId: reference.id, samples, board: baseline };
        if (publishReference) {
          const result = compareReplyBoards(baseline, baseline, samples);
          publish({ id, kind, moveId: move.id, result });
        }
      } else {
        ready.set(move.id, result);
      }
      if (baseline) {
        for (const [moveId, candidate] of ready) {
          if (candidate.kind === "limit") {
            publish({ id, kind, moveId, limit: candidate.replyLimit });
          } else {
            const result = compareReplyBoards(candidate.board, baseline, samples);
            publish({ id, kind, moveId, result });
          }
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
      publish({ id, kind, line });
    } else if (kind === "reply-histogram") {
      const deadline = performance.now() + REPLY_DETAIL_TIME_MS;
      const cached =
        sampledBaseline?.referenceId === reference.id ? sampledBaseline : undefined;
      const samples = cached?.samples ?? sampleReplyRacks(request, REPLY_SAMPLES);
      const baseline = cached?.board ??
        summarizeReplyBoard(lexicon, request, reference, samples, () => deadline);
      sampledBaseline = { referenceId: reference.id, samples, board: baseline };
      const board = candidate.id === reference.id
        ? baseline
        : summarizeReplyBoard(lexicon, request, candidate, samples, () => deadline);
      publish({ id, kind, result: compareReplyBoards(board, baseline, samples) });
    } else {
      const deadline = performance.now() + REPLY_DETAIL_TIME_MS;
      const boards = candidate.id === reference.id ? 1 : 2;
      let checked = 0;
      let lastUpdate = -Infinity;
      const onRacksChecked = request.samples === REPLY_REFINED_SAMPLES
        ? (weight: number) => {
            checked += weight;
            const now = performance.now();
            if (now - lastUpdate < 100) return;
            lastUpdate = now;
            // When comparing two boards, each board accounts for half the work.
            publish({ id, kind, racksChecked: Math.floor(checked / boards) });
          }
        : undefined;
      const analyze = prepareReplyAnalysis(
        lexicon,
        request,
        reference,
        request.samples,
        () => deadline,
        request.captureHeatmap,
        onRacksChecked,
      );
      publish({ id, kind, result: analyze(candidate) });
    }
  } catch (error) {
    postError(id, kind, error);
  }
}

function postError(id: number, kind: ReplyRequest["kind"], error: unknown) {
  if (error instanceof ReplySearchLimitError) {
    publish({ id, kind, done: true, limit: error.limit });
    return;
  }
  publish({
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
