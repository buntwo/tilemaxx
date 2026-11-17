import type { Move } from "./model";
import {
  ENDGAME_DELTA_LIMIT,
  type EndgamePositionKey,
} from "./endgame-position";

export type EndgameTableEntry = {
  value: number;
  flag: "exact" | "lower" | "upper";
  depth: number;
  proved: boolean;
  best?: Pick<Move, "id"> | null;
};

/** Four-way buckets with exact state verification. The hash selects a bucket;
 * it never establishes equality. Scores retain full numeric precision.
 */
export function createEndgameTable(capacity: number) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 250_000)
    throw new Error("Invalid endgame table size.");
  const ways = 4,
    buckets = Math.ceil(capacity / ways);
  const lows = new Uint32Array(capacity),
    highs = new Uint32Array(capacity);
  const own = new Uint32Array(capacity),
    other = new Uint32Array(capacity);
  const streaks = new Uint8Array(capacity),
    lengths = new Uint8Array(capacity);
  const flags = new Uint8Array(capacity),
    depths = new Uint8Array(capacity);
  const proved = new Uint8Array(capacity),
    scores = new Float64Array(capacity);
  const moves = new Uint32Array(capacity),
    ages = new Uint32Array(capacity);
  const deltas = new Uint16Array(capacity * ENDGAME_DELTA_LIMIT);
  // Intern move IDs, not whole generated moves. Reference counts recycle IDs
  // on replacement so repeated continuation runs cannot grow this pool forever.
  const names: (string | undefined)[] = [];
  const ids = new Map<string, number>();
  const references = new Uint32Array(capacity + 2);
  const free: number[] = [];
  let size = 0,
    age = 0,
    evictions = 0;
  const flagNames = ["", "exact", "lower", "upper"] as const;
  function find(k: EndgamePositionKey) {
    const start = (k.lo % buckets) * ways;
    for (let i = start; i < Math.min(start + ways, capacity); i++) {
      if (
        !flags[i] ||
        lows[i] !== k.lo ||
        highs[i] !== k.hi ||
        own[i] !== k.own ||
        other[i] !== k.other ||
        streaks[i] !== k.streak ||
        lengths[i] !== k.delta.length
      )
        continue;
      let equal = true;
      for (let j = 0; j < k.delta.length; j++)
        if (deltas[i * ENDGAME_DELTA_LIMIT + j] !== k.delta[j]) {
          equal = false;
          break;
        }
      if (equal) return i;
    }
    return -1;
  }
  function releaseMove(id: number) {
    if (id < 2 || --references[id]) return;
    ids.delete(names[id - 2]!);
    names[id - 2] = undefined;
    free.push(id);
  }
  function retainMove(best: EndgameTableEntry["best"]) {
    if (best === undefined) return 0;
    if (best === null) return 1;
    let id = ids.get(best.id);
    if (id === undefined) {
      id = free.pop() ?? names.length + 2;
      names[id - 2] = best.id;
      ids.set(best.id, id);
    }
    references[id]++;
    return id;
  }
  return {
    get size() {
      return size;
    },
    get evictions() {
      return evictions;
    },
    get storageBytes() {
      return [
        lows,
        highs,
        own,
        other,
        streaks,
        lengths,
        flags,
        depths,
        proved,
        scores,
        moves,
        ages,
        deltas,
        references,
      ].reduce((n, a) => n + a.byteLength, 0);
    },
    get moveSlots() {
      return names.length;
    },
    get(k: EndgamePositionKey): EndgameTableEntry | undefined {
      const i = find(k);
      if (i < 0) return;
      const m = moves[i];
      return {
        value: scores[i],
        flag: flagNames[flags[i]] as EndgameTableEntry["flag"],
        depth: depths[i],
        proved: !!proved[i],
        best: m === 0 ? undefined : m === 1 ? null : { id: names[m - 2]! },
      };
    },
    set(k: EndgamePositionKey, e: EndgameTableEntry) {
      if (
        k.delta.length > ENDGAME_DELTA_LIMIT ||
        !Number.isInteger(e.depth) ||
        e.depth < 0 ||
        e.depth > 255 ||
        !Number.isInteger(k.streak) ||
        k.streak < 0 ||
        k.streak > 255
      )
        throw new Error("Packed endgame state overflow.");
      let i = find(k);
      if (i >= 0 && proved[i] && (flags[i] === 1 || !e.proved)) return;
      if (i < 0) {
        const start = (k.lo % buckets) * ways;
        let worst = Infinity,
          oldest = -1;
        for (let j = start; j < Math.min(start + ways, capacity); j++) {
          if (!flags[j]) {
            i = j;
            break;
          }
          const quality =
            proved[j] * 1000 + (flags[j] === 1 ? 500 : 0) + depths[j];
          const elapsed = (age - ages[j]) >>> 0;
          if (quality < worst || (quality === worst && elapsed > oldest)) {
            worst = quality;
            oldest = elapsed;
            i = j;
          }
        }
        if (flags[i]) evictions++;
        else size++;
      }
      releaseMove(moves[i]);
      const move = retainMove(e.best);
      moves[i] = move;
      lows[i] = k.lo;
      highs[i] = k.hi;
      own[i] = k.own;
      other[i] = k.other;
      streaks[i] = k.streak;
      lengths[i] = k.delta.length;
      deltas.set(k.delta, i * ENDGAME_DELTA_LIMIT);
      scores[i] = e.value;
      flags[i] = e.flag === "exact" ? 1 : e.flag === "lower" ? 2 : 3;
      depths[i] = e.depth;
      proved[i] = Number(e.proved);
      ages[i] = age = (age + 1) >>> 0;
    },
  };
}
