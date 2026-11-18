/** Approximate point value of a leave, for ranking moves before simulation. */
export function leaveValue(leave: string): number {
  let value = 0;
  let vowels = 0;
  let consonants = 0;
  let used = 0;
  for (const letter of leave) {
    if (letter === "?") {
      value += 12;
      continue;
    }
    if ("AEIOU".includes(letter)) vowels++;
    else consonants++;
    const bit = 1 << (letter.charCodeAt(0) - 65);
    if (used & bit) value -= 2;
    used |= bit;
    if (letter === "S") value += 5;
    else if ("AERNT".includes(letter)) value += 1;
    else if ("QVW".includes(letter)) value -= 3;
    else if ("JUXZ".includes(letter)) value -= 1;
  }
  return value - 1.4 * Math.max(0, Math.abs(vowels - consonants) - 1);
}
