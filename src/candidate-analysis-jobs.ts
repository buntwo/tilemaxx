import { createHunterEvaluator, type HunterDeal, type HunterPosition } from "../shared/bingo-hunter";
import { findBingoCeiling, prepareCeilingReplies, type BingoCeiling, type CeilingReply } from "../shared/bingo-ceilings";
import { checkBoardBingoMove, type BoardOdds } from "../shared/bingo-odds";
import { EndgameSearchLimitError, type EndgameLine } from "../shared/endgame";
import type { Lexicon } from "../shared/lexicon";
import type { Board, BoardTemplate, Move } from "../shared/model";
import { checkExchangeRacks } from "../shared/optimal-exchange";
import {
  analyzeOpponentPolicy,
  type OpponentPolicyInput,
  type OpponentPolicyResult,
} from "../shared/opponent-policy";
import {
  opponentEndgameLine,
  REPLY_SUMMARY_TIME_MS,
  createReplyEndgameSession,
  ReplySearchLimitError,
  summarizeReplyBoard,
  type OpponentEndgamePosition,
  type ReplyPosition,
  type ReplySearchLimit,
  type sampleReplyRacks,
} from "../shared/reply-analysis";
import { prepareSolver, SearchLimitError } from "../shared/solver";

type CandidateMove = { position: ReplyPosition; move: Move };
export type CandidateJob =
  | (CandidateMove & {
      kind: "histogram";
      samples: ReturnType<typeof sampleReplyRacks>;
    })
  | {
      kind: "bingo-hunter";
      position: HunterPosition;
      move: Move;
      deals: HunterDeal[];
      beforeReply: boolean;
      deadline: number;
      wavesRemaining: number;
    }
  | {
      kind: "bingo-ceiling";
      position: HunterPosition;
      move: Move;
      pool: string[];
      opponentSize: number;
      scoutReplyOpenings: boolean;
      deadline: number;
    }
  | {
      kind: "bingo-ceiling-replies";
      position: HunterPosition;
      move: Move;
      ceiling: BingoCeiling;
      racks: string[];
      deadline: number;
    }
  | (CandidateMove & { kind: "endgame"; timeLimitMs?: 5_000 | 10_000 })
  | {
      kind: "opponent-endgame";
      position: OpponentEndgamePosition;
      move: Move | null;
      deadline: number;
      minimumSpread?: number;
    }
  | {
      kind: "board-bingo";
      board: Board;
      template: BoardTemplate;
      move: Move;
      draws: Parameters<typeof checkBoardBingoMove>[4];
      deadline: number;
      wavesRemaining: number;
    }
  | {
      kind: "exchange-racks";
      position: { board: Board; template: BoardTemplate };
      racks: string[];
      offset: number;
      deadline: number;
    }
  | {
      kind: "policy-turn";
      key: string;
      input: OpponentPolicyInput;
      deadline: number;
    };

export type CandidateResult =
  | { kind: "histogram"; board: ReturnType<typeof summarizeReplyBoard> }
  | { kind: "bingo-hunter"; outcomes: number[]; blocked?: boolean }
  | { kind: "bingo-ceiling"; ceiling?: BingoCeiling }
  | { kind: "bingo-ceiling-replies"; replies: CeilingReply[]; blocked?: boolean }
  | { kind: "endgame"; line: EndgameLine; elapsed: number }
  | { kind: "opponent-endgame"; line?: EndgameLine }
  | { kind: "board-bingo"; odds?: BoardOdds }
  | { kind: "exchange-racks"; hits: ReturnType<typeof checkExchangeRacks> }
  | { kind: "policy-turn"; policy?: OpponentPolicyResult }
  | {
      kind: "limit";
      message: string;
      elapsed: number;
      replyLimit?: ReplySearchLimit;
    }
  | { kind: "error"; message: string };

export type CandidateRequest = {
  job: CandidateJob;
  dictionary?: Parameters<typeof Lexicon.fromIndex>[0];
};

export const POLICY_TURN_BUDGET_MS = 1_250;

