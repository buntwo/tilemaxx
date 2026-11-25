import {
  samplePlayerExchange,
  screenPlayerExchange,
  type PlayerExchangeAdvice,
  type PlayerExchangePosition,
} from "../shared/player-exchange";
import { createPlayerProfiles } from "../shared/player-profiles";
import { loadWordFrequencies } from "./word-frequencies";
import { dictionaryText } from "./word-list-cache";
import { Lexicon, parseWords } from "../shared/lexicon";
import { RackBingoIndex } from "../shared/bingo-odds";
import type {
  OptimalExchangeRequest,
  OptimalExchangeResult,
  ExchangeProgress,
} from "../shared/optimal-exchange";
import { simulateExchange, type ExchangeRequest } from "../shared/exchange";
import {
  recommendExchange,
  type ExchangeAdvice,
  type ExchangeAdviceRequest,
} from "../shared/exchange-advice";
import {
  reviewGame,
  type ReviewJob,
  reviewTurn,
} from "../shared/turn-review";
import {
  analyzeOpponentPolicy,
  type OpponentPolicyInput,
  type OpponentPolicyResult,
} from "../shared/opponent-policy";
import type { BoardTemplate } from "../shared/model";
import { runCandidateJobs } from "./candidate-analysis-pool";
import { computeWorkerLimit } from "./compute-workers";
import { parallelOptimalExchange } from "./parallel-exchange";
import { analyzeMoveStrength, type MoveStrengthResult, type MoveStrengthTurn } from "../shared/move-strength";

type PolicyReviewJob = {
  key: string;
  dictionaryId: string;
  input: OpponentPolicyInput;
};
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
const POLICY_RETRY_BUDGET_MS = 15_000;

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
  | { kind: "style-exchange"; dictionaryId: string; exchange: PlayerExchangePosition }
  | {
      kind: "opponent-policy";
      dictionaryId: string;
      input: OpponentPolicyInput;
      refine?: boolean;
    }
  | {
      kind: "opponent-policy-timeline";
      turns: PolicyReviewJob[];
      workerLimit?: number;
    }
  | { kind: "turn" | "game"; template: BoardTemplate; turns: ReviewJob[]; solo?: true }
  | { kind: "move-strength"; dictionaryId: string; template: BoardTemplate; turns: MoveStrengthTurn[] };

export type OpponentPolicyMessage =
  | { result: OpponentPolicyResult }
  | { error: string };

export type StyleExchangeMessage = { result?: PlayerExchangeAdvice } | { error: string };

export type ExchangeAdviceMessage =
  | { result: ExchangeAdvice | undefined }
  | { error: string };

export type OptimalExchangeMessage =
  | { result: OptimalExchangeResult }
  | { progress: ExchangeProgress }
  | { error: string };

self.onmessage = async ({ data }: MessageEvent<PracticeRequest>) => {
  const dictionaries = new Map<string, Lexicon>();
  async function loadWords(id: string) {
    return parseWords(await dictionaryText(id));
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
        (progress) =>
          self.postMessage({
            progress,
          } satisfies OptimalExchangeMessage),
        data.workerLimit ?? computeWorkerLimit(),
      );
      self.postMessage({ result } satisfies OptimalExchangeMessage);
      return;
    }
    if (data.kind === "style-exchange") {
      const { comparison, advice } = screenPlayerExchange(data.exchange);
      if (comparison) {
        const [lexicon, frequencies] = await Promise.all([
          dictionary(data.dictionaryId),
          loadWordFrequencies(data.exchange.template.rules),
        ]);
        const choose = createPlayerProfiles(lexicon, data.exchange.template, frequencies);
        const sampled = samplePlayerExchange(lexicon, choose, comparison);
        self.postMessage({ result: sampled ? sampled.advice : advice } satisfies StyleExchangeMessage);
      } else {
        self.postMessage({ result: advice } satisfies StyleExchangeMessage);
      }
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
        result: analyzeOpponentPolicy(lexicon, data.input, {
          maxMs: data.refine ? POLICY_RETRY_BUDGET_MS : undefined,
        }),
      } satisfies OpponentPolicyMessage);
      return;
    }
    if (data.kind === "opponent-policy-timeline") {
      const deadline =
        performance.timeOrigin + performance.now() + POLICY_BATCH_BUDGET_MS;
      const groups = new Map<string, PolicyReviewJob[]>();
      for (const turn of data.turns) {
        const group = groups.get(turn.dictionaryId);
        if (group) group.push(turn);
        else groups.set(turn.dictionaryId, [turn]);
      }
      const total = data.turns.length;
      let completed = 0;
      function publish(key: string, result: OpponentPolicyResult) {
        self.postMessage({
          progress: { completed: ++completed, total },
          update: { key, result },
        } satisfies OpponentPolicyBatchMessage);
      }
      for (const [dictionaryId, turns] of groups) {
        if (performance.timeOrigin + performance.now() >= deadline) break;
        let lexicon: Lexicon;
        try {
          lexicon = await dictionary(dictionaryId);
        } catch {
          for (const { key } of turns)
            publish(key, {
              kind: "unavailable",
              reason: "Could not load the word list recorded for this turn.",
            });
          continue;
        }
        if (performance.timeOrigin + performance.now() >= deadline) break;
        await runCandidateJobs(
          lexicon,
          turns.map(({ key, input }) => ({
            kind: "policy-turn",
            key,
            input,
            deadline,
          })),
          (job, result) => {
            if (result.kind !== "policy-turn")
              throw new Error(
                result.kind === "error"
                  ? result.message
                  : "Unexpected policy analysis result.",
              );
            if (result.policy) publish(job.key, result.policy);
          },
          data.workerLimit,
        );
      }
      self.postMessage({
        result: { reachedTimeLimit: completed < total },
      } satisfies OpponentPolicyBatchMessage);
      return;
    }
    if (data.kind === "move-strength") {
      const lexicon = await dictionary(data.dictionaryId);
      self.postMessage({
        result: analyzeMoveStrength(lexicon, data.turns, data.template),
      } satisfies { result: MoveStrengthResult });
      return;
    }
    if (data.kind === "turn") {
      const turn = data.turns[0];
      if (!turn) throw new Error("No review position is available.");
      const template = turn.position.premiums
        ? { ...data.template, premiums: turn.position.premiums }
        : data.template;
      const lexicon = await dictionary(turn.position.dictionaryId);
      self.postMessage({ result: reviewTurn(lexicon, turn.position, template).slice(0, 30) });
    } else {
      const result = await reviewGame(data.turns, data.template, dictionary, data.solo, progress);
      self.postMessage({ result });
    }
  } catch (error) {
    self.postMessage({ error: (error as Error).message });
  }
};
