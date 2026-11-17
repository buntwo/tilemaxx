import { type Lexicon, popcount } from "./lexicon";
import {
  type Board,
  type BoardTemplate,
  type Move,
  type Placement,
  type Position,
  bingoPoints,
  isBingo,
  minimumBingoTiles,
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
type Options = {
  bingoOnly?: boolean;
  unsorted?: boolean;
  requiredTiles?: string;
};
type SearchMode = "moves" | "score" | "score-and-bingo";
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
  constructor(readonly reason?: "time" | "nodes" | "moves") {
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

interface RankedStarts {
  starts: Start[];
  ceilings: number[];
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
  crossMask: (prefix: string, suffix: string) => number,
  letters: string[],
  points: Uint8Array,
  anchors: Uint8Array,
  size: number,
  rackSize: number,
  across: boolean,
  prior?: Direction,
  dirty?: Set<number>,
): Direction {
  const step = across ? 1 : size;
  const crossStep = across ? size : 1;
  const cellCount = size ** 2;
  const starts: Start[] = [];
  const toAnchor = prior ? prior.toAnchor.slice() : new Uint8Array(cellCount);
  const space = prior ? prior.space.slice() : new Uint8Array(cellCount);
  const mask = prior ? prior.mask.slice() : new Int32Array(cellCount).fill(ALL);
  const crossScore = prior
    ? prior.crossScore.slice()
    : new Uint8Array(cellCount);
  const prefix = prior
    ? prior.prefix.slice()
    : Array<string>(cellCount).fill("");
  const suffix = prior
    ? prior.suffix.slice()
    : Array<string>(cellCount).fill("");
  const previousStarts = Array.from({ length: size }, () => [] as Start[]);
  if (prior)
    for (const start of prior.starts) previousStarts[start.line].push(start);
  for (let line = 0; line < size; line++) {
    if (prior && dirty && !dirty.has(line)) {
      starts.push(...previousStarts[line]);
      continue;
    }

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
      mask[cell] = ALL;
      crossScore[cell] = 0;
      prefix[cell] = "";
      suffix[cell] = "";
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
        mask[cell] = crossMask(prefix[cell], suffix[cell]);
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

/** Optimistic suffix scores for each square and remaining tile count. */
function prepareScoreBounds(
  { step, mask, crossScore, prefix, suffix }: Direction,
  size: number,
  rackSize: number,
  points: Uint8Array,
  codes: Int16Array,
  lm: Uint8Array,
  wm: Uint8Array,
) {
  const stride = rackSize + 1;
  const length = size ** 2 * stride;
  const reachable = new Uint8Array(size ** 2);
  const boardPoints = new Uint16Array(length);
  const wordFactor = new Uint32Array(length).fill(1);
  const crossPoints = new Uint16Array(length);
  const letterFactor = new Uint8Array(length);
  const crossFactor = new Uint8Array(length);
  const crossStep = step === 1 ? size : 1;
  for (let line = 0; line < size; line++) {
    for (let position = size - 1; position >= 0; position--) {
      const cell = line * crossStep + position * step;
      const occupied = codes[cell] !== -1;
      if (!occupied && !mask[cell]) continue;
      const hasCross = !!(prefix[cell] || suffix[cell]);
      const next = cell + step;
      const edge = position === size - 1;
      reachable[cell] = (occupied ? 0 : 1) + (edge ? 0 : reachable[next]);
      const letter = occupied ? 0 : lm[cell];
      const word = occupied ? 1 : wm[cell];
      for (let tiles = occupied ? 0 : 1; tiles <= rackSize; tiles++) {
        const index = cell * stride + tiles;
        const tail = next * stride + tiles - (occupied ? 0 : 1);
        boardPoints[index] = points[cell] + (edge ? 0 : boardPoints[tail]);
        wordFactor[index] = word * (edge ? 1 : wordFactor[tail]);
        crossPoints[index] =
          (hasCross ? crossScore[cell] * word : 0) +
          (edge ? 0 : crossPoints[tail]);
        letterFactor[index] = Math.max(letter, edge ? 0 : letterFactor[tail]);
        crossFactor[index] = Math.max(
          hasCross ? letter * word : 0,
          edge ? 0 : crossFactor[tail],
        );
      }
    }
  }
  return {
    reachable,
    boardPoints,
    wordFactor,
    crossPoints,
    letterFactor,
    crossFactor,
  };
}

function prepareLayout(template: BoardTemplate) {
  const { size, rackSize, rules, start } = template;
  if (
    !Number.isInteger(size) ||
    size < 5 ||
    size > 25 ||
    template.premiums.length !== size ** 2
  ) {
    throw new Error("The board size does not match its layout.");
  }
  return {
    size,
    rackSize,
    rules,
    start,
    bingoTiles: minimumBingoTiles(template),
    bingoCounts: Array.from({ length: rackSize + 1 }, (_, played) =>
      isBingo(template, played),
    ),
    bonuses: Array.from({ length: rackSize + 1 }, (_, played) =>
      bingoPoints(template, played),
    ),
    lm: Uint8Array.from(template.premiums, (p) => letterBonuses[p] ?? 1),
    wm: Uint8Array.from(template.premiums, (p) => wordBonuses[p] ?? 1),
    letterPoints: Uint8Array.from(
      LETTERS.slice(0, 26),
      (letter) => SCORES[rules][letter],
    ),
    indexPrefixes: Array.from({ length: size ** 2 }, (_, i) => `${i}:`),
  };
}

/** Compile a board snapshot once so it can be searched with many different racks. */
export function prepareSolver(
  lexicon: Lexicon,
  board: Board,
  template: BoardTemplate,
) {
  return prepareBoardSolver(
    lexicon,
    board,
    prepareLayout(template),
    (prefix, suffix) => lexicon.crossMask(prefix, suffix),
  );
}

/** Reuse layout data and cross-checks across an analysis's many board snapshots.
 * The layout is captured now; the lexicon must remain immutable for the session.
 * Keep the cache local and bounded so finished analyses release their memory.
 */
export function createSolverFactory(
  lexicon: Lexicon,
  template: BoardTemplate,
  incremental = false,
) {
  const layout = prepareLayout(template);
  const masks = new Map<string, number>();
  const crossMask = (prefix: string, suffix: string) => {
    const key = `${prefix}.${suffix}`;
    const cached = masks.get(key);
    if (cached !== undefined) return cached;
    const mask = lexicon.crossMask(prefix, suffix);
    if (masks.size >= 4_096) masks.delete(masks.keys().next().value!);
    masks.set(key, mask);
    return mask;
  };
  const geometry = new WeakMap<Board, Geometry>();
  const parents = new WeakMap<Board, { board: Board; changed: number[] }>();
  function prepareGeometry(board: Board): Geometry {
    let data = geometry.get(board);
    if (!data) {
      const parent = parents.get(board);
      data = buildGeometry(
        board,
        layout,
        crossMask,
        parent && prepareGeometry(parent.board),
        parent?.changed,
      );
      geometry.set(board, data);
    }
    return data;
  }
  const prepare = (board: Board) =>
    prepareBoardSolver(
      lexicon,
      board,
      layout,
      crossMask,
      incremental ? prepareGeometry(board) : undefined,
    );
  return Object.assign(prepare, {
    place(board: Board, move: Move): Board {
      const next = [...board];
      for (const { index, letter } of move.tiles) next[index] = letter;
      if (incremental)
        parents.set(next, {
          board,
          changed: move.tiles.map(({ index }) => index),
        });
      return next;
    },
    singleMoves(board: Board, rack: string): Move[] {
      if (rack.length !== 1)
        throw new Error("Single-tile search needs one tile.");
      return singleTileMoves(board, rack, layout, prepareGeometry(board));
    },
  });
}

function prepareBoardSolver(
  lexicon: Lexicon,
  board: Board,
  layout: ReturnType<typeof prepareLayout>,
  crossMask: (prefix: string, suffix: string) => number,
  geometry?: ReturnType<typeof buildGeometry>,
) {
  const {
    size,
    rackSize,
    rules,
    start,
    bingoTiles,
    bingoCounts,
    bonuses,
    lm,
    wm,
    letterPoints,
    indexPrefixes,
  } = layout;
  if (board.length !== size ** 2)
    throw new Error("The board size does not match its layout.");
  const { letters, codes, points, anchors, directions } =
    geometry ?? buildGeometry(board, layout, crossMask);
  const { first, mask: children, terminal, maxTail } = lexicon;
  const boundStride = rackSize + 1;
  let scoreBounds: ReturnType<typeof prepareScoreBounds>[] | undefined;
  let bonusBounds: Uint16Array | undefined;
  let startOrders:
    | {
        rackLength: number;
        byDirection: Map<number, RankedStarts>[];
      }
    | undefined;

  function run(
    rack: string,
    limits: Limits,
    options: Options,
    mode: SearchMode,
    premiumSearch?: PremiumSearch,
    bigReplies?: PremiumReply[],
  ) {
    const summaryOnly = mode !== "moves";
    const trackBingo = mode === "score-and-bingo";
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
      scoreToBeat = 0,
      hasBingo = false;
    if (!rackLength || (options.bingoOnly && rackLength < bingoTiles))
      return { moves, bestScore, hasBingo };
    if (performance.now() >= deadline) throw new SearchLimitError("time");

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
    const pruneScore = mode === "score" && blankCount > 0;
    // Keep the traversal order for tied example plays in a heatmap.
    const prioritizeStarts = pruneScore && !bigReplies;
    if (prioritizeStarts && startOrders?.rackLength !== rackLength) {
      startOrders = {
        rackLength,
        byDirection: directions.map(() => new Map()),
      };
    }
    let remainingPoints = 0;
    if (pruneScore) {
      for (let code = 0; code < counts.length; code++)
        remainingPoints += counts[code] * letterPoints[code];
      scoreBounds ??= directions.map((direction) =>
        prepareScoreBounds(direction, size, rackSize, points, codes, lm, wm),
      );
      if (!bonusBounds) {
        bonusBounds = new Uint16Array(boundStride ** 2);
        for (let used = 0; used <= rackSize; used++) {
          let most = bonuses[used];
          for (let more = 0; more <= rackSize - used; more++) {
            most = Math.max(most, bonuses[used + more]);
            bonusBounds[used * boundStride + more] = most;
          }
        }
      }
    }
    if (premiumSearch) {
      counts.set(premiumSearch.counts.slice(0, 26));
      for (let code = 0; code < counts.length; code++) {
        if (counts[code]) rackMask |= 1 << code;
      }
      blankCount = premiumSearch.counts[26];
    }

    // Required tiles describe physical rack copies. Compare what remains so
    // a board letter or a blank assigned to the same letter cannot satisfy it.
    const required = options.requiredTiles?.toUpperCase();
    const maxRemaining = required ? new Map<number, number>() : undefined;
    let maxBlanks = blankCount;
    if (required && maxRemaining) {
      for (const letter of required) {
        if (letter === "?") maxBlanks--;
        else {
          const code = letter.charCodeAt(0) - 65;
          maxRemaining.set(code, (maxRemaining.get(code) ?? counts[code]) - 1);
        }
      }
      if (maxBlanks < 0 || [...maxRemaining.values()].some((n) => !(n >= 0)))
        return { moves, bestScore, hasBingo };
    }

    let nodes = 0,
      moveCount = 0;
    const seenSingles = new Set<number>();
    const tileCells = new Uint16Array(rackLength);
    const tileCodes = new Uint8Array(rackLength);
    const wordCodes = new Uint8Array(size);
    const bingoOnly = options.bingoOnly === true;

    for (const [axis, geometry] of directions.entries()) {
      const {
        direction,
        step,
        starts,
        mask,
        toAnchor,
        space,
        crossScore,
        prefix,
        suffix,
      } = geometry;
      let startLine = 0,
        startPosition = 0;
      const bounds = pruneScore ? scoreBounds?.[axis] : undefined;
      const bonusCeiling = bonusBounds;
      const upperBound =
        bounds && bonusCeiling
          ? (
              cell: number,
              position: number,
              node: number,
              used: number,
              sum: number,
              multiplier: number,
              crossTotal: number,
            ) => {
              const squares = size - position;
              if (!squares)
                return sum * multiplier + crossTotal + bonuses[used];
              const tail = maxTail[node];
              const empty =
                tail >= squares
                  ? space[cell]
                  : space[cell] - space[cell + tail * step];
              const tiles = Math.min(
                rackLength - used,
                empty,
                bounds.reachable[cell],
              );
              const index = cell * boundStride + tiles;
              const word = multiplier * bounds.wordFactor[index];
              // Relax the word constraint and give every remaining face point
              // the largest applicable premium in each scoring component.
              return (
                (sum + bounds.boardPoints[index]) * word +
                crossTotal +
                bounds.crossPoints[index] +
                remainingPoints *
                  (word * bounds.letterFactor[index] +
                    bounds.crossFactor[index]) +
                bonusCeiling[used * boundStride + tiles]
              );
            }
          : undefined;
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
        if (maxRemaining) {
          if (blanks > maxBlanks) return;
          for (const [code, max] of maxRemaining)
            if (counts[code] > max) return;
        }
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
        if (moveCount >= budget.maxMoves) throw new SearchLimitError("moves");
        moveCount++;
        if (summaryOnly) {
          if (score > bestScore) {
            bestScore = score;
            // Heatmaps need every tied best reply once it reaches the threshold.
            scoreToBeat =
              bigReplies && score >= BIG_REPLY_SCORE ? score - 1 : score;
            if (bigReplies) bigReplies.length = 0;
          }
          if (bigReplies && score >= BIG_REPLY_SCORE && score === bestScore) {
            let word = "";
            for (let i = 0; i < length; i++) word += LETTERS[wordCodes[i]];
            bigReplies.push({
              word,
              score,
              tiles: Array.from({ length: used }, (_, i) => ({
                index: tileCells[i],
                letter: LETTERS[tileCodes[i]],
              })),
            });
          }
          hasBingo ||= trackBingo && bingoCounts[used];
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
        if (++nodes > budget.maxNodes) throw new SearchLimitError("nodes");
        if ((nodes & 255) === 0 && performance.now() >= deadline)
          throw new SearchLimitError("time");
        const position = startPosition + length;
        const atEdge = position === size;
        if (
          toPremium &&
          !hitsPremium &&
          (atEdge || toPremium[cell] > rackLength - used)
        )
          return false;
        if (
          bingoOnly &&
          (maxTail[node] < bingoTiles - used ||
            (atEdge ? used < bingoTiles : space[cell] < bingoTiles - used))
        )
          return false;
        if (!connected && (atEdge || toAnchor[cell] > rackLength - used))
          return false;
        if (
          upperBound &&
          upperBound(cell, position, node, used, sum, multiplier, crossTotal) <=
            scoreToBeat
        )
          return false;
        if (
          terminal[node] &&
          length >= 2 &&
          used &&
          connected &&
          (atEdge || !letters[cell]) &&
          (!bingoOnly || bingoCounts[used])
        ) {
          emit(
            length,
            used,
            sum * multiplier + crossTotal + bonuses[used],
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
          if (!summaryOnly || bigReplies) wordCodes[length] = code;
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
        if (!possible) return false;
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
          if (!summaryOnly || bigReplies) wordCodes[length] = code;
          if (available & bit) {
            const value = letterPoints[code];
            const points = value * lm[cell];
            const left = --counts[code] ? available : available ^ bit;
            tileCodes[used] = code;
            if (bounds) remainingPoints -= value;
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
            if (bounds) remainingPoints += value;
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

      const ordering = prioritizeStarts
        ? startOrders?.byDirection[axis]
        : undefined;
      let ranked = ordering?.get(remainingPoints);
      if (ordering && upperBound && !ranked) {
        const priorities = starts
          .filter(({ cell }) => toAnchor[cell] <= rackLength)
          .map((start) => ({
            start,
            ceiling: upperBound(start.cell, start.position, 0, 0, 0, 1, 0),
          }))
          .sort(
            (a, b) =>
              b.ceiling - a.ceiling ||
              toAnchor[a.start.cell] - toAnchor[b.start.cell],
          );
        ranked = {
          starts: priorities.map(({ start }) => start),
          ceilings: priorities.map(({ ceiling }) => ceiling),
        };
        // The relaxed score uses the rack's tile count and total face points.
        ordering.set(remainingPoints, ranked);
      }
      const candidates = ranked?.starts ?? starts;
      for (let index = 0; index < candidates.length; index++) {
        if (performance.now() >= deadline) throw new SearchLimitError("time");
        // The remaining starts have the same or a lower ceiling.
        if (ranked && ranked.ceilings[index] <= scoreToBeat) break;
        const start = candidates[index];
        if (
          toAnchor[start.cell] > rackLength ||
          (toPremium && toPremium[start.cell] > rackLength) ||
          (bingoOnly && space[start.cell] < bingoTiles)
        )
          continue;
        startLine = start.line;
        startPosition = start.position;
        if (walk(start.cell, 0, 0, 0, rackMask, blankCount, 0, 1, 0, false)) {
          return { moves, bestScore, hasBingo };
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
    return { moves, bestScore, hasBingo };
  }

  return {
    solve: (rack: string, limits: Limits = {}, options: Options = {}) =>
      run(rack, limits, options, "moves").moves,
    bestScore: (rack: string, limits: Limits = {}) =>
      run(rack, limits, {}, "score").bestScore,
    summarize: (rack: string, limits: Limits = {}) => {
      const { bestScore, hasBingo } = run(rack, limits, {}, "score-and-bingo");
      return { score: bestScore, bingo: hasBingo };
    },
    summarizeReply: (rack: string, limits: Limits = {}) => {
      const bigReplies: PremiumReply[] = [];
      const { bestScore } = run(
        rack,
        limits,
        {},
        "score",
        undefined,
        bigReplies,
      );
      return { score: bestScore, bigReplies };
    },
    premiumReplies(
      counts: readonly number[],
      targets: ReadonlySet<number>,
      limits: Limits,
    ) {
      const replies = new Map<number, PremiumReply>();
      run("", limits, {}, "moves", { counts, targets, replies });
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
  limits?: Limits,
) {
  const solver = prepareSolver(lexicon, position.board, template);
  return solveAvailableTiles(solver, position, limits);
}

/** Find playable moves and the points reference for a rack with no marks. */
export function solvePositionWithBaseline(
  lexicon: Lexicon,
  position: Position,
  template: BoardTemplate,
  limits?: Limits,
) {
  const solver = prepareSolver(lexicon, position.board, template);
  const moves = solveAvailableTiles(solver, position, limits);
  let topScore: number | null = moves[0]?.score ?? 0;
  if (
    moves.length &&
    (position.excludedRackSlots?.length || position.requiredRackSlots?.length)
  ) {
    try {
      topScore = solver.summarize(position.rack, limits).score;
    } catch (error) {
      // A full rack can exceed the search budget even if its marked search fits.
      if (!(error instanceof SearchLimitError)) throw error;
      topScore = null;
    }
  }
  return { moves, topScore };
}

function solveAvailableTiles(
  solver: ReturnType<typeof prepareSolver>,
  position: Position,
  limits?: Limits,
) {
  const { available, held } = splitRack(position);
  const requiredTiles = position.requiredRackSlots
    ?.map((slot) => position.rack[slot])
    .join("");
  const moves = solver.solve(available, limits, {
    requiredTiles,
  });
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

type Geometry = {
  letters: string[];
  codes: Int16Array;
  points: Uint8Array;
  anchors: Uint8Array;
  directions: Direction[];
};
function buildGeometry(
  board: Board,
  layout: ReturnType<typeof prepareLayout>,
  crossMask: (prefix: string, suffix: string) => number,
  prior?: Geometry,
  changed?: number[],
): Geometry {
  const { size, rackSize, rules, start } = layout;
  const letters = prior
    ? prior.letters.slice()
    : board.map((tile) => tile.toUpperCase());
  if (prior && changed)
    for (const i of changed) letters[i] = board[i].toUpperCase();
  const codes = prior
    ? prior.codes.slice()
    : Int16Array.from(letters, (letter) =>
        letter ? letter.charCodeAt(0) - 65 : -1,
      );
  if (prior && changed)
    for (const i of changed) codes[i] = letters[i].charCodeAt(0) - 65;
  const points = prior
    ? prior.points.slice()
    : Uint8Array.from(board, (tile) => tileScore(tile, rules));
  if (prior && changed)
    for (const i of changed) points[i] = tileScore(board[i], rules);
  const empty = !board.some(Boolean);
  const anchors = prior ? prior.anchors.slice() : new Uint8Array(board.length);
  const dirtyCells = new Set<number>();
  const neighbors = (i: number) =>
    [
      i - size,
      i + size,
      ...(i % size ? [i - 1] : []),
      ...(i % size < size - 1 ? [i + 1] : []),
    ].filter((i) => i >= 0 && i < board.length);
  if (prior && changed)
    for (const i of changed) {
      dirtyCells.add(i);
      for (const j of neighbors(i)) dirtyCells.add(j);
    }
  else for (let i = 0; i < board.length; i++) dirtyCells.add(i);
  for (const i of dirtyCells)
    anchors[i] = board[i]
      ? 0
      : empty
        ? Number(i === start)
        : Number(neighbors(i).some((j) => !!board[j]));
  const dirtyAxes = [new Set<number>(), new Set<number>()];
  for (const i of dirtyCells) {
    dirtyAxes[0].add(Math.floor(i / size));
    dirtyAxes[1].add(i % size);
  }
  if (prior && changed)
    for (const i of changed)
      for (const axis of [0, 1]) {
        // Cross-checks change at the empty endpoints of the newly joined word.
        const step = axis === 0 ? size : 1;
        for (const sign of [-1, 1]) {
          let cell = i;
          while (true) {
            const next = cell + sign * step;
            if (
              next < 0 ||
              next >= board.length ||
              (step === 1 &&
                Math.floor(next / size) !== Math.floor(cell / size))
            )
              break;
            cell = next;
            if (!board[cell]) {
              dirtyAxes[axis].add(
                axis === 0 ? Math.floor(cell / size) : cell % size,
              );
              break;
            }
          }
        }
      }
  const directions = [true, false].map((across, axis) =>
    prepareDirection(
      crossMask,
      letters,
      points,
      anchors,
      size,
      rackSize,
      across,
      prior?.directions[axis],
      dirtyAxes[axis],
    ),
  );
  return { letters, codes, points, anchors, directions };
}

/** One-tile moves are terminal in an empty-bag search; no word-tree traversal is needed. */
function singleTileMoves(
  board: Board,
  rack: string,
  layout: ReturnType<typeof prepareLayout>,
  data: Geometry,
): Move[] {
  const moves: Move[] = [];
  const [across, down] = data.directions;
  const blank = rack === "?";
  const available = blank ? ALL : 1 << (rack.toUpperCase().charCodeAt(0) - 65);
  for (let cell = 0; cell < board.length; cell++) {
    if (board[cell] || !data.anchors[cell]) continue;
    const hp = down.prefix[cell],
      hs = down.suffix[cell];
    const vp = across.prefix[cell],
      vs = across.suffix[cell];
    const h = !!(hp || hs),
      v = !!(vp || vs);
    if (!h && !v) continue;
    let allowed = across.mask[cell] & down.mask[cell] & available;
    while (allowed) {
      const code = 31 - Math.clz32(allowed);
      allowed ^= 1 << code;
      const letter = LETTERS[code],
        placed = blank ? letter.toLowerCase() : letter;
      const point = blank ? 0 : layout.letterPoints[code] * layout.lm[cell];
      const score =
        ((h ? down.crossScore[cell] + point : 0) +
          (v ? across.crossScore[cell] + point : 0)) *
          layout.wm[cell] +
        layout.bonuses[1];
      const first = h ? cell - hp.length : cell - vp.length * layout.size;
      moves.push({
        id: `${cell}:${placed}`,
        word: h ? hp + letter + hs : vp + letter + vs,
        row: Math.floor(first / layout.size),
        col: first % layout.size,
        direction: h ? "across" : "down",
        score,
        tiles: [{ index: cell, letter: placed }],
        leave: "",
        blanks: Number(blank),
        crosses: h && v ? [vp + letter + vs] : [],
      });
    }
  }
  // Match the general generator's order so tied optimal lines stay deterministic.
  return moves.sort(
    (a, b) =>
      Number(a.direction === "down") - Number(b.direction === "down") ||
      (a.direction === "across"
        ? a.row - b.row || a.col - b.col
        : a.col - b.col || a.row - b.row) ||
      b.tiles[0].letter.localeCompare(a.tiles[0].letter),
  );
}
