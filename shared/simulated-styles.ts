export const OPPONENT_SIMULATED_STYLES = [
  "bingo-hunter",
  "tactician",
  "master",
] as const;
export const SOLO_SIMULATED_STYLES = ["greedy-bingo", "triple-play", "triple-threat"] as const;
export const SIMULATED_STYLES = [...OPPONENT_SIMULATED_STYLES, ...SOLO_SIMULATED_STYLES] as const;

export type SoloSimulatedStyle = (typeof SOLO_SIMULATED_STYLES)[number];
export type SimulatedStyle = (typeof SIMULATED_STYLES)[number];

export const SIMULATED_STYLE_LABELS: Record<SimulatedStyle, string> = {
  "bingo-hunter": "Bingo Mercenary",
  tactician: "Bingo Tactician",
  master: "Master",
  "greedy-bingo": "Greedy Bingo",
  "triple-play": "Score Lookahead",
  "triple-threat": "Bingo & Triple Words",
};

export function isSimulatedStyle(style?: string): style is SimulatedStyle {
  return SIMULATED_STYLES.some((candidate) => candidate === style);
}

export function isSoloSimulatedStyle(style?: string): style is SoloSimulatedStyle {
  return SOLO_SIMULATED_STYLES.some((candidate) => candidate === style);
}
