import { type Lexicon, popcount } from "./lexicon";
import {
  type Board,
  type BoardTemplate,
  type Move,
  type Placement,
  type Position,
  tileScore,
  SCORES,
  letterBonuses,
  wordBonuses,
} from "./model";
import { splitRack } from "./rack-entry";

const ALL = (1 << 26) - 1;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const SEARCH_LIMITS = {
  maxNodes: 2_000_000,
  maxMoves: 150_000,
  maxMs: 2_000,
};
type Limits = Partial<typeof SEARCH_LIMITS>;
type Options = { bingoOnly?: boolean; unsorted?: boolean };
export const BIG_REPLY_SCORE = 40;

export interface PremiumReply {
  word: string;
  score: number;
  tiles: Placement[];
}

interface PremiumSearch {
  counts: readonly number[];
  targets: ReadonlySet<number>;
  replies: Map<number, PremiumReply>;
}

export class SearchLimitError extends Error {
  constructor() {
    super(
      "This search is too large to finish safely. Replace one or more blanks with known letters, or use a smaller word list, then try again. No partial results were shown.",
    );
    this.name = "SearchLimitError";
  }
}

interface Start {
  line: number;
  position: number;
  cell: number;
}

interface Direction {
  direction: Move["direction"];
  step: number;
  starts: Start[];
  toAnchor: Uint8Array;
  space: Uint8Array;
  mask: Int32Array;
  crossScore: Uint8Array;
  prefix: string[];
  suffix: string[];
}

function prepareDirection(
  lexicon: Lexicon,
  letters: string[],
  points: Uint8Array,
  anchors: Uint8Array,
  size: number,
  rackSize: number,
  across: boolean,
): Direction {
  const step = across ? 1 : size;
  const crossStep = across ? size : 1;
  const cellCount = size ** 2;
  const starts: Start[] = [];
  const toAnchor = new Uint8Array(cellCount);
  const space = new Uint8Array(cellCount);
  const mask = new Int32Array(cellCount).fill(ALL);
  const crossScore = new Uint8Array(cellCount);
  const prefix = Array<string>(cellCount).fill("");
  const suffix = Array<string>(cellCount).fill("");
  for (let line = 0; line < size; line++) {
    const first = line * crossStep;
    let distance = size + 1;
    let remaining = 0;
    for (let position = size - 1; position >= 0; position--) {
      const cell = first + position * step;
      if (!letters[cell]) {
        remaining++;
        distance = anchors[cell] ? 1 : distance + 1;
      }
      toAnchor[cell] = distance;
      space[cell] = remaining;
    }
    for (let position = 0; position < size; position++) {
      const cell = first + position * step;
      if (
        toAnchor[cell] <= rackSize &&
        (position === 0 || !letters[cell - step])
      ) {
        starts.push({ line, position, cell });
      }
      // Only an anchor can touch existing tiles perpendicular to the move.
      if (!anchors[cell] || letters[cell]) continue;
      for (
        let row = line - 1, i = cell - crossStep;
        row >= 0 && letters[i];
        row--, i -= crossStep
      ) {
        prefix[cell] = letters[i] + prefix[cell];
        crossScore[cell] += points[i];
      }
      for (
        let row = line + 1, i = cell + crossStep;
        row < size && letters[i];
        row++, i += crossStep
      ) {
        suffix[cell] += letters[i];
        crossScore[cell] += points[i];
      }
      if (prefix[cell] || suffix[cell]) {
        mask[cell] = lexicon.crossMask(prefix[cell], suffix[cell]);
      }
    }
  }
  return {
    direction: across ? "across" : "down",
    step,
    starts,
    toAnchor,
    space,
    mask,
    crossScore,
    prefix,
    suffix,
  };
}

