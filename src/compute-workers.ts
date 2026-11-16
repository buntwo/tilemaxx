const maxComputeWorkers = 4;
const fallbackConcurrency = 2;

export function browserConcurrency(): number | undefined {
  const hint = globalThis.navigator?.hardwareConcurrency;
  return hint >= 1 && Number.isSafeInteger(hint) ? hint : undefined;
}

export function computeWorkerLimit(
  singleWorker = false,
  hint = browserConcurrency(),
): number {
  return singleWorker
    ? 1
    : Math.min(maxComputeWorkers, hint ?? fallbackConcurrency);
}
