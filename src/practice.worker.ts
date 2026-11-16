import { Lexicon, parseWords } from "../shared/lexicon";
import { RackBingoIndex } from "../shared/bingo-odds";
import type {
  OptimalExchangeRequest,
  OptimalExchangeResult,
} from "../shared/optimal-exchange";
import { simulateExchange, type ExchangeRequest } from "../shared/exchange";
import {
  recommendExchange,
  type ExchangeAdvice,
  type ExchangeAdviceRequest,
} from "../shared/exchange-advice";
import {
  reviewOpportunity,
  reviewReplyRisk,
  reviewTurn,
  type ReviewSummary,
} from "../shared/turn-review";
import {
  analyzeOpponentPolicy,
  type OpponentPolicyInput,
  type OpponentPolicyResult,
} from "../shared/opponent-policy";
import type { BoardTemplate, TrackedMove, TurnPosition } from "../shared/model";
import { runCandidateJobs } from "./candidate-analysis-pool";
import { computeWorkerLimit } from "./compute-workers";
import { parallelOptimalExchange } from "./parallel-exchange";

type ReviewJob = { position: TurnPosition; move: TrackedMove; index: number };
type PolicyReviewJob = { key: string; input: OpponentPolicyInput };
export type OpponentPolicyUpdate = {
  key: string;
  result: OpponentPolicyResult;
};
export type OpponentPolicyBatchResult = { reachedTimeLimit: boolean };
type OpponentPolicyBatchMessage =
  | {
      progress: { completed: number; total: number };
      update: OpponentPolicyUpdate;
    }
  | { result: OpponentPolicyBatchResult };

const POLICY_BATCH_BUDGET_MS = 45_000;

export type PracticeRequest =
  | { kind: "exchange"; dictionaryId: string; exchange: ExchangeRequest }
  | {
      kind: "optimal-exchange";
      dictionaryId: string;
      exchange: OptimalExchangeRequest;
      workerLimit?: number;
    }
  | {
      kind: "exchange-advice";
      dictionaryId: string;
      exchange: ExchangeAdviceRequest;
    }
  | {
      kind: "opponent-policy";
      dictionaryId: string;
      input: OpponentPolicyInput;
    }
  | {
      kind: "opponent-policy-timeline";
      dictionaryId: string;
      turns: PolicyReviewJob[];
      workerLimit?: number;
    }
  | { kind: "turn" | "game"; template: BoardTemplate; turns: ReviewJob[] };

export type OpponentPolicyMessage =
  | { result: OpponentPolicyResult }
  | { error: string };

export type ExchangeAdviceMessage =
  | { result: ExchangeAdvice | undefined }
  | { error: string };

export type OptimalExchangeMessage =
  | { result: OptimalExchangeResult }
  | { progress: { completed: number; total: number } }
  | { error: string };