/** Compile a board snapshot once so it can be searched with many different racks. */
export function prepareSolver(
  lexicon: Lexicon,
  board: Board,
  template: BoardTemplate,
) {
  const { size, rackSize, bingo: bonus, rules } = template;
  if (
    !Number.isInteger(size) ||
    size < 5 ||
    size > 25 ||
    board.length !== size ** 2 ||
    template.premiums.length !== size ** 2
  ) {
    throw new Error("The board size does not match its layout.");
  }
  const letters = board.map((tile) => tile.toUpperCase());
  const codes = Int16Array.from(letters, (letter) =>
    letter ? letter.charCodeAt(0) - 65 : -1,
  );
  const points = Uint8Array.from(board, (tile) => tileScore(tile, rules));
  const lm = Uint8Array.from(template.premiums, (p) => letterBonuses[p] ?? 1);
  const wm = Uint8Array.from(template.premiums, (p) => wordBonuses[p] ?? 1);
  const letterPoints = Uint8Array.from(
    LETTERS.slice(0, 26),
    (letter) => SCORES[rules][letter],
  );
  const indexPrefixes = board.map((_, i) => `${i}:`);
  const empty = !board.some(Boolean);
  const anchors = Uint8Array.from(board, (tile, i) => {
    if (tile) return 0;
    if (empty) return Number(i === template.start);
    return Number(
      Boolean(
        board[i - size] ||
        board[i + size] ||
        (i % size > 0 && board[i - 1]) ||
        (i % size < size - 1 && board[i + 1]),
      ),
    );
  });
  const directions = [true, false].map((across) =>
    prepareDirection(lexicon, letters, points, anchors, size, rackSize, across),
  );
  const { first, mask: children, terminal, maxTail } = lexicon;

  function run(
    rack: string,
    limits: Limits,
    options: Options,
    summaryOnly: boolean,
    premiumSearch?: PremiumSearch,
    captureBigReply = false,
  ) {
    const budget = { ...SEARCH_LIMITS, ...limits };
    for (const key of Object.keys(
      SEARCH_LIMITS,
    ) as (keyof typeof SEARCH_LIMITS)[]) {
      if (
        !Number.isFinite(budget[key]) ||
        budget[key] < 0 ||
        budget[key] > SEARCH_LIMITS[key]
      ) {
        throw new Error("Invalid search budget.");
      }
    }
    const deadline = performance.now() + budget.maxMs;
    if (
      !/^[A-Z?.]*$/i.test(rack) ||
      rack.length > rackSize ||
      rack.length > 10
    ) {
      throw new Error("The rack contains invalid tiles or too many letters.");
    }
    rack = rack.replaceAll(".", "").toUpperCase();
    const rackLength = premiumSearch
      ? Math.min(
          3,
          rackSize,
          premiumSearch.counts.reduce((a, b) => a + b, 0),
        )
      : rack.length;
    const moves: Move[] = [];
    let bestScore = 0,
      hasBingo = false;
    let bigReply: PremiumReply | undefined;
    if (!rackLength || (options.bingoOnly && rackLength < rackSize))
      return { moves, bestScore, hasBingo, bigReply };
    if (performance.now() >= deadline) throw new SearchLimitError();

    const counts = premiumSearch ? new Uint16Array(26) : new Uint8Array(26);
    let rackMask = 0,
      blankCount = 0;
    for (const letter of rack) {
      if (letter === "?") blankCount++;
      else {
        const code = letter.charCodeAt(0) - 65;
        counts[code]++;
        rackMask |= 1 << code;
      }
    }
    if (premiumSearch) {
      counts.set(premiumSearch.counts.slice(0, 26));
      for (let code = 0; code < counts.length; code++) {
        if (counts[code]) rackMask |= 1 << code;
      }
      blankCount = premiumSearch.counts[26];
    }

    let nodes = 0,
      moveCount = 0;
    const seenSingles = new Set<number>();
    const tileCells = new Uint16Array(rackLength);
    const tileCodes = new Uint8Array(rackLength);
    const wordCodes = new Uint8Array(size);
    const bingoOnly = options.bingoOnly === true;

    for (const {
      direction,
      step,
      starts,
      mask,
      toAnchor,
      space,
      crossScore,
      prefix,
      suffix,
    } of directions) {
      let startLine = 0,
        startPosition = 0;
      // Number of new tiles needed to reach the next target in this direction.
      const toPremium = premiumSearch && new Uint8Array(board.length);
      if (toPremium && premiumSearch) {
        const crossStep = step === 1 ? size : 1;
        for (let line = 0; line < size; line++) {
          let distance = size + 1;
          for (let p = size - 1; p >= 0; p--) {
            const cell = line * crossStep + p * step;
            if (!letters[cell])
              distance = premiumSearch.targets.has(cell) ? 1 : distance + 1;
            toPremium[cell] = distance;
          }
        }
      }
      function emit(
        length: number,
        used: number,
        score: number,
        available: number,
        blanks: number,
      ) {
        // Multiple new squares determine the word's axis. A one-tile play
        // making two words can be found from both axes.
        if (used === 1) {
          const key = tileCells[0] * 52 + tileCodes[0];
          if (seenSingles.has(key)) return;
          seenSingles.add(key);
        }
        if (premiumSearch) {
          for (let k = 0; k < used; k++) {
            const square = tileCells[k];
            if (
              !premiumSearch.targets.has(square) ||
              (premiumSearch.replies.get(square)?.score ?? -1) >= score
            )
              continue;
            let word = "";
            for (let i = 0; i < length; i++) word += LETTERS[wordCodes[i]];
            premiumSearch.replies.set(square, {
              word,
              score,
              tiles: Array.from({ length: used }, (_, i) => ({
                index: tileCells[i],
                letter: LETTERS[tileCodes[i]],
              })),
            });
          }
          return;
        }
        if (moveCount >= budget.maxMoves) throw new SearchLimitError();
        moveCount++;
        if (summaryOnly) {
          if (score > bestScore) {
            bestScore = score;
            if (captureBigReply && score >= BIG_REPLY_SCORE) {
              let word = "";
              for (let i = 0; i < length; i++) word += LETTERS[wordCodes[i]];
              bigReply = {
                word,
                score,
                tiles: Array.from({ length: used }, (_, i) => ({
                  index: tileCells[i],
                  letter: LETTERS[tileCodes[i]],
                })),
              };
            }
          }
          hasBingo ||= used === rackSize;
          return;
        }
        const tiles: Placement[] = [];
        const keys: string[] = [];
        const crosses: string[] = [];
        for (let k = 0; k < used; k++) {
          const index = tileCells[k];
          const letter = LETTERS[tileCodes[k]];
          tiles.push({ index, letter });
          keys.push(indexPrefixes[index] + letter);
          if (prefix[index] || suffix[index]) {
            crosses.push(prefix[index] + letter.toUpperCase() + suffix[index]);
          }
        }
        let leave = "";
        for (let bits = available; bits; bits &= bits - 1) {
          const code = 31 - Math.clz32(bits & -bits);
          leave += LETTERS[code].repeat(counts[code]);
        }
        let word = "";
        for (let k = 0; k < length; k++) word += LETTERS[wordCodes[k]];
        moves.push({
          id: keys.sort().join(","),
          word,
          row: direction === "across" ? startLine : startPosition,
          col: direction === "across" ? startPosition : startLine,
          direction,
          score,
          tiles,
          leave: leave + "?".repeat(blanks),
          blanks: blankCount - blanks,
          crosses,
        });
      }

      function walk(
        cell: number,
        length: number,
        node: number,
        used: number,
        available: number,
        blanks: number,
        sum: number,
        multiplier: number,
        crossTotal: number,
        connected: boolean,
        hitsPremium = false,
      ) {
        if (
          ++nodes > budget.maxNodes ||
          ((nodes & 255) === 0 && performance.now() >= deadline)
        ) {
          throw new SearchLimitError();
        }
        const atEdge = startPosition + length === size;
        if (
          toPremium &&
          !hitsPremium &&
          (atEdge || toPremium[cell] > rackLength - used)
        )
          return false;
        if (
          bingoOnly &&
          (maxTail[node] < rackSize - used ||
            (atEdge ? used < rackSize : space[cell] < rackSize - used))
        )
          return false;
        if (!connected && (atEdge || toAnchor[cell] > rackLength - used))
          return false;
        if (
          terminal[node] &&
          length >= 2 &&
          used &&
          connected &&
          (atEdge || !letters[cell]) &&
          (!bingoOnly || used === rackSize)
        ) {
          emit(
            length,
            used,
            sum * multiplier + crossTotal + (used === rackSize ? bonus : 0),
            available,
            blanks,
          );
          if (bingoOnly && moveCount) return true;
        }
        if (atEdge) return false;
        if (letters[cell]) {
          const code = codes[cell];
          const child = lexicon.child(node, code);
          if (!child) return false;
          if (!summaryOnly || captureBigReply) wordCodes[length] = code;
          return walk(
            cell + step,
            length + 1,
            child,
            used,
            available,
            blanks,
            sum + points[cell],
            multiplier,
            crossTotal,
            connected,
            hitsPremium,
          );
        }
        if (used === rackLength) return false;
        const allChildren = children[node];
        let possible = allChildren & mask[cell] & (blanks ? ALL : available);
        const nextMultiplier = multiplier * wm[cell];
        const hasCross = !!(prefix[cell] || suffix[cell]);
        const baseCross = crossTotal + crossScore[cell] * wm[cell];
        const nextConnected = connected || !!anchors[cell];
        const nextHitsPremium = hitsPremium || premiumSearch?.targets.has(cell);
        tileCells[used] = cell;
        while (possible) {
          const code = 31 - Math.clz32(possible);
          const bit = 1 << code;
          possible ^= bit;
          const child = first[node] + popcount(allChildren >>> (code + 1));
          if (!summaryOnly || captureBigReply) wordCodes[length] = code;
          if (available & bit) {
            const points = letterPoints[code] * lm[cell];
            const left = --counts[code] ? available : available ^ bit;
            tileCodes[used] = code;
            const found = walk(
              cell + step,
              length + 1,
              child,
              used + 1,
              left,
              blanks,
              sum + points,
              nextMultiplier,
              baseCross + (hasCross ? points * wm[cell] : 0),
              nextConnected,
              nextHitsPremium,
            );
            counts[code]++;
            if (found) return true;
          }
          if (blanks) {
            tileCodes[used] = code + 26;
            if (
              walk(
                cell + step,
                length + 1,
                child,
                used + 1,
                available,
                blanks - 1,
                sum,
                nextMultiplier,
                baseCross,
                nextConnected,
                nextHitsPremium,
              )
            )
              return true;
          }
        }
        return false;
      }

      for (const start of starts) {
        if (performance.now() >= deadline) throw new SearchLimitError();
        if (
          toAnchor[start.cell] > rackLength ||
          (toPremium && toPremium[start.cell] > rackLength) ||
          (bingoOnly && space[start.cell] < rackSize)
        )
          continue;
        startLine = start.line;
        startPosition = start.position;
        if (walk(start.cell, 0, 0, 0, rackMask, blankCount, 0, 1, 0, false)) {
          return { moves, bestScore, hasBingo, bigReply };
        }
      }
    }
    if (!options.unsorted && !summaryOnly) {
      moves.sort(
        (a, b) =>
          b.score - a.score ||
          b.tiles.length - a.tiles.length ||
          a.word.localeCompare(b.word) ||
          a.id.localeCompare(b.id),
      );
    }
    return { moves, bestScore, hasBingo, bigReply };
  }

  return {
    solve: (rack: string, limits: Limits = {}, options: Options = {}) =>
      run(rack, limits, options, false).moves,
    summarize: (rack: string, limits: Limits = {}) => {
      const { bestScore, hasBingo } = run(rack, limits, {}, true);
      return { score: bestScore, bingo: hasBingo };
    },
    summarizeReply: (rack: string, limits: Limits = {}) => {
      const { bestScore, bigReply } = run(
        rack,
        limits,
        {},
        true,
        undefined,
        true,
      );
      return { score: bestScore, bigReply };
    },
    premiumReplies(
      counts: readonly number[],
      targets: ReadonlySet<number>,
      limits: Limits,
    ) {
      const replies = new Map<number, PremiumReply>();
      run("", limits, {}, false, { counts, targets, replies });
      return replies;
    },
  };
}

