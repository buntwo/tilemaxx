// Pass a value from your perspective. For opponent metrics, reverse the change.
export function scoreTone(value: number | null | undefined) {
  if (value == null || value === 0) return undefined;
  return value > 0 ? "value-good" : "value-bad";
}

export function signedPoints(points: number, decimals = 0) {
  const value = Math.abs(points).toFixed(decimals);
  return Number(value) === 0 ? value : `${points < 0 ? "−" : "+"}${value}`;
}

export function finalMarginLabel(margin: number) {
  return margin > 0
    ? `Win by ${margin}`
    : margin < 0
      ? `Lose by ${-margin}`
      : "Tie";
}
