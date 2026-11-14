import { popcount, type Lexicon } from "./lexicon";
import {
  bingoTileCounts,
  minimumBingoTiles,
  type BoardTemplate,
  type Move,
  type Position,
} from "./model";
import { placeTiles, sampleTiles, weightedDraws } from "./move-analysis";
import { prepareSolver, SEARCH_LIMITS, SearchLimitError } from "./solver";
import { choose, TILE_SYMBOLS, unseenTiles } from "./tile-pool";

export const BOARD_ODDS_LIMIT = 20;
const SAMPLES = 200;
const MIN_BOARD_SAMPLES = 20;
const INDEX_LIMIT = 350_000;
const DRAW_TIMEOUT = 350;
const sortTiles = (letters: string) => [...letters].sort().join("");
const letterCode = (letter: string) =>
  letter === "?" ? 26 : letter.charCodeAt(0) - 65;

export interface RackOdds {
  byLeave: Record<string, number>;
  exact: boolean;
  bagSize: number;
  error?: string;
}

export interface BoardOdds {
  chance: number;
  exact: boolean;
  samples?: number;
}
export interface BoardOddsResult {
  byMove: Record<string, BoardOdds>;
  checked: number;
  total: number;
  bagSize: number;
}

interface LeaveNode {
  children: Map<string, LeaveNode>;
  weight: number;
}
const leaveNode = (): LeaveNode => ({ children: new Map(), weight: 0 });

/** Dictionary-only index reused as the board and rack change. */
export class RackBingoIndex {
  private cached?: {
    size: number;
    lengths: number;
    blanks: number;
    racks: Set<string> | null;
  };

  constructor(private words: readonly string[]) {}

  private winningRacks(size: number, lengths: number, blanks: number) {
    if (
      this.cached?.size === size &&
      this.cached.lengths === lengths &&
      this.cached.blanks === blanks
    )
      return this.cached.racks;
    // Filling two or more spare slots for every anagram grows too quickly.
    if (lengths & ((1 << (size - 1)) - 1)) return null;
    const deadline = performance.now() + 500;
    const natural = new Set<string>();
    for (const word of this.words) {
      if (word.length <= size && lengths & (1 << word.length))
        natural.add(sortTiles(word));
    }
    const racks = new Set<string>();
    let generated = 0;
    function record(letters: string, count: number) {
      const rack = "?".repeat(count) + letters;
      if (rack.length === size) racks.add(rack);
      else {
        for (const tile of TILE_SYMBOLS) {
          if (tile !== "?" || count < blanks) racks.add(sortTiles(rack + tile));
        }
      }
      if (
        racks.size > INDEX_LIMIT ||
        ((++generated & 1023) === 0 && performance.now() >= deadline)
      )
        throw new SearchLimitError();
    }
    function addBlanks(letters: string, start: number, count: number) {
      if (count > blanks) return;
      for (let i = start; i < letters.length; i++) {
        if (i > start && letters[i] === letters[i - 1]) continue;
        const reduced = letters.slice(0, i) + letters.slice(i + 1);
        record(reduced, count);
        addBlanks(reduced, i, count + 1);
      }
    }
    try {
      for (const letters of natural) {
        record(letters, 0);
        addBlanks(letters, 0, 1);
      }
      this.cached = { size, lengths, blanks, racks };
    } catch (error) {
      if (!(error instanceof SearchLimitError)) throw error;
      this.cached = { size, lengths, blanks, racks: null };
    }
    return this.cached.racks;
  }