self.onmessage = async ({ data }: MessageEvent<PracticeRequest>) => {
  const dictionaries = new Map<string, Lexicon>();
  async function loadWords(id: string) {
    const response = await fetch(`/api/dictionaries/${encodeURIComponent(id)}`);
    if (!response.ok)
      throw new Error("Could not load the word list for this position.");
    return parseWords(await response.text());
  }
  async function dictionary(id: string) {
    const cached = dictionaries.get(id);
    if (cached) return cached;
    const lexicon = new Lexicon(await loadWords(id));
    dictionaries.set(id, lexicon);
    return lexicon;
  }
  const progress = (completed: number, total: number) =>
    self.postMessage({ progress: { completed, total } });
  try {
    if (data.kind === "optimal-exchange") {
      const words = await loadWords(data.dictionaryId);
      const result = await parallelOptimalExchange(
        new Lexicon(words),
        new RackBingoIndex(words),
        data.exchange,
        (completed, total) =>
          self.postMessage({
            progress: { completed, total },
          } satisfies OptimalExchangeMessage),
        data.workerLimit ?? computeWorkerLimit(),
      );
      self.postMessage({ result } satisfies OptimalExchangeMessage);
      return;
    }
    if (data.kind === "exchange-advice") {
      const lexicon = await dictionary(data.dictionaryId);
      self.postMessage({
        result: recommendExchange(lexicon, data.exchange),
      } satisfies ExchangeAdviceMessage);
      return;
    }
    if (data.kind === "exchange") {
      const lexicon = await dictionary(data.dictionaryId);
      self.postMessage({
        result: simulateExchange(lexicon, data.exchange, progress),
      });
      return;
    }
    if (data.kind === "opponent-policy") {
      const lexicon = await dictionary(data.dictionaryId);
      self.postMessage({
        result: analyzeOpponentPolicy(lexicon, data.input),
      } satisfies OpponentPolicyMessage);
      return;
    }
    if (data.kind === "opponent-policy-timeline") {
      const lexicon = await dictionary(data.dictionaryId);
      const deadline =
        performance.timeOrigin + performance.now() + POLICY_BATCH_BUDGET_MS;
      let completed = 0;
      await runCandidateJobs(
        lexicon,
        data.turns.map(({ key, input }) => ({
          kind: "policy-turn",
          key,
          input,
          deadline,
        })),
        (job, result) => {
          if (job.kind !== "policy-turn" || result.kind !== "policy-turn")
            throw new Error(
              result.kind === "error"
                ? result.message
                : "Unexpected policy analysis result.",
            );
          if (!result.policy) return;
          self.postMessage({
            progress: { completed: ++completed, total: data.turns.length },
            update: { key: job.key, result: result.policy },
          } satisfies OpponentPolicyBatchMessage);
        },
        data.workerLimit,
      );
      self.postMessage({
        result: { reachedTimeLimit: completed < data.turns.length },
      } satisfies OpponentPolicyBatchMessage);
      return;
    }
    const opportunities: ReviewSummary["opportunities"] = [];
    let checked = 0;
    const deadline = performance.now() + 10000;
    let defensiveChecks = 0;
    for (const [i, turn] of data.turns.entries()) {
      const template = turn.position.premiums
        ? { ...data.template, premiums: turn.position.premiums }
        : data.template;
      if (data.kind === "game" && performance.now() >= deadline) break;
      try {
        const lexicon = await dictionary(turn.position.dictionaryId);
        const moves = reviewTurn(
          lexicon,
          turn.position,
          template,
          data.kind === "game"
            ? Math.min(450, Math.max(1, deadline - performance.now()))
            : undefined,
        );
        if (data.kind === "turn") {
          self.postMessage({ result: moves.slice(0, 30) });
          return;
        }
        checked++;
        const opportunity = reviewOpportunity(
          moves,
          turn.move,
          template,
          turn.position.tiles.length,
        );
        const id = turn.position.tiles
          .map(({ index, letter }) => `${index}:${letter}`)
          .sort()
          .join(",");
        const played = moves.find((move) => move.id === id);
        const alternative = moves.find(
          (move) => move.id !== id && move.score >= turn.move.score - 5,
        );
        let replyRisk;
        if (
          played &&
          alternative &&
          defensiveChecks < 5 &&
          deadline - performance.now() > 1000
        ) {
          defensiveChecks++;
          try {
            replyRisk = reviewReplyRisk(
              lexicon,
              turn.position,
              template,
              played,
              alternative,
            );
          } catch {
            /* An unavailable forecast does not invalidate the score comparison. */
          }
        }
        if (opportunity.gap >= 8 || opportunity.bingo || replyRisk)
          opportunities.push({
            ...opportunity,
            index: turn.index,
            word: turn.move.word,
            score: turn.move.score,
            replyRisk,
          });
      } catch (error) {
        if (data.kind === "turn") throw error;
      }
      progress(i + 1, data.turns.length);
    }
    opportunities.sort(
      (a, b) =>
        Number(!!b.bingo) - Number(!!a.bingo) ||
        b.gap - a.gap ||
        Number(!!b.replyRisk) - Number(!!a.replyRisk),
    );
    self.postMessage({
      result: {
        checked,
        total: data.turns.length,
        opportunities: opportunities.slice(0, 3),
      },
    });
  } catch (error) {
    self.postMessage({ error: (error as Error).message });
  }
};
