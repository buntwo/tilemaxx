import type { Board, Move } from "./model";

export const ENDGAME_DELTA_LIMIT = 20;
export type EndgamePositionKey = {
  lo: number;
  hi: number;
  delta: Uint16Array;
  own: number;
  other: number;
  streak: number;
};
type BoardKey = Pick<EndgamePositionKey, "lo" | "hi" | "delta">;

// Reserve distinct codes for natural tiles and assigned blanks.
function tileCode(letter: string) {
  if (!/^[A-Za-z]$/.test(letter)) throw new Error("Invalid endgame tile.");
  return letter.charCodeAt(0) - (letter === letter.toUpperCase() ? 64 : 70);
}

/** A session has an immutable root. Store only placements added to that root;
 * this exact, sorted delta is also the collision check for the position hash.
 */
export function createEndgamePositionKeys(
  cells: number,
  place: (board: Board, move: Move) => Board,
) {
  if (!Number.isInteger(cells) || cells < 1 || cells > 1024)
    throw new Error("Invalid endgame board size.");
  let seed = 73193;
  const random = () => {
    let n = (seed = (seed + 0x9e3779b9) >>> 0);
    n = Math.imul(n ^ (n >>> 16), 0x21f0aaad);
    n = Math.imul(n ^ (n >>> 15), 0x735a2d97);
    return (n ^ (n >>> 15)) >>> 0;
  };
  const lows = Uint32Array.from({ length: cells * 53 }, random);
  const highs = Uint32Array.from({ length: cells * 53 }, random);
  const boards = new WeakMap<Board, BoardKey>();
  const racks = new Map<string, number>();
  let root: Board | undefined;
  function rackId(rack: string) {
    let id = racks.get(rack);
    if (id === undefined) {
      id = racks.size + 1;
      racks.set(rack, id);
    }
    return id;
  }
  function boardKey(board: Board): BoardKey {
    let cached = boards.get(board);
    if (cached) return cached;
    if (board.length !== cells) throw new Error("Endgame board size changed.");
    if (!root) root = [...board];
    let lo = 0,
      hi = 0;
    const delta: number[] = [];
    for (let i = 0; i < cells; i++) {
      if (board[i] === root[i]) continue;
      if (root[i] || !board[i])
        throw new Error("Endgame root position changed.");
      const code = tileCode(board[i]);
      delta.push(i * 64 + code);
      lo ^= lows[i * 53 + code];
      hi ^= highs[i * 53 + code];
    }
    if (delta.length > ENDGAME_DELTA_LIMIT)
      throw new Error("Too many endgame tiles.");
    cached = { lo: lo >>> 0, hi: hi >>> 0, delta: Uint16Array.from(delta) };
    boards.set(board, cached);
    return cached;
  }
  return {
    key(
      board: Board,
      own: string,
      other: string,
      streak: number,
    ): EndgamePositionKey {
      const b = boardKey(board),
        a = rackId(own),
        c = rackId(other);
      return {
        lo:
          (b.lo ^
            Math.imul(a, 0x9e3779b1) ^
            Math.imul(c, 0x85ebca6b) ^
            Math.imul(streak, 0xc2b2ae35)) >>>
          0,
        hi:
          (b.hi ^
            Math.imul(a, 0x27d4eb2d) ^
            Math.imul(c, 0x165667b1) ^
            streak) >>>
          0,
        delta: b.delta,
        own: a,
        other: c,
        streak,
      };
    },
    place(board: Board, move: Move): Board {
      const prior = boardKey(board);
      let lo = prior.lo,
        hi = prior.hi;
      const delta = Array.from(prior.delta);
      if (delta.length + move.tiles.length > ENDGAME_DELTA_LIMIT)
        throw new Error("Too many endgame tiles.");
      const changed = new Set<number>();
      for (const { index, letter } of move.tiles) {
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= cells ||
          board[index] ||
          changed.has(index)
        )
          throw new Error("Invalid endgame placement.");
        changed.add(index);
        const code = tileCode(letter);
        lo ^= lows[index * 53 + code];
        hi ^= highs[index * 53 + code];
        delta.push(index * 64 + code);
      }
      delta.sort((a, b) => a - b);
      const next = place(board, move);
      boards.set(next, {
        lo: lo >>> 0,
        hi: hi >>> 0,
        delta: Uint16Array.from(delta),
      });
      return next;
    },
  };
}