  calculate(
    lexicon: Lexicon,
    position: Position,
    template: BoardTemplate,
    moves: readonly Pick<Move, "leave">[],
    knownBagSize?: number,
  ): RackOdds {
    const { tiles, total, excess } = unseenTiles(position, template);
    const size = template.rackSize;
    const minimum = minimumBingoTiles(template);
    const lengths = bingoTileCounts(template).reduce(
      (mask, count) => mask | (1 << count),
      0,
    );
    const bagSize = knownBagSize ?? Math.max(0, total - size);
    const byLeave: Record<string, number> = Object.create(null);
    if (excess.length)
      return {
        byLeave,
        exact: true,
        bagSize,
        error: "Check the starting tile counts to calculate bingo odds.",
      };
    const leaves = [...new Set(moves.map((move) => move.leave))];
    const drawSize = (leave: string) => Math.min(bagSize, size - leave.length);
    const eligible = leaves.filter((leave) => {
      if (leave.length + drawSize(leave) >= minimum) return true;
      byLeave[leave] = 0;
      return false;
    });
    if (!eligible.length) return { byLeave, exact: true, bagSize };
    const blanks = Math.min(
      size,
      tiles[26].count +
        [...position.rack].filter((letter) => letter === "?").length,
    );
    const rackSizes = new Set(
      eligible.map((leave) => leave.length + drawSize(leave)),
    );
    const refillSize = rackSizes.values().next().value!;
    const refillLengths = lengths & ((1 << (refillSize + 1)) - 1);
    const winning =
      rackSizes.size === 1
        ? this.winningRacks(refillSize, refillLengths, blanks)
        : null;
    const deadline = performance.now() + 700;
    if (winning) {
      const weights = tiles.map(({ count }) =>
        Array.from({ length: size + 1 }, (_, used) => choose(count, used)),
      );
      const root = leaveNode();
      const endings = eligible.map((leave) => {
        let node = root;
        for (const letter of sortTiles(leave)) {
          let child = node.children.get(letter);
          if (!child) {
            child = leaveNode();
            node.children.set(letter, child);
          }
          node = child;
        }
        return node;
      });
      // A successful rack contributes to each contained leave. Its draw weight
      // is the product of the combinations of unseen copies for each letter.
      function addRack(
        letters: string,
        i: number,
        node: LeaveNode,
        weight: number,
      ) {
        if (i === letters.length) {
          node.weight += weight;
          return;
        }
        const letter = letters[i];
        let end = i + 1;
        while (letters[end] === letter) end++;
        const row = weights[letterCode(letter)];
        let at: LeaveNode | undefined = node;
        for (let draws = end - i; draws >= 0 && at; draws--) {
          if (row[draws]) addRack(letters, end, at, weight * row[draws]);
          at = at.children.get(letter);
        }
      }
      let checked = 0;
      for (const letters of winning) {
        addRack(letters, 0, root, 1);
        if ((++checked & 1023) === 0 && performance.now() >= deadline) break;
      }
      if (checked === winning.size) {
        eligible.forEach((leave, i) => {
          byLeave[leave] = Math.min(
            1,
            endings[i].weight / choose(total, drawSize(leave)),
          );
        });
        return { byLeave, exact: true, bagSize };
      }
    }

    // Use shared, bounded samples when indexing every winning rack is too large.
    const sampleDeadline = performance.now() + 1_000;
    const maxDraw = Math.max(...eligible.map(drawSize));
    const pool = tiles.flatMap(({ symbol, count }) =>
      Array<string>(count).fill(symbol),
    );
    const deals = Array.from({ length: SAMPLES }, () =>
      sampleTiles(pool, maxDraw, Math.random),
    );
    const memo = new Map<string, boolean>();
    try {
      for (const leave of eligible) {
        let hits = 0;
        for (const deal of deals) {
          if (performance.now() >= sampleDeadline) throw new SearchLimitError();
          const rack = sortTiles(leave + deal.slice(0, drawSize(leave)));
          let hit = memo.get(rack);
          if (hit === undefined) {
            hit = winning
              ? winning.has(rack)
              : canSpellRack(lexicon, rack, lengths, minimum, sampleDeadline);
            memo.set(rack, hit);
          }
          if (hit) hits++;
        }
        byLeave[leave] = hits / SAMPLES;
      }
      return { byLeave, exact: false, bagSize };
    } catch (error) {
      if (!(error instanceof SearchLimitError)) throw error;
      return {
        byLeave: {},
        exact: false,
        bagSize,
        error: "This tile set exceeded the bingo draw calculation limit.",
      };
    }
  }
}

function canSpellRack(
  lexicon: Lexicon,
  rack: string,
  lengths: number,
  minimum: number,
  deadline: number,
) {
  const counts = new Uint8Array(27);
  let available = 0;
  for (const tile of rack) {
    const code = letterCode(tile);
    counts[code]++;
    if (code < 26) available |= 1 << code;
  }
  let visited = 0;
  function walk(
    node: number,
    left: number,
    letters: number,
    blanks: number,
  ): boolean {
    if ((++visited & 255) === 0 && performance.now() >= deadline)
      throw new SearchLimitError();
    const played = rack.length - left;
    if (lexicon.terminal[node] && lengths & (1 << played)) return true;
    if (!left || lexicon.maxTail[node] < minimum - played) return false;
    const all = lexicon.mask[node];
    for (let possible = all & (blanks ? -1 : letters); possible; ) {
      const code = 31 - Math.clz32(possible),
        bit = 1 << code;
      possible ^= bit;
      const child = lexicon.first[node] + popcount(all >>> (code + 1));
      if (letters & bit) {
        const remaining = --counts[code] ? letters : letters ^ bit;
        const found = walk(child, left - 1, remaining, blanks);
        counts[code]++;
        if (found) return true;
      }
      if (blanks && walk(child, left - 1, letters, blanks - 1)) return true;
    }
    return false;
  }
  return walk(0, rack.length, available, counts[26]);
}

