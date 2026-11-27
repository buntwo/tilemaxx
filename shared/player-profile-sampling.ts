import type { Board, Move } from "./model";
import { promoteLearnerRegions, type RackCue } from "./learner-attention";

const seedRange = 2 ** 32;
const areaWidth = 3;
const appealScale = 25;
export const DEFAULT_PROFILE_APPEAL = 48;
const LEARNER_APPEAL_HALF_LIFE = 3;

export function learnerAppeal(value: number) {
  return Math.min(Number.MAX_VALUE, 2 ** ((value - appealScale) / LEARNER_APPEAL_HALF_LIFE));
}

export function learnerLogAppeal(value: number) {
  return ((value - appealScale) / LEARNER_APPEAL_HALF_LIFE) * Math.LN2;
}

export function mixProfileSeed(value: number) {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

export function profileWordHash(text: string) {
  let hash = 2166136261;
  for (const character of text)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash;
}

export function profileAttention(
  board: Board,
  size: number,
  neighbors: readonly (readonly number[])[],
  salience: readonly number[],
  focus: number,
  hookAttention: number,
  seed: number,
  rackCues?: () => readonly RackCue[],
) {
  // Offset the partition each turn so a lane isn't always split at the same cell.
  const columns = Math.ceil((size + areaWidth - 1) / areaWidth);
  const rowOffset = mixProfileSeed(seed ^ 0x61c88647) % areaWidth;
  const colOffset = mixProfileSeed(seed ^ 0x3c6ef372) % areaWidth;
  const regionOf = (cell: number) =>
    Math.floor((Math.floor(cell / size) + rowOffset) / areaWidth) * columns +
    Math.floor((cell % size + colOffset) / areaWidth);
  const areas = new Map<number, { cells: number[]; salience: number }>();
  for (let cell = 0; cell < board.length; cell++) {
    if (board[cell] || !neighbors[cell].some((neighbor) => board[neighbor]))
      continue;
    const area = regionOf(cell);
    const prominence = (0.35 + hookAttention) * salience[cell];
    const entry = areas.get(area);
    if (entry) {
      entry.cells.push(cell);
      entry.salience = Math.max(entry.salience, prominence);
    } else {
      areas.set(area, { cells: [cell], salience: prominence });
    }
  }
  // The solver already restricts opening placements to the center.
  if (!areas.size) return undefined;
  const ordered = Array.from(areas, ([area, { cells, salience }]) => ({
    area,
    cells,
    priority:
      mixProfileSeed(seed ^ Math.imul(area + 1, 0x85ebca6b)) / seedRange +
      salience,
  })).sort((a, b) => b.priority - a.priority);
  const selected = new Uint8Array(board.length);
  const count = Math.min(
    ordered.length,
    Math.max(1, Math.round(focus * ordered.length)),
  );
  const chosen = ordered.slice(0, count);
  if (rackCues && count < ordered.length)
    promoteLearnerRegions(ordered, chosen, rackCues(), regionOf);
  for (const region of chosen)
    for (const cell of region.cells) selected[cell] = 1;
  return selected;
}

export function profileAppeal(value: number, strength: number) {
  const centered = value - appealScale;
  // Use the multiplier relative to a 25-point appeal. The common
  // normalization factor cancels out in every draw.
  return Math.exp(
    (0.5 * strength * centered) / (appealScale + Math.abs(centered)),
  );
}

type WeightedPlacement = { move: Move; weight: number };

function drawPriority(seed: number, weight: number, logWeights: boolean) {
  // Exponential clocks order a weighted draw without replacement.
  const draw = (mixProfileSeed(seed) + 0.5) / seedRange;
  const clock = -Math.log(draw);
  return logWeights ? Math.log(clock) - weight : clock / weight;
}

export function sampleProfilePlacements<T extends WeightedPlacement>(
  entries: readonly T[],
  seed: number,
  limit: number,
  logWeights = false,
) {
  if (!entries.length) return [];
  const weights = new Map<string, number>();
  for (const { move, weight } of entries) {
    const previous = weights.get(move.word);
    if (previous === undefined || weight > previous)
      weights.set(move.word, weight);
  }

  type Idea = { word: string; priority: number };
  const compareIdeas = (a: Idea, b: Idea) =>
    a.priority - b.priority || a.word.localeCompare(b.word);
  const ideas: Idea[] = [];
  for (const [word, weight] of weights) {
    const idea = {
      word,
      priority: drawPriority(seed ^ profileWordHash(word) ^ 0xb7e15162, weight, logWeights),
    };
    if (limit > 3) {
      ideas.push(idea);
      continue;
    }
    const index = ideas.findIndex((other) => compareIdeas(idea, other) < 0);
    if (index >= 0) ideas.splice(index, 0, idea);
    else if (ideas.length < limit) ideas.push(idea);
    if (ideas.length > limit) ideas.pop();
  }
  if (limit > 3) ideas.sort(compareIdeas);

  type Placement = { entry: T; priority: number };
  const comparePlacements = (a: Placement, b: Placement) =>
    a.priority - b.priority || a.entry.move.id.localeCompare(b.entry.move.id);
  const chosen = new Map<string, Placement | undefined>(
    ideas.map(({ word }) => [word, undefined]),
  );
  const includeAlternates = ideas.length < limit;
  const alternates: Placement[] = [];
  for (const entry of entries) {
    const { word, id } = entry.move;
    if (!chosen.has(word)) continue;
    const priority = drawPriority(
      seed ^ profileWordHash(id) ^ 0x243f6a88,
      entry.weight,
      logWeights,
    );
    const placement = { entry, priority };
    const previous = chosen.get(word);
    if (!previous || comparePlacements(placement, previous) < 0) {
      if (previous && includeAlternates) alternates.push(previous);
      chosen.set(word, placement);
    } else if (includeAlternates) {
      alternates.push(placement);
    }
  }
  const result = ideas.map(({ word }) => chosen.get(word)!.entry);
  if (includeAlternates) {
    alternates.sort(comparePlacements);
    for (const { entry } of alternates) {
      if (result.length === limit) break;
      result.push(entry);
    }
  }
  return result;
}
