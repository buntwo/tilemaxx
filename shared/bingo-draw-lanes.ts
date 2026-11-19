import { type Lexicon, popcount } from "./lexicon";
import type { Move, Placement } from "./model";

export type BingoTarget = Pick<Move, "word" | "score" | "row" | "col" | "direction" | "tiles">;

type Direction = {
  direction: Move["direction"];
  step: number;
  starts: { line: number; position: number; cell: number }[];
  mask: Int32Array;
  crossScore: Uint8Array;
  prefix: string[];
  suffix: string[];
};

type Geometry = {
  letters: readonly string[];
  points: Uint8Array;
  anchors: Uint8Array;
  directions: Direction[];
};

type Layout = {
  size: number;
  bingoCounts: boolean[];
  bonuses: Uint16Array | number[];
  lm: Uint8Array;
  wm: Uint8Array;
  letterPoints: Uint8Array;
};

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ?";
const ALL = (1 << 26) - 1;
const MAX_LANES = 10;
const NODES_PER_LANE = 4_000;

/** Search a few premium windows directly in the solver's indexed dictionary. */
export function searchBingoDrawLanes(
  lexicon: Lexicon,
  { letters, points, anchors, directions }: Geometry,
  { size, bingoCounts, bonuses, lm, wm, letterPoints }: Layout,
  leave: string,
  pool: readonly string[],
  drawSize: number,
  deadline: number,
) {
  const placed = leave.length + drawSize;
  if (!bingoCounts[placed]) return;
  type Lane = { geometry: Direction; start: number; length: number; multiplier: number; priority: number };
  const lanes: Lane[] = [];
  for (const geometry of directions) {
    const { step, mask } = geometry;
    for (const { cell: start, position } of geometry.starts) {
      let holes = 0, multiplier = 1, letterFactors = 0, existing = 0;
      let connected = false;
      for (let offset = 0; position + offset < size; offset++) {
        const cell = start + offset * step;
        if (letters[cell]) {
          existing += points[cell];
          connected = true;
        } else {
          if (++holes > placed || !mask[cell]) break;
          connected ||= !!anchors[cell];
          multiplier *= wm[cell];
          letterFactors += lm[cell];
        }
        if (holes !== placed || !connected || multiplier < 2) continue;
        if (position + offset + 1 < size && letters[cell + step]) continue;
        lanes.push({
          geometry, start, length: offset + 1, multiplier,
          priority: multiplier * (existing + 4 * letterFactors),
        });
      }
    }
  }
  lanes.sort((a, b) => b.priority - a.priority);
  const kept = new Uint8Array(27);
  const unseen = new Uint16Array(27);
  for (const tile of leave) kept[LETTERS.indexOf(tile)]++;
  for (const tile of pool) unseen[LETTERS.indexOf(tile)]++;
  let available = 0;
  for (let code = 0; code < 26; code++) {
    if (kept[code] || unseen[code]) available |= 1 << code;
  }
  let best: { draw: string; bingo: BingoTarget } | undefined;
  const draw: string[] = [], tiles: Placement[] = [], word: string[] = [];
  for (const { geometry, start, length, multiplier } of lanes.slice(0, MAX_LANES)) {
    if (performance.now() >= deadline) break;
    const { direction, mask, step, prefix, suffix, crossScore } = geometry;
    let nodes = 0;
    function walk(offset: number, node: number, lettersAvailable: number, sum: number, crosses: number) {
      if (++nodes > NODES_PER_LANE || ((nodes & 127) === 0 && performance.now() >= deadline)) return;
      if (lexicon.maxTail[node] < length - offset) return;
      if (offset === length) {
        const score = sum * multiplier + crosses + bonuses[placed];
        if (lexicon.terminal[node] && draw.length === drawSize && score > (best?.bingo.score ?? 0)) {
          best = {
            draw: draw.slice().sort().join(""),
            bingo: {
              word: word.slice(0, length).join(""), score, row: Math.floor(start / size),
              col: start % size, direction, tiles: tiles.slice(),
            },
          };
        }
        return;
      }
      const cell = start + offset * step;
      const existing = letters[cell];
      if (existing) {
        const child = lexicon.child(node, existing.charCodeAt(0) - 65);
        if (child) {
          word[offset] = existing;
          walk(offset + 1, child, lettersAvailable, sum + points[cell], crosses);
        }
        return;
      }
      const all = lexicon.mask[node];
      const hasCross = !!(prefix[cell] || suffix[cell]);
      for (let bits = all & mask[cell] & (kept[26] || unseen[26] ? ALL : lettersAvailable); bits; bits &= bits - 1) {
        const bit = bits & -bits;
        const code = 31 - Math.clz32(bit);
        const child = lexicon.first[node] + popcount(all >>> (code + 1));
        word[offset] = LETTERS[code];
        if (lettersAvailable & bit) place(code, code);
        if (kept[26] || unseen[26]) place(code, 26);

        function place(letter: number, physical: number) {
          const source = kept[physical] ? kept : draw.length < drawSize ? unseen : undefined;
          if (!source?.[physical]) return;
          source[physical]--;
          if (source === unseen) draw.push(LETTERS[physical]);
          const letterPointsOnBoard = physical === 26 ? 0 : letterPoints[letter] * lm[cell];
          tiles.push({ index: cell, letter: physical === 26 ? LETTERS[letter].toLowerCase() : LETTERS[letter] });
          const next = kept[physical] || unseen[physical] ? lettersAvailable : lettersAvailable & ~(1 << physical);
          walk(
            offset + 1, child, next, sum + letterPointsOnBoard,
            crosses + (hasCross ? (crossScore[cell] + letterPointsOnBoard) * wm[cell] : 0),
          );
          tiles.pop();
          if (source === unseen) draw.pop();
          source[physical]++;
        }
      }
    }
    walk(0, 0, available, 0, 0);
  }
  return best;
}
