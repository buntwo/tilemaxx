import {
  letterBonuses,
  tileScore,
  wordBonuses,
  type Board,
  type BoardTemplate,
} from "./model";

type CrossFit = { letter: string; points: number; tilePoints: number };
export type RackCue = { cells: readonly number[]; points: number };
type Region = { area: number };
const maxMainLength = 4;

function step(cell: number, offset: number, size: number) {
  const next = cell + offset;
  if (next < 0 || next >= size * size) return undefined;
  if (
    Math.abs(offset) === 1 &&
    Math.floor(next / size) !== Math.floor(cell / size)
  )
    return undefined;
  return next;
}

export function learnerRackCues(
  board: Board,
  { size, premiums, rules }: BoardTemplate,
  rack: string,
  knows: (word: string) => boolean,
): RackCue[] {
  const copies = new Map<string, number>();
  for (const letter of rack)
    if (letter >= "A" && letter <= "Z")
      copies.set(letter, (copies.get(letter) ?? 0) + 1);
  if (!copies.size) return [];
  const tiles = Array.from(copies.keys(), (letter) => ({
    letter,
    tilePoints: tileScore(letter, rules),
  }));

  function neighborsOf(
    first: number,
    last: number,
    stride: number,
    limit: number,
  ) {
    let prefix = "";
    let suffix = "";
    let points = 0;
    for (
      let cell = step(first, -stride, size);
      cell !== undefined && board[cell];
      cell = step(cell, -stride, size)
    ) {
      prefix = board[cell].toUpperCase() + prefix;
      if (prefix.length > limit) return;
      points += tileScore(board[cell], rules);
    }
    for (
      let cell = step(last, stride, size);
      cell !== undefined && board[cell];
      cell = step(cell, stride, size)
    ) {
      suffix += board[cell].toUpperCase();
      if (prefix.length + suffix.length > limit) return;
      points += tileScore(board[cell], rules);
    }
    return { prefix, suffix, points };
  }

  function crossFits(cell: number, stride: number): CrossFit[] | undefined {
    if (board[cell]) return;
    const cross = neighborsOf(cell, cell, stride, 2);
    if (!cross || (!cross.prefix && !cross.suffix)) return;
    const letterMultiplier = letterBonuses[premiums[cell]] ?? 1;
    const wordMultiplier = wordBonuses[premiums[cell]] ?? 1;
    const fits: CrossFit[] = [];
    for (const { letter, tilePoints } of tiles) {
      if (!knows(cross.prefix + letter + cross.suffix)) continue;
      const points =
        (cross.points + tilePoints * letterMultiplier) * wordMultiplier;
      fits.push({ letter, points, tilePoints });
    }
    if (fits.length) return fits;
  }

  const cues: RackCue[] = [];
  for (const stride of [1, size]) {
    const crossStride = stride === 1 ? size : 1;
    const options = board.map((_, cell) => crossFits(cell, crossStride));
    for (const [cell, fits] of options.entries()) {
      if (!fits) continue;
      const next = step(cell, stride, size);
      const single = neighborsOf(cell, cell, stride, maxMainLength - 1);
      for (const fit of fits) {
        if (
          (premiums[cell] || fit.tilePoints >= 5) &&
          (!single ||
            (!single.prefix && !single.suffix) ||
            knows(single.prefix + fit.letter + single.suffix))
        )
          cues.push({ cells: [cell], points: fit.points });
      }
      if (next === undefined) continue;
      const adjacent = options[next];
      if (!adjacent) continue;
      const pair = neighborsOf(cell, next, stride, maxMainLength - 2);
      for (const a of fits) {
        for (const b of adjacent) {
          if (a.letter === b.letter && copies.get(a.letter) === 1) continue;
          if (pair && !knows(pair.prefix + a.letter + b.letter + pair.suffix))
            continue;
          cues.push({ cells: [cell, next], points: a.points + b.points });
        }
      }
    }
  }
  return cues;
}

export function promoteLearnerRegions<T extends Region>(
  ordered: readonly T[],
  selected: T[],
  cues: readonly RackCue[],
  regionOf: (cell: number) => number,
) {
  const baseline = new Set(selected.map(({ area }) => area));
  const outside = ordered.slice(selected.length);
  const points = new Map<number, number>();
  const uncovered = [];
  for (const cue of cues) {
    const areas = cue.cells.map(regionOf);
    for (const area of areas)
      points.set(area, Math.max(points.get(area) ?? 0, cue.points));
    if (!areas.some((area) => baseline.has(area)))
      uncovered.push({ areas, points: cue.points });
  }

  let promoted: number | undefined;
  for (
    let slot = selected.length - 1;
    slot >= Math.max(0, selected.length - 2);
    slot--
  ) {
    const strength = new Map<number, number>();
    for (const cue of uncovered) {
      if (promoted !== undefined && cue.areas.includes(promoted)) continue;
      for (const area of cue.areas)
        strength.set(area, Math.max(strength.get(area) ?? 0, cue.points));
    }
    let best: T | undefined;
    let bestPoints = points.get(selected[slot].area) ?? 0;
    for (const region of outside) {
      const candidate = strength.get(region.area) ?? 0;
      if (candidate <= bestPoints) continue;
      best = region;
      bestPoints = candidate;
    }
    if (!best) break;
    selected[slot] = best;
    promoted = best.area;
  }
}
