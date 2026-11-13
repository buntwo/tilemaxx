import { type BoardTemplate, type Premium } from "./model";
import { getTileCounts } from "./tile-pool";

function board(
  id: string,
  name: string,
  size: number,
  placements: Partial<Record<Premium, number[][]>>,
  rules: "scrabble" | "wwf" = "scrabble",
): BoardTemplate {
  const premiums: Premium[] = Array(size * size).fill("");
  for (const [premium, coordinates] of Object.entries(placements))
    for (const [r, c] of coordinates!)
      premiums[r * size + c] = premium as Premium;
  return {
    id,
    name,
    size,
    premiums,
    start: Math.floor(size / 2) * size + Math.floor(size / 2),
    rackSize: 7,
    bingo: rules === "wwf" ? 35 : 50,
    rules,
    tileCounts: getTileCounts({ id, rules }),
    builtin: true,
  };
}
function reflect(size: number, points: number[][]): number[][] {
  const unique = new Map<string, number[]>();
  for (const [r, c] of points)
    for (const [a, b] of [
      [r, c],
      [c, r],
    ])
      for (const x of [a, size - 1 - a])
        for (const y of [b, size - 1 - b]) unique.set(`${x},${y}`, [x, y]);
  return [...unique.values()];
}
export const PRESETS: BoardTemplate[] = [
  board("scrabble", "Scrabble", 15, {
    TW: reflect(15, [
      [0, 0],
      [0, 7],
    ]),
    DW: reflect(15, [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [7, 7],
    ]),
    TL: reflect(15, [
      [1, 5],
      [5, 5],
    ]),
    DL: reflect(15, [
      [0, 3],
      [2, 6],
      [3, 7],
      [6, 6],
    ]),
  }),
  board(
    "wwf",
    "Words With Friends",
    15,
    {
      TW: reflect(15, [[0, 3]]),
      DW: reflect(15, [
        [1, 7],
        [4, 4],
      ]),
      TL: reflect(15, [
        [0, 6],
        [3, 5],
      ]),
      DL: reflect(15, [
        [1, 2],
        [2, 6],
        [6, 6],
        [5, 7],
      ]),
    },
    "wwf",
  ),
  board("super", "Super Scrabble", 21, {
    QW: reflect(21, [[0, 0]]),
    TW: reflect(21, [
      [0, 7],
      [3, 3],
      [3, 10],
    ]),
    DW: reflect(21, [
      [1, 1],
      [1, 8],
      [2, 2],
      [2, 9],
      [4, 4],
      [5, 5],
      [6, 6],
      [7, 7],
      [10, 10],
    ]),
    QL: reflect(21, [[2, 5]]),
    TL: reflect(21, [
      [1, 4],
      [4, 8],
      [8, 8],
    ]),
    DL: reflect(21, [
      [0, 3],
      [0, 10],
      [3, 6],
      [5, 9],
      [6, 10],
      [9, 9],
    ]),
  }),
];
