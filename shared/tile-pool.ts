import { tileScore, type BoardTemplate, type Position } from "./model";

export const TILE_SYMBOLS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ?"];
export const MAX_TILE_COUNT = 999;
const vowels = "AEIOU";
const distributions = {
  scrabble: [
    9, 2, 2, 4, 12, 2, 3, 2, 9, 1, 1, 4, 2, 6, 8, 2, 1, 6, 4, 6, 4, 2, 2, 1, 2,
    1, 2,
  ],
  wwf: [
    9, 2, 2, 5, 13, 2, 3, 4, 8, 1, 1, 4, 2, 5, 8, 2, 1, 6, 5, 7, 4, 2, 2, 1, 2,
    1, 2,
  ],
  super: [
    16, 4, 6, 8, 24, 4, 5, 5, 13, 2, 2, 7, 6, 13, 15, 4, 2, 13, 10, 15, 7, 3, 4,
    2, 4, 2, 4,
  ],
};

export function getTileCounts(
  template: Pick<BoardTemplate, "id" | "rules" | "tileCounts">,
) {
  if (template.tileCounts) return template.tileCounts;
  const counts =
    distributions[template.id === "super" ? "super" : template.rules];
  return Object.fromEntries(
    TILE_SYMBOLS.map((symbol, i) => [symbol, counts[i]]),
  );
}

export function unseenTiles(
  { board, rack }: Position,
  template: BoardTemplate,
) {
  const starting = getTileCounts(template);
  const used: Record<string, number> = {};
  for (const tile of [...board, ...rack]) {
    if (!tile || tile === ".") continue;
    const symbol = tile === tile.toUpperCase() ? tile : "?";
    used[symbol] = (used[symbol] ?? 0) + 1;
  }
  const tiles = TILE_SYMBOLS.map((symbol) => {
    const difference = starting[symbol] - (used[symbol] ?? 0);
    const kind =
      symbol === "?"
        ? "blank"
        : vowels.includes(symbol)
          ? "vowel"
          : "consonant";
    return {
      symbol,
      count: Math.max(0, difference),
      excess: Math.max(0, -difference),
      kind,
      score: tileScore(symbol, template.rules),
    } as const;
  });
  const totals = { vowel: 0, consonant: 0, blank: 0 };
  for (const tile of tiles) totals[tile.kind] += tile.count;
  return {
    tiles,
    totals,
    total: totals.vowel + totals.consonant + totals.blank,
    excess: tiles.filter((tile) => tile.excess > 0),
  };
}
