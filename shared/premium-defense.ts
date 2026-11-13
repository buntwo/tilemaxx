import { type Lexicon } from "./lexicon";
import {
  letterBonuses,
  tileScore,
  wordBonuses,
  type BoardTemplate,
  type Move,
  type Position,
  type Premium,
} from "./model";
import { prepareSolver, SearchLimitError, type PremiumReply } from "./solver";
import { unseenTiles } from "./tile-pool";

export const DEFENSE_LIMIT = 20;
const ALL_LETTERS = (1 << 26) - 1;
const HIGH_PREMIUMS = new Set<Premium>(["TW", "QW", "TL", "QL"]);

export interface PremiumChange {
  square: number;
  premium: Premium;
  before?: PremiumReply;
  after?: PremiumReply;
}

export interface MoveDefense {
  opened?: PremiumChange;
  closed?: PremiumChange;
  depth: 1 | 3;
}

export type DefenseResults = Record<string, MoveDefense>;

export function checkPremiumDefense(
  lexicon: Lexicon,
  position: Position,
  template: BoardTemplate,
  moves: readonly Move[],
  onQuick?: (results: DefenseResults) => void,
  onProgress?: (checked: number) => void,
): DefenseResults {
  const { size, rackSize, premiums, rules } = template;
  const board = [...position.board];
  const unseen = unseenTiles(position, template);
  const results: DefenseResults = {};
  if (!moves.length || !unseen.total || unseen.excess.length) return results;

  // Playing our rack tiles does not change the unseen pool. Held tiles are
  // still ours, and an unseen tile may already be on the opponent's rack.
  const counts = unseen.tiles.map(({ count }) => count);
  let natural = 0;
  for (let i = 0; i < 26; i++) if (counts[i]) natural |= 1 << i;
  const possible = counts[26] ? ALL_LETTERS : natural;
  const targets = new Set(
    premiums.flatMap((premium, i) =>
      !board[i] && HIGH_PREMIUMS.has(premium) ? [i] : [],
    ),
  );
  const affected: number[][] = board.map(() => []);
  const axes = [1, size];
  function canStep(cell: number, stride: number) {
    const next = cell + stride;
    return (
      next >= 0 &&
      next < board.length &&
      (Math.abs(stride) === size ||
        Math.floor(next / size) === Math.floor(cell / size))
    );
  }
  for (const square of targets) {
    affected[square].push(square);
    for (const stride of [1, -1, size, -size]) {
      let cell = square,
        gaps = 0;
      while (canStep(cell, stride)) {
        cell += stride;
        if (!board[cell]) {
          if (++gaps > rackSize) break;
          affected[cell].push(square);
        }
      }
    }
  }

  const crossMasks = new Map<string, number>();
  function hook(square: number): PremiumReply | undefined {
    if (board[square]) return;
    let allowed = possible,
      base = 0;
    const stems: { prefix: string; suffix: string }[] = [];
    for (const step of axes) {
      let prefix = "",
        suffix = "";
      for (let cell = square; canStep(cell, -step) && board[cell - step]; ) {
        cell -= step;
        prefix = board[cell].toUpperCase() + prefix;
        base += tileScore(board[cell], rules);
      }
      for (let cell = square; canStep(cell, step) && board[cell + step]; ) {
        cell += step;
        suffix += board[cell].toUpperCase();
        base += tileScore(board[cell], rules);
      }
      if (!prefix && !suffix) continue;
      stems.push({ prefix, suffix });
      const key = prefix + "." + suffix;
      let mask = crossMasks.get(key);
      if (mask === undefined) {
        mask = lexicon.crossMask(prefix, suffix);
        crossMasks.set(key, mask);
      }
      allowed &= mask;
      if (!allowed) return;
    }
    if (!stems.length) return;
    const premium = premiums[square];
    let best: PremiumReply | undefined;
    for (let bits = allowed; bits; bits &= bits - 1) {
      const bit = bits & -bits;
      const letter = String.fromCharCode(65 + 31 - Math.clz32(bit));
      const tile = natural & bit ? letter : letter.toLowerCase();
      const score =
        (base +
          stems.length *
            tileScore(tile, rules) *
            (letterBonuses[premium] ?? 1)) *
          (wordBonuses[premium] ?? 1) +
        (rackSize === 1 ? template.bingo : 0);
      if (best && best.score >= score) continue;
      const { prefix, suffix } = stems[0];
      best = {
        word: prefix + tile + suffix,
        score,
        tiles: [{ index: square, letter: tile }],
      };
    }
    return best;
  }

  function compare(
    result: MoveDefense,
    square: number,
    before?: PremiumReply,
    after?: PremiumReply,
  ) {
    const premium = premiums[square];
    const minimum = wordBonuses[premium] ? 22 : 25;
    const prior = before?.score ?? 0,
      next = after?.score ?? 0;
    if (next >= minimum && next - prior >= 5) {
      const opened = result.opened;
      if (!opened || next > opened.after!.score)
        result.opened = { square, premium, before, after };
    } else if (prior >= minimum && prior - next >= 5) {
      const closed = result.closed;
      if (!closed || prior > closed.before!.score)
        result.closed = { square, premium, before, after };
    }
  }

  const baseline = new Map(
    [...targets].map((square) => [square, hook(square)]),
  );
  const marked = new Uint32Array(board.length);
  for (const [i, move] of moves.entries()) {
    const result: MoveDefense = { depth: 1 };
    for (const { index, letter } of move.tiles) board[index] = letter;
    for (const { index } of move.tiles) {
      for (const square of affected[index]) {
        if (marked[square] === i + 1) continue;
        marked[square] = i + 1;
        compare(result, square, baseline.get(square), hook(square));
      }
    }
    for (const { index } of move.tiles) board[index] = "";
    if (result.opened || result.closed) results[move.id] = result;
  }
  if (onQuick) onQuick({ ...results });
  if (!targets.size || Math.min(unseen.total, rackSize) <= 1) return results;

  const deadline = performance.now() + 180;
  function shortReplies() {
    return prepareSolver(lexicon, board, template).premiumReplies(
      counts,
      targets,
      { maxNodes: 120_000, maxMs: Math.max(0, deadline - performance.now()) },
    );
  }
  let previous: Map<number, PremiumReply>;
  try {
    previous = shortReplies();
  } catch (error) {
    if (error instanceof SearchLimitError) return results;
    throw error;
  }
  let checked = 0;
  for (const move of moves.slice(0, DEFENSE_LIMIT)) {
    if (performance.now() >= deadline) break;
    const result: MoveDefense = { ...results[move.id], depth: 3 };
    const quickOpened = result.opened?.square;
    const quickClosed = result.closed?.square;
    for (const { index, letter } of move.tiles) board[index] = letter;
    try {
      const next = shortReplies();
      for (const square of targets) {
        // A newly playable hook matters even if a more tile-hungry reply
        // already scored just as well. Avoid contradicting that comparison.
        const before = previous.get(square);
        const after = next.get(square);
        const delta = (after?.score ?? 0) - (before?.score ?? 0);
        if (
          (square === quickOpened && delta < 0) ||
          (square === quickClosed && delta > 0)
        )
          continue;
        compare(result, square, before, after);
      }
      if (result.opened || result.closed) results[move.id] = result;
      onProgress?.(++checked);
    } catch (error) {
      if (!(error instanceof SearchLimitError)) throw error;
    } finally {
      for (const { index } of move.tiles) board[index] = "";
    }
  }
  return results;
}
