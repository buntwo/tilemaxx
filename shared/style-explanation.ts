import { ORDINARY_FOLLOW_UP_WEIGHT } from "./bingo-hunter";
import type { Move } from "./model";
import type { MoveStyle, MoveUtility } from "./move-results";
import type { PlayerExchangeAdvice } from "./player-exchange";

export const STYLE_FACTORS = [
  "Weighted points", "Play points now", "Premium squares", "Rack leave",
  "Premium lane risk", "Defense", "Going out", "Endgame lookahead",
  "Lookahead adjustment", "Expected opponent reply", "Expected follow-up",
  "Rack leave difference", "Final rack adjustments", "Expected bingo points next turn",
  "Bingo lanes after reply", "Expected points two turns ahead", "Next-turn bingo chance",
  "Highest bingo found", "Visibility weight", "Appeal multiplier", "Expected exchange edge",
] as const;

export type StyleFactor = typeof STYLE_FACTORS[number];
export type StyleEvaluation = {
  factors: Partial<Record<StyleFactor, number>>;
  rank?: number;
  total?: number;
  modeledReply?: number;
  modeledFollowUp?: number;
  samples?: number;
  exact?: boolean;
  selection?: "winning-rack-out" | "known-rack";
};

export type StylePlacement = Pick<Move, "word" | "row" | "col" | "direction" | "score" | "tiles" | "leave">;
export type StyleCandidate = { move: StylePlacement; evaluation: StyleEvaluation };

type Explanation = { style: MoveStyle; alternative?: StyleCandidate; provisional?: boolean };
export type StyleExplanation = Explanation & (
  | { kind: "play"; played: StyleCandidate; recommended: boolean; preferred?: "pass" | "exchange" }
  | { kind: "exchange"; tiles: string; problem: PlayerExchangeAdvice["problem"]; edge?: number }
  | { kind: "pass"; evaluation?: StyleEvaluation }
);

export function stylePlacement({ word, row, col, direction, score, tiles, leave }: StylePlacement): StylePlacement {
  return { word, row, col, direction, score, tiles, leave };
}

export function styleEvaluation(utility: MoveUtility): StyleEvaluation {
  const { rank, total } = utility;
  let evaluation: StyleEvaluation;
  if ("visibility" in utility) {
    const { points, premium, leave, goingOut, defense, premiumLane, endgame,
      lookahead, visibility, appeal, modeledReply, modeledFollowUp, lookaheadDeals, selection } = utility;
    evaluation = {
      rank, total, modeledReply, modeledFollowUp, samples: lookaheadDeals, selection,
      factors: {
        "Weighted points": points,
        "Premium squares": premium || undefined,
        "Rack leave": leave,
        "Premium lane risk": premiumLane,
        Defense: defense,
        "Going out": goingOut || undefined,
        "Endgame lookahead": endgame,
        "Lookahead adjustment": lookahead,
        "Visibility weight": visibility,
        "Appeal multiplier": appeal,
      },
    };
  } else if ("playPoints" in utility) {
    const { weightedPlayPoints, nextBingoPoints, tactics, bingoChance, highestBingo, samples, exact } = utility;
    evaluation = {
      rank, total, samples, exact, modeledReply: tactics?.replyPoints,
      factors: {
        "Weighted points": weightedPlayPoints,
        "Expected bingo points next turn": nextBingoPoints,
        "Expected opponent reply": tactics ? -tactics.replyPoints : undefined,
        "Expected follow-up": tactics?.ordinaryPoints === undefined
          ? undefined : tactics.ordinaryPoints * ORDINARY_FOLLOW_UP_WEIGHT,
        "Bingo lanes after reply": tactics?.laneBonus,
        "Next-turn bingo chance": bingoChance * 100,
        "Highest bingo found": highestBingo || undefined,
      },
    };
  } else if (utility.kind === "master") {
    const { score, endgame, reply, followUp, leave, rackAdjustment, samples, exactDeals } = utility;
    evaluation = endgame !== undefined ? {
      rank, total, exact: true,
      factors: { "Play points now": score, "Endgame lookahead": endgame - score },
    } : {
      rank, total, samples, exact: exactDeals,
      factors: {
        "Play points now": score, "Expected opponent reply": reply, "Expected follow-up": followUp,
        "Rack leave difference": leave, "Final rack adjustments": rackAdjustment,
      },
    };
  } else {
    evaluation = {
      rank, total: utility.kind === "solo-bingo" ? undefined : total, samples: utility.samples, exact: utility.exact,
      factors: utility.kind === "solo-points" ? {
        "Play points now": utility.score, "Expected follow-up": utility.nextPoints,
        "Expected points two turns ahead": utility.followUpPoints,
      } : {
        "Play points now": utility.score, "Next-turn bingo chance": utility.bingoChance * 100,
        "Expected bingo points next turn": utility.kind === "solo-triple-threat" ? utility.bingoPoints : undefined,
        "Bingo lanes after reply": utility.kind === "solo-triple-threat" ? utility.lanePoints : undefined,
      },
    };
  }
  return {
    ...evaluation,
    factors: Object.fromEntries(Object.entries(evaluation.factors).filter(([, value]) => value !== undefined)),
  };
}

export function styleCandidate(move: StylePlacement, utility: MoveUtility): StyleCandidate {
  return { move: stylePlacement(move), evaluation: styleEvaluation(utility) };
}

export function sameStylePlacement(a: Pick<StylePlacement, "tiles">, b: Pick<StylePlacement, "tiles">) {
  return a.tiles.length === b.tiles.length &&
    a.tiles.every(({ index, letter }) => b.tiles.some((tile) => tile.index === index && tile.letter === letter));
}

export function explainStylePlay(
  style: MoveStyle,
  played: StyleCandidate,
  leaders: readonly StyleCandidate[],
  provisional?: boolean,
): StyleExplanation {
  return {
    kind: "play", style, played, provisional,
    recommended: played.evaluation.rank === 1,
    alternative: leaders.find(({ move }) => !sameStylePlacement(move, played.move)),
  };
}

export function explainStyleExchange(
  advice: PlayerExchangeAdvice,
  rack: string,
  slots: readonly number[],
): StyleExplanation | undefined {
  if (slots.length !== advice.slots.length || !slots.every((slot) => advice.slots.includes(slot))) return;
  return {
    kind: "exchange", style: advice.profile, problem: advice.problem,
    tiles: slots.map((slot) => rack[slot]).join(""), edge: advice.edge,
    alternative: advice.comparedPlacement && {
      move: advice.comparedPlacement,
      evaluation: { factors: {} },
    },
  };
}
