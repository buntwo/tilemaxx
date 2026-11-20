import { tileScore, type BoardTemplate, type Position } from "./model";

export const TILE_SYMBOLS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ?"];
export const MAX_TILE_COUNT = 999;
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - i + 1)) / i;
  return result;
}
const vowels = "AEIOU";
const frenchCounts = [
  9, 2, 2, 3, 15, 2, 2, 2, 8, 1, 1, 5, 3, 6, 6, 2, 1, 6, 6, 6, 6, 2, 1, 1, 1,
  1, 2,
];
const distributions = {
  scrabble: [
    9, 2, 2, 4, 12, 2, 3, 2, 9, 1, 1, 4, 2, 6, 8, 2, 1, 6, 4, 6, 4, 2, 2, 1, 2,
    1, 2,
  ],
  "scrabble-fr": frenchCounts,
  wwf: [
    9, 2, 2, 5, 13, 2, 3, 4, 8, 1, 1, 4, 2, 5, 8, 2, 1, 6, 5, 7, 4, 2, 2, 1, 2,
    1, 2,
  ],
  super: [
    16, 4, 6, 8, 24, 4, 5, 5, 13, 2, 2, 7, 6, 13, 15, 4, 2, 13, 10, 15, 7, 3, 4,
    2, 4, 2, 4,
  ],
  wordfeud: [
    10, 2, 2, 5, 12, 2, 3, 3, 9, 1, 1, 4, 2, 6, 7, 2, 1, 6, 5, 7, 4, 2, 2, 1, 2,
    1, 2,
  ],
  "wordfeud-fr": [
    10, 2, 2, 3, 14, 2, 3, 2, 9, 1, 1, 5, 3, 6, 6, 2, 1, 6, 6, 6, 6, 2, 1, 1,
    1, 1, 2,
  ],
  crossplay: [
    9, 2, 2, 4, 12, 2, 3, 3, 8, 1, 1, 4, 2, 5, 8, 2, 1, 6, 5, 6, 3, 2, 2, 1, 2,
    1, 3,
  ],
  lexulous: [
    8, 2, 2, 3, 11, 2, 2, 2, 8, 1, 1, 3, 2, 5, 7, 2, 1, 5, 3, 5, 3, 2, 2, 1, 3,
    1, 2,
  ],
  "lexulous-fr": frenchCounts,
  "lexulous-it": [
    14, 3, 6, 3, 11, 3, 2, 2, 12, 0, 0, 5, 5, 5, 15, 3, 1, 6, 6, 6, 5, 3, 0, 0,
    0, 2, 2,
  ],
  // Full bag, including the eight grey rack tiles in the reference screenshot.
  "super-lexulous": [
    14, 4, 6, 6, 22, 4, 3, 5, 12, 2, 2, 5, 6, 10, 14, 4, 2, 10, 8, 12, 6, 3, 4,
    2, 6, 2, 4,
  ],
};

export function getTileCounts(
  { id, rules, tileCounts }: Pick<BoardTemplate, "id" | "rules" | "tileCounts">,
) {
  const counts =
    distributions[id === "super" || id === "super-lexulous" ? id : rules];
  if (tileCounts) {
    // Older French Lexulous presets saved eight As with either five or six Ns.
    const legacyFrenchBag =
      id === "lexulous" &&
      rules === "lexulous-fr" &&
      tileCounts.A === 8 &&
      (tileCounts.N === 5 || tileCounts.N === 6) &&
      TILE_SYMBOLS.every(
        (symbol, i) =>
          symbol === "A" || symbol === "N" || tileCounts[symbol] === frenchCounts[i],
      );
    if (!legacyFrenchBag) return tileCounts;
  }
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

/** Chance a random rack drawn without replacement contains a specified multiset. */
export function rackContainsChance(
  unseen: ReturnType<typeof unseenTiles>,
  rackSize: number,
  required: readonly string[],
): number {
  const size = Math.min(rackSize, unseen.total);
  if (required.length > size) return 0;
  const needed = new Map<string, number>();
  for (const symbol of required)
    needed.set(symbol, (needed.get(symbol) ?? 0) + 1);
  const groups = unseen.tiles.filter(({ symbol }) => needed.has(symbol));
  if (groups.length !== needed.size) return 0;
  const others =
    unseen.total - groups.reduce((sum, tile) => sum + tile.count, 0);
  function hands(group: number, remaining: number): number {
    if (group === groups.length) return choose(others, remaining);
    const { symbol, count } = groups[group];
    let total = 0;
    for (let n = needed.get(symbol)!; n <= Math.min(count, remaining); n++)
      total += choose(count, n) * hands(group + 1, remaining - n);
    return total;
  }
  return Math.min(1, hands(0, size) / choose(unseen.total, size));
}
