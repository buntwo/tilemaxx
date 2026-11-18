import type { Lexicon } from "./lexicon";
import {
  tileScore,
  wordBonuses,
  type BoardTemplate,
  type Move,
  type Position,
} from "./model";
import { choose, unseenTiles } from "./tile-pool";

export function createProfileDefense(
  lexicon: Lexicon,
  template: BoardTemplate,
) {
  const { size, premiums, rules } = template;
  const targets = premiums.flatMap((premium, index) =>
    premium === "TW" ? [index] : [],
  );
  const sameLine = (left: number, right: number) =>
    left % size === right % size ||
    Math.floor(left / size) === Math.floor(right / size);
  const affected = premiums.map((_, cell) =>
    targets.filter((target) => sameLine(cell, target)),
  );
  const cache = new Map<string, number>();
  function crossMask(prefix: string, suffix: string) {
    const key = `${prefix}.${suffix}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const mask = lexicon.crossMask(prefix, suffix);
    if (cache.size < 16_384) cache.set(key, mask);
    return mask;
  }
  function step(cell: number, stride: number) {
    const next = cell + stride;
    return next >= 0 &&
      next < premiums.length &&
      (Math.abs(stride) === size ||
        Math.floor(cell / size) === Math.floor(next / size))
      ? next
      : -1;
  }
  return (position: Position, bagSize: number) => {
    const pool = unseenTiles(position, template);
    const draws = Math.max(
      0,
      Math.min(pool.total - bagSize, template.rackSize),
    );
    const combinations = choose(pool.total, draws);
    const chance = pool.tiles.map(
      ({ count }) => 1 - choose(pool.total - count, draws) / combinations,
    );
    const possible =
      chance[26] > 0
        ? (1 << 26) - 1
        : chance.reduce(
            (mask, probability, index) =>
              probability ? mask | (1 << index) : mask,
            0,
          );
    const board = [...position.board];
    function risk(cell: number) {
      if (board[cell]) return 0;
      let base = 0;
      let words = 0;
      let allowed = possible;
      for (const stride of [1, size]) {
        let prefix = "";
        let suffix = "";
        for (
          let next = step(cell, -stride);
          next >= 0 && board[next];
          next = step(next, -stride)
        ) {
          prefix = board[next].toUpperCase() + prefix;
          base += tileScore(board[next], rules);
        }
        for (
          let next = step(cell, stride);
          next >= 0 && board[next];
          next = step(next, stride)
        ) {
          suffix += board[next].toUpperCase();
          base += tileScore(board[next], rules);
        }
        if (!prefix && !suffix) continue;
        allowed &= crossMask(prefix, suffix);
        if (!allowed) return 0;
        words++;
      }
      if (!words) return 0;
      const premium = wordBonuses[premiums[cell]] ?? 1;
      let strongest = Math.max(0, base * premium - 18) * chance[26];
      for (let bits = allowed; bits; bits &= bits - 1) {
        const index = 31 - Math.clz32(bits & -bits);
        const face = tileScore(String.fromCharCode(65 + index), rules);
        strongest = Math.max(
          strongest,
          Math.max(0, (base + words * face) * premium - 18) * chance[index],
        );
      }
      return strongest;
    }
    const before = new Map(
      targets
        .filter((index) => !board[index])
        .map((index) => [index, risk(index)]),
    );
    return (move: Move) => {
      let opened = 0;
      let closed = 0;
      const checked = new Set<number>();
      for (const { index, letter } of move.tiles) board[index] = letter;
      for (const { index } of move.tiles) {
        for (const target of affected[index]) {
          if (checked.has(target) || !before.has(target)) continue;
          checked.add(target);
          const delta = risk(target) - before.get(target)!;
          opened = Math.max(opened, delta);
          closed = Math.max(closed, -delta);
        }
      }
      for (const { index } of move.tiles) board[index] = "";
      return opened - closed;
    };
  };
}
