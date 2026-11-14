import type { BoardOddsResult, RackOdds } from "../shared/bingo-odds";
import type { BoardTemplate, Move, Position } from "../shared/model";
import type {
  MovePage,
  MoveQuery,
  MoveResults,
  ShortlistOptions,
} from "../shared/move-results";
import type { ShortlistEntry } from "../shared/move-shortlist";
import type { DefenseResults } from "../shared/premium-defense";
import type { ExchangeAdviceRequest } from "../shared/exchange-advice";

type PositionRequest = Position & {
  id: number;
  dictionaryId: string;
  template: BoardTemplate;
};
export type SolverRequest =
  | (PositionRequest & { kind: "solve" })
  | (PositionRequest & {
      kind: "board-odds";
      candidates: Move[];
      bagSize: number;
    })
  | { kind: "page"; id: number; searchId: number; query: MoveQuery }
  | {
      kind: "shortlist";
      id: number;
      searchId: number;
      options: ShortlistOptions;
    }
  | { kind: "discard"; searchId: number }
  | { kind: "cancel"; searchId: number };

type SolverUpdate =
  | {
      kind: "moves";
      results: MoveResults;
      warnings: string[];
      elapsed: number;
      exchange?: ExchangeAdviceRequest & { dictionaryId: string };
    }
  | { kind: "solve-status"; status: string }
  | { kind: "solve-error"; error: string }
  | { kind: "defense"; defense?: DefenseResults; done?: boolean }
  | { kind: "defense-progress"; checked: number }
  | { kind: "rack-odds"; odds: RackOdds }
  | { kind: "board-odds-progress"; checked: number }
  | { kind: "board-odds"; odds?: BoardOddsResult; error?: string };

export type SolverMessage =
  | (SolverUpdate & { id: number })
  | { kind: "page"; id: number; page?: MovePage }
  | { kind: "shortlist"; id: number; shortlist?: ShortlistEntry[] };