export function solve(
  lexicon: Lexicon,
  board: Board,
  rack: string,
  template: BoardTemplate,
  limits: Limits = {},
  options: Options = {},
): Move[] {
  return prepareSolver(lexicon, board, template).solve(rack, limits, options);
}

/** Search with the available tiles, but keep held tiles in each physical leave. */
export function solvePosition(
  lexicon: Lexicon,
  position: Position,
  template: BoardTemplate,
) {
  const { available, held } = splitRack(position);
  const moves = solve(lexicon, position.board, available, template);
  if (held) {
    for (const move of moves) {
      move.leave = (move.leave + held).split("").sort().join("");
    }
  }
  return moves;
}

/** Diagnose entered positions without preventing transcription of an in-progress board. */
export function inspectBoard(
  lexicon: Lexicon,
  board: Board,
  template: BoardTemplate,
): string[] {
  const n = template.size,
    warnings: string[] = [],
    occupied = board.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  if (!occupied.length) return warnings;
  if (!board[template.start])
    warnings.push(
      "The starting square is empty. Check the board transcription.",
    );
  const visited = new Set<number>(),
    queue = [occupied[0]];
  while (queue.length) {
    const i = queue.pop()!;
    if (visited.has(i)) continue;
    visited.add(i);
    const r = Math.floor(i / n),
      c = i % n;
    for (const j of [
      r > 0 ? i - n : -1,
      r < n - 1 ? i + n : -1,
      c > 0 ? i - 1 : -1,
      c < n - 1 ? i + 1 : -1,
    ])
      if (j >= 0 && board[j] && !visited.has(j)) queue.push(j);
  }
  if (visited.size !== occupied.length)
    warnings.push(
      "Some tiles are disconnected. Check the board transcription.",
    );
  const invalid = new Set<string>();
  for (const across of [true, false])
    for (let line = 0; line < n; line++) {
      let word = "";
      for (let p = 0; p <= n; p++) {
        const char = p < n ? board[across ? line * n + p : p * n + line] : "";
        if (char) word += char.toUpperCase();
        else {
          if (word.length > 1 && !lexicon.has(word)) invalid.add(word);
          word = "";
        }
      }
    }
  if (invalid.size)
    warnings.push(`Not in this dictionary: ${[...invalid].join(", ")}.`);
  return warnings;
}
