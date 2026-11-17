const fallbackConcurrency = 2;

export function isWorkerCount(value: unknown): value is number {
  return typeof value === "number" && value >= 1 && Number.isSafeInteger(value);
}

export function browserConcurrency(): number | undefined {
  const hint = globalThis.navigator?.hardwareConcurrency;
  return isWorkerCount(hint) ? hint : undefined;
}

export function computeWorkerLimit(
  cap?: number,
  hint = browserConcurrency(),
): number {
  const available = isWorkerCount(hint) ? hint : fallbackConcurrency;
  return isWorkerCount(cap) ? Math.min(cap, available) : available;
}
