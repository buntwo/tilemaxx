import type { Move } from "../shared/model";

export type SolverStages = {
  dictionary?: number;
  moves: number;
  indexing: number;
  premiumReplies?: number;
  bingoDraws?: number;
  boardBingo?: number;
  exchangeAdvice?: number;
};

export type ExactLineTiming = {
  move: Pick<Move, "id" | "word" | "row" | "col" | "direction">;
  elapsed: number;
  limit?: string;
};

export type EndgameBatchTiming = {
  checked: number;
  elapsed: number;
};

export type OpponentEndgameTiming = {
  total: number;
  batches: EndgameBatchTiming[];
};

export type MoveTiming = {
  total: number;
  solver: SolverStages;
  replies?: { elapsed: number; endgame: boolean };
  estimates?: number;
  exactLines?: { elapsed: number; attempts: ExactLineTiming[] };
};
