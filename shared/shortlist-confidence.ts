export const SHORTLIST_FIT_THRESHOLD = 0.8;
export const SHORTLIST_RANDOM_THRESHOLD = 0.25;
export const SHORTLIST_SAMPLE_CHECKPOINTS: readonly number[] = [
  128, 256, 512, 1024,
];

type Interval = { lower: number; upper: number };
type ShortlistFit = { fit: number; random: number };
export type ShortlistConfidence = {
  samples: number;
  fit: Interval;
  random: Interval;
};

// Per turn, spend the 5% error budget across both tails, both metrics,
// and all scheduled checks. This covers the check picked by early stopping.
const LOG_TAIL_BUDGET = Math.log(
  (2 * 2 * SHORTLIST_SAMPLE_CHECKPOINTS.length) / 0.05,
);

function meanInterval(mean: number, samples: number): Interval {
  mean = Math.min(1, Math.max(0, mean));
  const cutoff = LOG_TAIL_BUDGET / samples;
  // The Bernoulli KL bound also applies to independent draws in [0, 1],
  // including the fractional credits assigned to ties.
  function divergence(candidate: number) {
    const positive = mean > 0 ? mean * Math.log(mean / candidate) : 0;
    const negative =
      mean < 1 ? (1 - mean) * Math.log((1 - mean) / (1 - candidate)) : 0;
    return positive + negative;
  }

  let lower = 0;
  let lowInside = mean;
  let highInside = mean;
  let upper = 1;
  for (let i = 0; i < 40; i++) {
    const low = (lower + lowInside) / 2;
    if (divergence(low) > cutoff) lower = low;
    else lowInside = low;
    const high = (upper + highInside) / 2;
    if (divergence(high) > cutoff) upper = high;
    else highInside = high;
  }
  return { lower, upper };
}

export function shortlistConfidence(
  shortlist: ShortlistFit,
  samples: number,
): ShortlistConfidence {
  return {
    samples,
    fit: meanInterval(shortlist.fit, samples),
    random: meanInterval(shortlist.random, samples),
  };
}

export function classifyShortlist({
  fit,
  random,
}: Pick<ShortlistConfidence, "fit" | "random">): "high" | "low" | "borderline" {
  if (
    fit.upper < SHORTLIST_FIT_THRESHOLD ||
    random.lower > SHORTLIST_RANDOM_THRESHOLD
  )
    return "low";
  if (
    fit.lower >= SHORTLIST_FIT_THRESHOLD &&
    random.upper <= SHORTLIST_RANDOM_THRESHOLD
  )
    return "high";
  return "borderline";
}