export function checkBoardBingo(
  lexicon: Lexicon,
  position: Position,
  template: BoardTemplate,
  candidates: readonly Move[],
  bagSize: number,
  progress: (checked: number) => void = () => {},
  random = Math.random,
): BoardOddsResult {
  const { tiles, total, excess } = unseenTiles(position, template);
  const minimum = minimumBingoTiles(template);
  if (excess.length)
    throw new Error("Check the starting tile counts to calculate board odds.");
  if (
    !Number.isInteger(bagSize) ||
    bagSize < Math.max(0, total - template.rackSize) ||
    bagSize > total
  ) {
    throw new Error("Check the number of tiles in the bag.");
  }
  if (!candidates.length || candidates.length > BOARD_ODDS_LIMIT) {
    throw new Error("Choose up to 20 moves to check.");
  }
  const pool = tiles.flatMap(({ symbol, count }) =>
    Array<string>(count).fill(symbol),
  );
  const maxDraw = Math.min(bagSize, template.rackSize);
  const deals = Array.from({ length: SAMPLES }, () =>
    sampleTiles(pool, maxDraw, random),
  );
  const drawsBySize = new Map<number, string[]>();
  const deadline = performance.now() + 8_000;
  const byMove: Record<string, BoardOdds> = Object.create(null);
  function canBingo(
    prepared: ReturnType<typeof prepareSolver>,
    rack: string,
    until: number,
  ) {
    const maxMs = Math.min(SEARCH_LIMITS.maxMs, until - performance.now());
    if (maxMs <= 0) throw new SearchLimitError();
    return !!prepared.solve(rack, { maxMs }, { bingoOnly: true }).length;
  }
  for (const [index, move] of candidates.entries()) {
    const size = Math.min(bagSize, template.rackSize - move.leave.length);
    if (move.leave.length + size < minimum) {
      byMove[move.id] = { chance: 0, exact: true };
    } else {
      // Let unused time carry forward while reserving time for later rows.
      const now = performance.now();
      if (now >= deadline) break;
      const until = now + (deadline - now) / (candidates.length - index);
      const prepared = prepareSolver(
        lexicon,
        placeTiles(position.board, move),
        template,
      );
      if (size <= 2) {
        try {
          const start = performance.now();
          const exactUntil =
            start + Math.min(DRAW_TIMEOUT, (until - start) / 2);
          let hits = 0;
          let total = 0;
          for (const { draw, weight } of weightedDraws(pool, size)) {
            if (canBingo(prepared, move.leave + draw, exactUntil))
              hits += weight;
            total += weight;
          }
          byMove[move.id] = { chance: hits / total, exact: true };
        } catch (error) {
          if (!(error instanceof SearchLimitError)) throw error;
        }
      }
      if (!byMove[move.id]) {
        let draws = drawsBySize.get(size);
        if (!draws) {
          // Preserve sample order so a truncated run uses a prefix of the deals.
          draws = deals.map((deal) => sortTiles(deal.slice(0, size)));
          drawsBySize.set(size, draws);
        }
        const memo = new Map<string, boolean>();
        let hits = 0;
        let samples = 0;
        try {
          for (const draw of draws) {
            let hit = memo.get(draw);
            if (hit === undefined) {
              hit = canBingo(prepared, move.leave + draw, until);
              memo.set(draw, hit);
            }
            if (hit) hits++;
            samples++;
          }
        } catch (error) {
          if (!(error instanceof SearchLimitError)) throw error;
        }
        if (samples >= MIN_BOARD_SAMPLES)
          byMove[move.id] = { chance: hits / samples, exact: false, samples };
      }
    }
    progress(Object.keys(byMove).length);
  }
  return {
    byMove,
    checked: Object.keys(byMove).length,
    total: candidates.length,
    bagSize,
  };
}
