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

/** Static rack management for human styles. A blank can cover either side of
 * the vowel balance, and Q and U together have more uses than either alone. */
export function profileLeaveValue(leave: string) {
  let value = 0;
  let vowels = 0;
  let consonants = 0;
  let blanks = 0;
  let used = 0;
  for (const letter of leave) {
    value += leaveTileValue(letter);
    if (letter === "?") {
      blanks++;
      continue;
    }
    if ("AEIOU".includes(letter)) vowels++;
    else consonants++;
    const bit = 1 << (letter.charCodeAt(0) - 65);
    if (used & bit) value -= letter === "S" ? 1 : "CIUVW".includes(letter) ? 3 : 2;
    used |= bit;
  }
  if (leave.includes("Q")) value -= leave.includes("U") ? 0 : 2;
  // Aim for roughly three vowels per four consonants with room for the draw.
  const imbalance = Math.abs((8 * vowels - 6 * consonants) / 7);
  return value - 1.4 * Math.max(0, imbalance - 1 - blanks);
}
