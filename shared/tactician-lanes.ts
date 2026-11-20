import { popcount, type Lexicon } from "./lexicon";
import { minimumBingoTiles, type Board, type BoardTemplate } from "./model";

export const LANE_MIN_BAG = 12;
const LANE_WEIGHT = 8;
const FULL_CREDIT_CHANCE = 0.1;
const ZERO_CREDIT_CHANCE = 0.4;

export function laneOpeningBonus(gain: number, bestBingoChance: number) {
  const fade =
    (ZERO_CREDIT_CHANCE - bestBingoChance) /
    (ZERO_CREDIT_CHANCE - FULL_CREDIT_CHANCE);
  return Math.max(
    -10,
    Math.min(10, LANE_WEIGHT * gain * Math.max(0, Math.min(1, fade))),
  );
}

/** Estimate usable bingo lanes with exact cross-checks and geometric main words. */
export function createBingoLaneScorer(
  lexicon: Lexicon,
  template: BoardTemplate,
) {
  const { size } = template;
  const tilesNeeded = minimumBingoTiles(template);
  const masks = new Map<string, number>();
  const crossing = new Float64Array(size);
  const anchored = new Uint8Array(size);
  return (board: Board) => {
    let total = 0;
    for (const [step, side] of [
      [1, size],
      [size, 1],
    ]) {
      for (let line = 0; line < size; line++) {
        const origin = line * side;
        crossing.fill(1);
        anchored.fill(0);
        for (let i = 0; i < size; i++) {
          const cell = origin + i * step;
          if (board[cell]) continue;
          let prefix = "",
            suffix = "";
          for (
            let adjacent = cell - side, j = line - 1;
            j >= 0 && board[adjacent];
            j--, adjacent -= side
          )
            prefix = board[adjacent].toUpperCase() + prefix;
          for (
            let adjacent = cell + side, j = line + 1;
            j < size && board[adjacent];
            j++, adjacent += side
          )
            suffix += board[adjacent].toUpperCase();
          if (!prefix && !suffix) continue;
          anchored[i] = 1;
          const key = `${prefix}.${suffix}`;
          let choices = masks.get(key);
          if (choices === undefined) {
            choices = popcount(lexicon.crossMask(prefix, suffix));
            masks.set(key, choices);
          }
          crossing[i] = choices ? 0.3 + 0.7 * Math.sqrt(choices / 26) : 0;
        }
        let best = 0,
          second = 0;
        for (let start = 0; start <= size - tilesNeeded; start++) {
          if (start && board[origin + (start - 1) * step]) continue;
          let empty = 0,
            connected = false,
            quality = 1;
          for (let end = start; end < size; end++) {
            if (board[origin + end * step]) connected = true;
            else {
              empty++;
              quality *= crossing[end];
              connected ||= !!anchored[end];
              if (empty > tilesNeeded || !quality) break;
            }
            if (
              empty !== tilesNeeded ||
              !connected ||
              (end + 1 < size && board[origin + (end + 1) * step])
            )
              continue;
            const score =
              quality * 0.76 ** Math.max(0, end - start - tilesNeeded);
            if (score > best) [best, second] = [score, best];
            else second = Math.max(second, score);
          }
        }
        total += best + 0.2 * second;
      }
    }
    return Math.log1p(total / 2);
  };
}
