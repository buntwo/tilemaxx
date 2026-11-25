import type { Move } from "../shared/model";
import type { CalculationSpan } from "../shared/move-results";

export const timingNow = () => performance.timeOrigin + performance.now();

export type MoveTimingStage = { label: string; spans: CalculationSpan[] };

function elapsed(spans: CalculationSpan[]) {
  let elapsed = 0, end = -Infinity;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    elapsed += Math.max(0, span.end - Math.max(span.start, end));
    end = Math.max(end, span.end);
  }
  return elapsed;
}

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
  span?: CalculationSpan;
  pageStages?: { label: string; elapsed: number }[];
  solver: SolverStages;
  replies?: { elapsed: number; endgame: boolean };
  estimates?: number;
  exactLines?: { elapsed: number; attempts: ExactLineTiming[] };
};

export type InitialAnalysisTiming = Pick<MoveTiming, "replies" | "estimates" | "exactLines">;

export function moveViewTiming(base: MoveTiming | undefined, stages: MoveTimingStage[]) {
  if (!base || !stages.length) return base;
  const spans = stages.flatMap(({ spans }) => spans);
  return {
    ...base,
    total: base.span ? elapsed([base.span, ...spans]) : base.total + elapsed(spans),
    pageStages: stages.map(({ label, spans }) => ({ label, elapsed: elapsed(spans) })),
  };
}
