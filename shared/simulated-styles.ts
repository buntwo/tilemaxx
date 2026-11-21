export const SIMULATED_STYLES = [
  "bingo-hunter",
  "tactician",
  "master",
] as const;
export type SimulatedStyle = (typeof SIMULATED_STYLES)[number];

export const SIMULATED_STYLE_LABELS: Record<SimulatedStyle, string> = {
  "bingo-hunter": "Bingo Mercenary",
  tactician: "Bingo Tactician",
  master: "Master",
};

export function isSimulatedStyle(style?: string): style is SimulatedStyle {
  return SIMULATED_STYLES.some((candidate) => candidate === style);
}
