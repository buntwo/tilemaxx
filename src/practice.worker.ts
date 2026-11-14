import { Lexicon, parseWords } from "../shared/lexicon";
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
import type { BoardTemplate, TrackedMove, TurnPosition } from "../shared/model";

type ReviewJob = { position: TurnPosition; move: TrackedMove; index: number };
export type PracticeRequest =
  | { kind: "exchange"; dictionaryId: string; exchange: ExchangeRequest }
  | {
      kind: "exchange-advice";
      dictionaryId: string;
      exchange: ExchangeAdviceRequest;
    }
  | { kind: "turn" | "game"; template: BoardTemplate; turns: ReviewJob[] };

export type ExchangeAdviceMessage =
  | { result: ExchangeAdvice | undefined }
  | { error: string };

self.onmessage = async ({ data }: MessageEvent<PracticeRequest>) => {
  const dictionaries = new Map<string, Lexicon>();
  async function dictionary(id: string) {
    const cached = dictionaries.get(id);
    if (cached) return cached;
    const response = await fetch(`/api/dictionaries/${encodeURIComponent(id)}`);
    if (!response.ok)
      throw new Error("Could not load the word list for this position.");
    const lexicon = new Lexicon(parseWords(await response.text()));
    dictionaries.set(id, lexicon);
    return lexicon;
  }
  const progress = (completed: number, total: number) =>
    self.postMessage({ progress: { completed, total } });
  try {
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
    const opportunities: ReviewSummary["opportunities"] = [];
    let checked = 0;
    const deadline = performance.now() + 10000;
    let defensiveChecks = 0;
    for (const [i, turn] of data.turns.entries()) {
      if (data.kind === "game" && performance.now() >= deadline) break;
      try {
        const lexicon = await dictionary(turn.position.dictionaryId);
        const moves = reviewTurn(
          lexicon,
          turn.position,
          data.template,
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
          data.template,
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
              data.template,
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
