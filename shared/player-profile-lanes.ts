import {
  tileScore,
  wordBonuses,
  type Board,
  type BoardTemplate,
} from "./model";

// More empty squares make a reply harder to supply. A full-rack double
// triple is still significant because both multipliers apply to one word.
const reach = [0, 0, 1.2, 1.15, 1.1, 1, 0.95, 0.9, 0.75, 0.6, 0.5];
const allLetters = (1 << 26) - 1;

export function createPremiumLaneRisk(
  template: BoardTemplate,
  crossMask: (prefix: string, suffix: string) => number,
) {
  const { size, premiums, rules } = template;
  const multiplier = premiums.map((premium) => wordBonuses[premium] ?? 1);
  const lines = [1, size].flatMap((crossStep) =>
    Array.from({ length: size }, (_, line) => ({
      crossStep,
      cells: Array.from(
        { length: size },
        (_, offset) => line * crossStep + offset * (crossStep === 1 ? size : 1),
      ),
    })).filter(
      ({ cells }) => cells.filter((cell) => multiplier[cell] >= 3).length >= 2,
    ),
  );

  return (board: Board, counts: readonly number[], rackSize: number) => {
    if (rackSize < 2 || !lines.length) return undefined;
    let physical = 0;
    for (let letter = 0; letter < 26; letter++)
      if (counts[letter]) physical |= 1 << letter;
    const possible = counts[26] ? allLetters : physical;

    function step(cell: number, stride: number) {
      const next = cell + stride;
      return next >= 0 &&
        next < board.length &&
        (Math.abs(stride) === size ||
          Math.floor(cell / size) === Math.floor(next / size))
        ? next
        : -1;
    }

    function crossing(cell: number, stride: number) {
      let prefix = "";
      let suffix = "";
      for (
        let next = step(cell, -stride);
        next >= 0 && board[next];
        next = step(next, -stride)
      )
        prefix = board[next].toUpperCase() + prefix;
      for (
        let next = step(cell, stride);
        next >= 0 && board[next];
        next = step(next, stride)
      )
        suffix += board[next].toUpperCase();
      if (!prefix && !suffix) return { factor: 1, joins: false };

      const allowed = possible & crossMask(prefix, suffix);
      let choices = 0;
      let copies = counts[26];
      for (let bits = allowed; bits; bits &= bits - 1) {
        choices++;
        copies += counts[31 - Math.clz32(bits & -bits)];
      }
      // Tight side words or exhausted letters reduce the value of a lane.
      const flexibility = Math.min(1, (choices / 9) ** 0.4);
      return {
        factor: flexibility * Math.min(1, copies / 3) ** 0.4,
        joins: true,
      };
    }

    function measure() {
      const pairs = new Map<number, number>();
      const targets: number[] = [];
      for (const { cells, crossStep } of lines) {
        if (
          cells.filter((cell) => !board[cell] && multiplier[cell] >= 3).length <
          2
        )
          continue;
        const crossings = cells.map((cell) =>
          board[cell] ? undefined : crossing(cell, crossStep),
        );
        for (let start = 0; start < size - 1; start++) {
          if (start && board[cells[start - 1]]) continue;
          let gaps = 0;
          let points = 0;
          let joins = false;
          let flexibility = 1;
          targets.length = 0;
          for (let end = start; end < size; end++) {
            const cell = cells[end];
            const cross = crossings[end];
            if (!cross) {
              points += tileScore(board[cell], rules);
              joins = true;
            } else {
              if (++gaps > rackSize || !cross.factor) break;
              joins ||= cross.joins;
              flexibility *= cross.factor;
              if (multiplier[cell] >= 3) targets.push(cell);
            }
            // A reply must be connected and include any adjacent main-line tiles.
            if (!joins || targets.length < 2 || board[cells[end + 1]]) continue;
            const anchorValue = 1 + Math.min(points, 8) * 0.055;
            const value = reach[gaps] * flexibility * anchorValue;
            for (const [index, first] of targets.entries()) {
              for (let i = index + 1; i < targets.length; i++) {
                const second = targets[i];
                const key = first * board.length + second;
                const risk =
                  (value * multiplier[first] * multiplier[second]) / 9;
                if (risk > (pairs.get(key) ?? 0)) pairs.set(key, risk);
              }
            }
          }
        }
      }
      return pairs;
    }

    const before = measure();
    return () => {
      let opened = 0;
      for (const [pair, risk] of measure())
        opened = Math.max(opened, risk - (before.get(pair) ?? 0));
      return opened;
    };
  };
}
