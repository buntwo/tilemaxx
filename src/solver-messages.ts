import type { BingoStyle } from "../shared/bingo-styles";
import type { HunterProgress, HunterSummary } from "./parallel-bingo-hunter";
import type { BoardOdds, BoardOddsResult, RackOdds } from "../shared/bingo-odds";
import type { BoardTemplate, Move, Position } from "../shared/model";
import type {
  EndgameRanking,
  MovePage,
  MoveQuery,
  MoveResults,
  ShortlistOptions,
} from "../shared/move-results";
import type { ShortlistEntry } from "../shared/move-shortlist";
import type { DefenseResults } from "../shared/premium-defense";
import type { ExchangeAdviceRequest } from "../shared/exchange-advice";
import type { EndgameSettings } from "../shared/endgame";
import type { SolverStages } from "./move-timing";
import type { ReplyCandidate } from "../shared/reply-candidates";

type PositionRequest = Position & {
  id: number;
  dictionaryId: string;
  template: BoardTemplate;
};
export type HunterOptions = EndgameSettings & { bagSize: number; workerLimit: number; style?: BingoStyle; resumeFrom?: number };

export type SolverRequest =
  | ({ kind: "bingo-hunter"; id: number; searchId: number } & HunterOptions)
  | { kind: "cancel-bingo-hunter"; id: number }
  | (PositionRequest & { kind: "solve" })
  | (PositionRequest & {
      kind: "board-odds";
      candidates: Move[];
      bagSize: number;
      workerLimit?: number;
    })
  | (PositionRequest & EndgameSettings & {
      kind: "endgame";
      searchId: number;
    })
  | { kind: "page"; id: number; searchId: number; query: MoveQuery }
  | {
      kind: "shortlist";
      id: number;
      searchId: number;
      options: ShortlistOptions;
    }
  | { kind: "discard"; searchId: number }
  | { kind: "cancel"; searchId: number }
  | { kind: "cancel-endgame"; id: number };

type SolverUpdate =
  | {
      kind: "moves";
      results: MoveResults;
      warnings: string[];
      stages: Pick<SolverStages, "dictionary" | "moves" | "indexing">;
      exchange?: ExchangeAdviceRequest & { dictionaryId: string };
      replyCandidatesPending?: boolean;
    }
  | { kind: "solve-status"; status: string }
  | { kind: "solve-error"; error: string }
  | {
      kind: "defense";
      defense?: DefenseResults;
      elapsed?: number;
      replyCandidates?: ReplyCandidate[];
    }
  | { kind: "defense-progress"; checked: number }
  | { kind: "rack-odds"; odds: RackOdds; elapsed: number }
  | {
      kind: "board-odds-progress";
      checked: number;
      moveId: string;
      odds: BoardOdds;
    }
  | { kind: "board-odds"; odds?: BoardOddsResult; error?: string };

export type SolverMessage =
  | { kind: "bingo-hunter"; id: number; summary?: HunterSummary; error?: string }
  | { kind: "bingo-hunter-progress"; id: number; progress: HunterProgress }
  | (SolverUpdate & { id: number })
  | { kind: "page"; id: number; page?: MovePage }
  | { kind: "shortlist"; id: number; shortlist?: ShortlistEntry[] }
  | { kind: "endgame"; id: number; ranking?: EndgameRanking };
