import { popcount, type Lexicon } from "./lexicon";
import type { Board, BoardTemplate } from "./model";

const WINDOW_WEIGHT = [0, 0, 0, 0, 0.25, 0.45, 0.65, 1];
const FULL_WEIGHT_BAG = 28;
const NO_WEIGHT_BAG = 7;
const LANE_WEIGHT = 0.1;
const MAX_ADJUSTMENT = 0.125;

type Lane = {
  line: number;
  step: number;
  crossStep: number;
  targets: { cell: number; position: number }[];
};

function createLaneScorer(lexicon: Lexicon, template: BoardTemplate, triples: number[]) {
  const { size } = template;
  const maxTiles = Math.min(template.rackSize, WINDOW_WEIGHT.length - 1);
  const lanes = new Map<number, Lane>();
  for (const cell of triples) {
    const row = Math.floor(cell / size);
    const col = cell % size;
    for (const [axis, line, position, step, crossStep] of [
      [0, row, col, 1, size],
      [1, col, row, size, 1],
    ]) {
      const key = axis * size + line;
      const lane = lanes.get(key);
      const target = { cell, position };
      if (lane) lane.targets.push(target);
      else lanes.set(key, { line, step, crossStep, targets: [target] });
    }
  }
  const crossQuality = new Map<string, number>();
  const occupied = new Uint8Array(size);
  const anchors = new Uint8Array(size);
  const quality = new Float64Array(size);

  return (board: Board) => {
    const values = new Float64Array(board.length);
    for (const { line, step, crossStep, targets } of lanes.values()) {
      if (targets.every(({ cell }) => board[cell])) continue;
      const origin = line * crossStep;
      for (let position = 0; position < size; position++) {
        const cell = origin + position * step;
        occupied[position] = Number(Boolean(board[cell]));
        anchors[position] = occupied[position];
        quality[position] = 1;
        if (occupied[position]) continue;
        let prefix = "", suffix = "";
        for (let n = line - 1, adjacent = cell - crossStep; n >= 0 && board[adjacent]; n--, adjacent -= crossStep)
          prefix = board[adjacent].toUpperCase() + prefix;
        for (let n = line + 1, adjacent = cell + crossStep; n < size && board[adjacent]; n++, adjacent += crossStep)
          suffix += board[adjacent].toUpperCase();
        if (!prefix && !suffix) continue;
        anchors[position] = 1;
        const key = `${prefix}.${suffix}`;
        let weight = crossQuality.get(key);
        if (weight === undefined) {
          const choices = popcount(lexicon.crossMask(prefix, suffix));
          weight = choices ? 0.3 + 0.7 * Math.sqrt(choices / 26) : 0;
          crossQuality.set(key, weight);
        }
        quality[position] = weight;
      }
      // Score connected windows with enough room to lay four to seven tiles.
      for (let start = 0; start < size; start++) {
        if (start && occupied[start - 1]) continue;
        let empty = 0, connected = false, window = 1;
        for (let end = start; end < size; end++) {
          connected ||= Boolean(anchors[end]);
          if (occupied[end]) window *= 0.8;
          else {
            if (++empty > maxTiles || !quality[end]) break;
            window *= quality[end];
          }
          if (!connected || !WINDOW_WEIGHT[empty] || occupied[end + 1]) continue;
          const score = WINDOW_WEIGHT[empty] * window;
          for (const { cell, position } of targets) {
            if (!board[cell] && start <= position && position <= end)
              values[cell] = Math.max(values[cell], score);
          }
        }
      }
    }
    return values;
  };
}

/** Return a lane adjustment on the same scale as bingo probability. */
export function createTripleWordLaneAdjustment(lexicon: Lexicon, template: BoardTemplate, board: Board, bagSize: number) {
  if (bagSize <= NO_WEIGHT_BAG || template.rackSize < 4) return undefined;
  const triples = template.premiums.flatMap((premium, index) => premium === "TW" && !board[index] ? [index] : []);
  if (!triples.length) return undefined;
  const fade = Math.min(1, (bagSize - NO_WEIGHT_BAG) / (FULL_WEIGHT_BAG - NO_WEIGHT_BAG));
  const scoreLanes = createLaneScorer(lexicon, template, triples);
  const before = scoreLanes(board);
  return (after: Board) => {
    const next = scoreLanes(after);
    let gain = 0;
    // A move receives its placement score for any premiums it uses.
    for (const cell of triples) {
      if (!after[cell]) gain += next[cell] - before[cell];
    }
    return fade * Math.min(MAX_ADJUSTMENT, Math.max(-MAX_ADJUSTMENT, LANE_WEIGHT * gain));
  };
}