export function createCandidateAnalyzer(lexicon: Lexicon) {
  // One immutable endgame position stays on this lane across bounded slices.
  let endgame:
    | { key: string; session: ReturnType<typeof createReplyEndgameSession> }
    | undefined;
  // Reuse prepared boards across deals for the current candidate.
  let hunter: { key: string; evaluate: ReturnType<typeof createHunterEvaluator> } | undefined;
  // An Optimal Exchange pool checks one immutable board across both phases.
  let exchangeSolver: ReturnType<typeof prepareSolver> | undefined;
  return (job: CandidateJob): CandidateResult => {
    const started = performance.now();
    try {
      switch (job.kind) {
        case "bingo-hunter": {
          const deadline = started + (job.deadline - performance.timeOrigin - started) / job.wavesRemaining;
          const outcomes: number[] = [];
          if (deadline <= started) return { kind: "bingo-hunter", outcomes };
          const key = job.move.id;
          if (hunter?.key !== key)
            hunter = { key, evaluate: createHunterEvaluator(lexicon, job.position, job.move) };
          for (const deal of job.deals) {
            if (performance.now() >= deadline) break;
            try {
              outcomes.push(hunter.evaluate(deal, job.beforeReply, deadline));
            } catch (error) {
              if (error instanceof SearchLimitError) {
                if (error.reason === "nodes" || error.reason === "moves")
                  return { kind: "bingo-hunter", outcomes, blocked: true };
                break;
              }
              throw error;
            }
          }
          return { kind: "bingo-hunter", outcomes };
        }
        case "bingo-ceiling": {
          const deadline = Math.min(started + 350, job.deadline - performance.timeOrigin);
          const ceiling = findBingoCeiling(
            lexicon, job.position, job.move, job.pool,
            job.opponentSize, job.scoutReplyOpenings, deadline,
          );
          return { kind: job.kind, ceiling };
        }
        case "bingo-ceiling-replies": {
          const evaluate = prepareCeilingReplies(lexicon, job.position, job.move, job.ceiling);
          const deadline = job.deadline - performance.timeOrigin;
          const replies: CeilingReply[] = [];
          for (const rack of job.racks) {
            if (performance.now() >= deadline) break;
            try {
              replies.push(evaluate(rack, deadline));
            } catch (error) {
              if (!(error instanceof SearchLimitError)) throw error;
              return { kind: job.kind, replies, blocked: error.reason !== "time" };
            }
          }
          return { kind: job.kind, replies };
        }
        case "histogram":
          return {
            kind: "histogram",
            board: summarizeReplyBoard(
              lexicon,
              job.position,
              job.move,
              job.samples,
              () => started + REPLY_SUMMARY_TIME_MS,
            ),
          };
        case "endgame": {
          const key = JSON.stringify(job.position);
          if (endgame?.key !== key)
            endgame = {
              key,
              session: createReplyEndgameSession(lexicon, job.position),
            };
          const timeLimitMs = job.timeLimitMs ?? 5_000;
          const remaining = Math.max(
            0,
            timeLimitMs - (performance.now() - started),
          );
          const line = endgame.session.run(job.move, remaining);
          return {
            kind: "endgame",
            line,
            elapsed: performance.now() - started,
          };
        }
        case "opponent-endgame": {
          const remaining = job.deadline - performance.timeOrigin - started;
          if (remaining <= 0)
            return {
              kind: "limit",
              message: "The opponent endgame reached its time limit.",
              elapsed: 0,
            };
          return {
            kind: "opponent-endgame",
            line: opponentEndgameLine(
              lexicon,
              job.position,
              job.move,
              Math.min(5_000, remaining),
              job.minimumSpread,
            ),
          };
        }
        case "board-bingo": {
          const remaining = job.deadline - performance.timeOrigin - started;
          const until = started + remaining / job.wavesRemaining;
          const odds =
            job.draws && until <= started
              ? undefined
              : checkBoardBingoMove(
                  lexicon,
                  job.board,
                  job.template,
                  job.move,
                  job.draws,
                  until,
                );
          return { kind: "board-bingo", odds };
        }
        case "exchange-racks":
          exchangeSolver ??= prepareSolver(
            lexicon,
            job.position.board,
            job.position.template,
          );
          return {
            kind: "exchange-racks",
            hits: checkExchangeRacks(
              exchangeSolver,
              job.racks,
              job.deadline - performance.timeOrigin,
            ),
          };
        case "policy-turn": {
          const maxMs = Math.min(
            POLICY_TURN_BUDGET_MS,
            job.deadline - performance.timeOrigin - started,
          );
          const policy =
            maxMs > 0
              ? analyzeOpponentPolicy(lexicon, job.input, { maxMs })
              : undefined;
          return { kind: "policy-turn", policy };
        }
      }
    } catch (error) {
      const elapsed = performance.now() - started;
      if (error instanceof ReplySearchLimitError)
        return {
          kind: "limit",
          message: error.message,
          elapsed,
          replyLimit: error.limit,
        };
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
        return { kind: "limit", message, elapsed };
      return { kind: "error", message };
    }
  };
}
