import { choose, type unseenTiles } from "./tile-pool";

/** The hypergeometric rack prior, restricted to racks containing the played tiles. */
export function playableRackPrior(
  pool: ReturnType<typeof unseenTiles>,
  rackSize: number,
  required: readonly string[],
) {
  const groups = pool.tiles
    .map(({ symbol, count }) => ({
      symbol,
      count,
      minimum: required.filter((tile) => tile === symbol).length,
    }))
    .filter(({ count, minimum }) => count || minimum);
  // ways[i][n] counts physical draws of n tiles from groups i onward.
  const ways = Array.from({ length: groups.length + 1 }, () =>
    Array<number>(rackSize + 1).fill(0),
  );
  ways[groups.length][0] = 1;
  for (let i = groups.length - 1; i >= 0; i--) {
    const { count, minimum } = groups[i];
    for (let n = 0; n <= rackSize; n++) {
      for (let k = minimum; k <= Math.min(n, count); k++)
        ways[i][n] += choose(count, k) * ways[i + 1][n - k];
    }
  }
  const total = ways[0][rackSize];

  function* choices(i: number, remaining: number) {
    const { count, minimum } = groups[i];
    for (let k = minimum; k <= Math.min(remaining, count); k++) {
      const combinations = choose(count, k);
      const weight = combinations * ways[i + 1][remaining - k];
      if (weight) yield { k, combinations, weight };
    }
  }

  function* draws(
    i: number,
    remaining: number,
    rack: string,
    weight: number,
  ): Generator<{ rack: string; weight: number }> {
    if (i === groups.length) {
      yield { rack, weight };
      return;
    }
    for (const { k, combinations } of choices(i, remaining))
      yield* draws(
        i + 1,
        remaining - k,
        rack + groups[i].symbol.repeat(k),
        weight * combinations,
      );
  }

  return {
    total,
    chance: total ? Math.min(1, total / choose(pool.total, rackSize)) : 0,
    enumerate(limit: number) {
      const results: { rack: string; weight: number }[] = [];
      if (!total) return results;
      for (const draw of draws(0, rackSize, "", 1)) {
        if (results.length === limit) return undefined;
        results.push(draw);
      }
      return results;
    },
    sample(random: () => number) {
      let rack = "",
        remaining = rackSize;
      for (let i = 0; i < groups.length; i++) {
        let target = random() * ways[i][remaining];
        let selected = 0;
        for (const { k, weight } of choices(i, remaining)) {
          selected = k;
          if (target < weight) break;
          target -= weight;
        }
        rack += groups[i].symbol.repeat(selected);
        remaining -= selected;
      }
      return rack;
    },
  };
}
