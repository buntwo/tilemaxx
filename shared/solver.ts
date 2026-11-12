import { Lexicon } from "./lexicon";
import {
  type Board,
  type BoardTemplate,
  type Move,
  type Placement,
  tileScore,
  SCORES,
} from "./model";

const ALL = (1 << 26) - 1;
export const SEARCH_LIMITS = {
  maxNodes: 2_000_000,
  maxMoves: 150_000,
  maxMs: 2_000,
};
export class SearchLimitError extends Error {
  constructor() {
    super(
      "This search is too large to finish safely. Replace one or more blanks with known letters, or use a smaller word list, then try again. No partial results were shown.",
    );
    this.name = "SearchLimitError";
  }
}
export function solve(
  lexicon: Lexicon,
  board: Board,
  rack: string,
  template: BoardTemplate,
  limits: Partial<typeof SEARCH_LIMITS> = {},
): Move[] {
  const budget = { ...SEARCH_LIMITS, ...limits };
  for (const key of Object.keys(
    SEARCH_LIMITS,
  ) as (keyof typeof SEARCH_LIMITS)[]) {
    if (
      !Number.isFinite(budget[key]) ||
      budget[key] < 0 ||
      budget[key] > SEARCH_LIMITS[key]
    )
      throw new Error("Invalid search budget.");
  }
  const deadline = performance.now() + budget.maxMs;
  let nodes = 0;
  const n = template.size,
    scores = SCORES[template.rules];
  if (
    !Number.isInteger(n) ||
    n < 5 ||
    n > 25 ||
    board.length !== n * n ||
    template.premiums.length !== n * n
  )
    throw new Error("The board size does not match its layout.");
  if (
    !/^[A-Z?]*$/i.test(rack) ||
    rack.length > template.rackSize ||
    rack.length > 10
  )
    throw new Error("The rack contains invalid tiles or too many letters.");
  const counts = new Int8Array(27);
  for (const c of rack.toUpperCase())
    counts[c === "?" ? 26 : c.charCodeAt(0) - 65]++;
  const moves: Move[] = [],
    seen = new Set<string>(),
    empty = !board.some(Boolean);
  const value = (i: number) => tileScore(board[i], template.rules);
  const letterBonuses: Record<string, number> = { DL: 2, TL: 3, QL: 4 },
    wordBonuses: Record<string, number> = { DW: 2, TW: 3, QW: 4 };
  const letterMultiplier = (i: number) =>
    letterBonuses[template.premiums[i]] ?? 1;
  const wordMultiplier = (i: number) => wordBonuses[template.premiums[i]] ?? 1;
  const letterAt = (i: number) => board[i]?.toUpperCase() || "";
  for (const direction of ["across", "down"] as const) {
    const across = direction === "across";
    const index = (line: number, pos: number) =>
      across ? line * n + pos : pos * n + line;
    const crosses = Array.from({ length: n * n }, () => ({
      mask: ALL,
      sum: 0,
      prefix: "",
      suffix: "",
    }));
    const anchors = new Set<number>();
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        if (board[i]) continue;
        if (
          empty
            ? i === template.start
            : (r > 0 && board[i - n]) ||
              (r < n - 1 && board[i + n]) ||
              (c > 0 && board[i - 1]) ||
              (c < n - 1 && board[i + 1])
        )
          anchors.add(i);
        let prefix = "",
          suffix = "",
          sum = 0;
        const crossLine = across ? c : r,
          crossPos = across ? r : c;
        const ix = (p: number) =>
          across ? p * n + crossLine : crossLine * n + p;
        for (let p = crossPos - 1; p >= 0 && board[ix(p)]; p--) {
          prefix = letterAt(ix(p)) + prefix;
          sum += value(ix(p));
        }
        for (let p = crossPos + 1; p < n && board[ix(p)]; p++) {
          suffix += letterAt(ix(p));
          sum += value(ix(p));
        }
        let mask = ALL;
        if (prefix || suffix) {
          mask = 0;
          for (let letter = 0; letter < 26; letter++)
            if (lexicon.has(prefix + String.fromCharCode(65 + letter) + suffix))
              mask |= 1 << letter;
        }
        crosses[i] = { mask, sum, prefix, suffix };
      }
    for (let line = 0; line < n; line++)
      for (let start = 0; start < n; start++) {
        if (performance.now() >= deadline) throw new SearchLimitError();
        if (start > 0 && board[index(line, start - 1)]) continue;
        // Skip starts that cannot reach an anchor with the tiles in this rack.
        let needed = 0,
          reachable = false;
        for (let p = start; p < n; p++) {
          const i = index(line, p);
          if (!board[i]) needed++;
          if (needed > rack.length) break;
          if (anchors.has(i)) {
            reachable = true;
            break;
          }
        }
        if (!reachable) continue;
        const placed: Placement[] = [],
          crossWords: string[] = [];
        function walk(
          pos: number,
          node: number,
          word: string,
          sum: number,
          multiplier: number,
          crossScore: number,
          connected: boolean,
          blanks: number,
        ) {
          if (
            ++nodes > budget.maxNodes ||
            (nodes % 256 === 0 && performance.now() >= deadline)
          )
            throw new SearchLimitError();
          const i = pos < n ? index(line, pos) : -1;
          if (
            lexicon.terminal[node] &&
            word.length >= 2 &&
            placed.length &&
            connected &&
            (pos === n || !board[i])
          ) {
            const id = placed
              .map((t) => `${t.index}:${t.letter}`)
              .sort()
              .join(",");
            if (!seen.has(id)) {
              if (moves.length >= budget.maxMoves) throw new SearchLimitError();
              seen.add(id);
              let leave = "";
              for (let k = 0; k < 27; k++)
                leave += (k === 26 ? "?" : String.fromCharCode(65 + k)).repeat(
                  counts[k],
                );
              moves.push({
                id,
                word,
                row: across ? line : start,
                col: across ? start : line,
                direction,
                score:
                  sum * multiplier +
                  crossScore +
                  (placed.length === template.rackSize ? template.bingo : 0),
                tiles: placed.map((t) => ({ ...t })),
                leave,
                blanks,
                crosses: [...crossWords],
              });
            }
          }
          if (pos === n) return;
          if (board[i]) {
            const child = lexicon.child(node, letterAt(i).charCodeAt(0) - 65);
            if (child)
              walk(
                pos + 1,
                child,
                word + letterAt(i),
                sum + value(i),
                multiplier,
                crossScore,
                connected,
                blanks,
              );
            return;
          }
          if (placed.length === rack.length) return;
          const cross = crosses[i],
            lm = letterMultiplier(i),
            wm = wordMultiplier(i);
          for (
            let child = lexicon.first[node];
            child;
            child = lexicon.next[child]
          ) {
            const code = lexicon.letters[child];
            if (!(cross.mask & (1 << code))) continue;
            const char = String.fromCharCode(65 + code);
            for (const blank of [false, true]) {
              const slot = blank ? 26 : code;
              if (!counts[slot]) continue;
              counts[slot]--;
              placed.push({
                index: i,
                letter: blank ? char.toLowerCase() : char,
              });
              const points = blank ? 0 : scores[char],
                hasCross = !!(cross.prefix || cross.suffix);
              if (hasCross) crossWords.push(cross.prefix + char + cross.suffix);
              walk(
                pos + 1,
                child,
                word + char,
                sum + points * lm,
                multiplier * wm,
                crossScore + (hasCross ? (cross.sum + points * lm) * wm : 0),
                connected || anchors.has(i),
                blanks + (blank ? 1 : 0),
              );
              if (hasCross) crossWords.pop();
              placed.pop();
              counts[slot]++;
            }
          }
        }
        walk(start, 0, "", 0, 1, 0, false, 0);
      }
  }
  return moves.sort(
    (a, b) =>
      b.score - a.score ||
      b.tiles.length - a.tiles.length ||
      a.word.localeCompare(b.word) ||
      a.id.localeCompare(b.id),
  );
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
