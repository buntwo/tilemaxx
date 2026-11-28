export function parseWords(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/\r?\n/)
        .map((line) =>
          line.trim().replace(/^"|"$/g, "").split(/\s+/)[0].toUpperCase(),
        )
        .filter((word) => /^[A-Z]{2,25}$/.test(word)),
    ),
  ].sort();
}

export function popcount(bits: number): number {
  bits -= (bits >>> 1) & 0x55555555;
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333);
  return (((bits + (bits >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export type LexiconIndex = Pick<Lexicon, "first" | "mask" | "terminal" | "maxTail" | "count">;

/** A DAWG with shared outgoing blocks, in descending letter order.
 * Each array entry describes an incoming edge's target; index zero is the root.
 * Terminal flags stay on entries so otherwise identical continuations can share.
 */
export class Lexicon {
  readonly first: Int32Array;
  readonly mask: Int32Array;
  readonly terminal: Uint8Array;
  readonly maxTail: Uint8Array;
  readonly count: number;

  static fromIndex(index: LexiconIndex): Lexicon {
    return Object.assign(Object.create(Lexicon.prototype) as Lexicon, index);
  }

  constructor(words: string[]) {
    const capacity = 1 + words.reduce((n, w) => n + w.length, 0);
    const first = new Int32Array(capacity),
      next = new Int32Array(capacity);
    const letters = new Uint8Array(capacity),
      terminal = new Uint8Array(capacity);
    let used = 1,
      previous = "";
    const path = [0];
    // Sorted words let construction append only the part after the shared prefix.
    for (const word of [...words].sort()) {
      let prefix = 0;
      while (prefix < word.length && previous[prefix] === word[prefix])
        prefix++;
      path.length = prefix + 1;
      for (let i = prefix; i < word.length; i++) {
        const parent = path[i],
          node = used++;
        letters[node] = word.charCodeAt(i) - 65;
        next[node] = first[parent];
        first[parent] = node;
        path.push(node);
      }
      terminal[path[word.length]] = 1;
      previous = word;
    }
    // Intern identical suffix states, from leaves toward the root. Terminal
    // status belongs to the incoming edge, so accepting/nonaccepting states
    // can share the same outgoing block (Appel & Jacobson, 1988).
    const groups = new Map<string, number>();
    const canonical = new Int32Array(used);
    const representatives: number[] = [];
    const tails: number[] = [];
    const offsets: number[] = [];
    let edges = 1; // Reserve index zero for the root / missing-child sentinel.
    for (let node = used - 1; node >= 0; node--) {
      let signature = "",
        tail = 0,
        count = 0;
      for (let child = first[node]; child; child = next[child]) {
        signature += `${letters[child]}:${terminal[child]}:${canonical[child]},`;
        tail = Math.max(tail, 1 + tails[canonical[child]]);
        count++;
      }
      let group = groups.get(signature);
      if (group === undefined) {
        group = representatives.length;
        groups.set(signature, group);
        representatives.push(node);
        tails.push(tail);
        offsets.push(edges);
        edges += count;
      }
      canonical[node] = group;
    }
    this.first = new Int32Array(edges);
    this.mask = new Int32Array(edges);
    this.terminal = new Uint8Array(edges);
    this.maxTail = new Uint8Array(edges);
    this.count = words.length;
    const masks = new Int32Array(representatives.length);
    for (let group = 0; group < representatives.length; group++) {
      for (
        let child = first[representatives[group]];
        child;
        child = next[child]
      )
        masks[group] |= 1 << letters[child];
    }
    const write = (index: number, node: number) => {
      const group = canonical[node];
      this.first[index] = offsets[group];
      this.mask[index] = masks[group];
      this.terminal[index] = terminal[node];
      this.maxTail[index] = tails[group];
    };
    write(0, 0);
    for (let group = 0; group < representatives.length; group++) {
      let index = offsets[group];
      for (
        let child = first[representatives[group]];
        child;
        child = next[child]
      )
        write(index++, child);
    }
  }

  /** Enumerate the indexed words without retaining a second full word list. */
  *words(): Generator<string> {
    const { first, mask, terminal } = this;
    function* visit(node: number, prefix: string): Generator<string> {
      if (terminal[node]) yield prefix;
      let child = first[node];
      for (let bits = mask[node]; bits; child++) {
        const code = 31 - Math.clz32(bits);
        bits ^= 1 << code;
        yield* visit(child, prefix + String.fromCharCode(65 + code));
      }
    }
    yield* visit(0, "");
  }

  child(node: number, letter: number): number {
    if (letter < 0 || letter >= 26) return 0;
    const mask = this.mask[node];
    return mask & (1 << letter)
      ? this.first[node] + popcount(mask >>> (letter + 1))
      : 0;
  }

  private follow(node: number, text: string): number {
    for (let i = 0; i < text.length; i++) {
      node = this.child(node, text.charCodeAt(i) - 65);
      if (!node) break;
    }
    return node;
  }

  has(word: string): boolean {
    const node = this.follow(0, word.toUpperCase());
    return (node !== 0 || word.length === 0) && !!this.terminal[node];
  }

  /** Letters that make a word when inserted between two fixed strings. */
  crossMask(prefix: string, suffix: string): number {
    const node = this.follow(0, prefix);
    if (prefix && !node) return 0;
    let allowed = 0,
      child = this.first[node];
    for (let bits = this.mask[node]; bits; child++) {
      const bit = 1 << (31 - Math.clz32(bits));
      const end = this.follow(child, suffix);
      if (end && this.terminal[end]) allowed |= bit;
      bits ^= bit;
    }
    return allowed;
  }
}
