// Pass a value from your perspective. For opponent metrics, reverse the change.
export function scoreTone(value: number | null | undefined) {
  if (value == null || value === 0) return undefined;
  return value > 0 ? "value-good" : "value-bad";
}
