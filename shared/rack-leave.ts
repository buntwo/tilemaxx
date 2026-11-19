/** Base contribution before duplicate and vowel balance penalties. */
export function leaveTileValue(letter: string) {
  if (letter === "?") return 12;
  if (letter === "S") return 5;
  if ("AERNT".includes(letter)) return 1;
  if ("QVW".includes(letter)) return -3;
  if ("JUXZ".includes(letter)) return -1;
  return 0;
}

/** Approximate point value of a leave, for ranking moves before simulation. */
export function leaveValue(leave: string): number {
  let value = 0;
  let vowels = 0;
  let consonants = 0;
  let used = 0;
  for (const letter of leave) {
    if (letter === "?") {
      value += leaveTileValue(letter);
      continue;
    }
    if ("AEIOU".includes(letter)) vowels++;
    else consonants++;
    const bit = 1 << (letter.charCodeAt(0) - 65);
    if (used & bit) value -= 2;
    used |= bit;
    value += leaveTileValue(letter);
  }
  return value - 1.4 * Math.max(0, Math.abs(vowels - consonants) - 1);
}
