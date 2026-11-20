export const BINGO_STYLES = ["bingo-hunter", "tactician"] as const;
export type BingoStyle = (typeof BINGO_STYLES)[number];

export const BINGO_STYLE_LABELS: Record<BingoStyle, string> = {
  "bingo-hunter": "Bingo Mercenary",
  tactician: "Bingo Tactician",
};

export function isBingoStyle(style?: string): style is BingoStyle {
  return style === "bingo-hunter" || style === "tactician";
}
