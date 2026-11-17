import { Lexicon } from "./lexicon";
import type { Board } from "./model";

/** Conservative root-board filter. New words must preserve every fixed letter
 * and fill root-empty squares using only the tiles left in both racks. It
 * includes words that become playable later, without guessing future plays.
 * A deadline falls back to the full dictionary, never a partial word list.
 */
export function pruneEndgameDictionary(
  lexicon: Lexicon,
  board: Board,
  size: number,
  racks: string,
  deadline = performance.now() + 500,
): Lexicon {
  const available = new Int16Array(26);
  let blanks = 0;
  for (const letter of racks) {
    if (letter === "?") blanks++;
    else available[letter.charCodeAt(0) - 65]++;
  }
  const byLength = new Map<
    number,
    { fixed: [number, string][]; empty: number[] }[]
  >();
  for (let length = 2; length <= size; length++) {
    const patterns = new Set<string>();
    const windows: { fixed: [number, string][]; empty: number[] }[] = [];
    for (const step of [1, size])
      for (let line = 0; line < size; line++)
        for (let pos = 0; pos <= size - length; pos++) {
          const first = step === 1 ? line * size + pos : pos * size + line;
          if (
            (pos > 0 && board[first - step]) ||
            (pos + length < size && board[first + length * step])
          )
            continue;
          let pattern = "";
          const fixed: [number, string][] = [],
            empty: number[] = [];
          for (let i = 0; i < length; i++) {
            const letter = board[first + i * step].toUpperCase();
            pattern += letter || ".";
            if (letter) fixed.push([i, letter]);
            else empty.push(i);
          }
          if (
            !empty.length ||
            empty.length > racks.length ||
            patterns.has(pattern)
          )
            continue;
          patterns.add(pattern);
          windows.push({ fixed, empty });
        }
    byLength.set(length, windows);
    if (performance.now() >= deadline) return lexicon;
  }
  const words: string[] = [],
    needed = new Int16Array(26);
  let checked = 0;
  for (const word of lexicon.words()) {
    if ((++checked & 255) === 0 && performance.now() >= deadline)
      return lexicon;
    const windows = byLength.get(word.length);
    if (!windows) continue;
    windows: for (const { fixed, empty } of windows) {
      for (const [i, c] of fixed) if (word[i] !== c) continue windows;
      needed.fill(0);
      let deficit = 0;
      for (const i of empty) {
        const code = word.charCodeAt(i) - 65;
        if (++needed[code] > available[code] && ++deficit > blanks)
          continue windows;
      }
      words.push(word);
      break;
    }
  }
  if (performance.now() >= deadline || words.length === lexicon.count)
    return lexicon;
  return new Lexicon(words);
}
