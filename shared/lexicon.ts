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

/** Each node's children occupy a contiguous range, in descending letter order. */
export class Lexicon {
  readonly first: Int32Array;
  readonly mask: Int32Array;
  readonly terminal: Uint8Array;
  readonly maxTail: Uint8Array;
  readonly count: number;

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
    this.first = new Int32Array(used);
    this.mask = new Int32Array(used);
    this.terminal = new Uint8Array(used);
    this.maxTail = new Uint8Array(used);
    this.count = words.length;
    // Remap in breadth-first order so every set of siblings is adjacent.
    const original = new Int32Array(used);
    let free = 1;
    for (let node = 0; node < used; node++) {
      const old = original[node];
      this.terminal[node] = terminal[old];
      this.first[node] = free;
      for (let child = first[old]; child; child = next[child]) {
        this.mask[node] |= 1 << letters[child];
        original[free++] = child;
      }
    }
    for (let node = used - 1; node >= 0; node--) {
      const start = this.first[node],
        end = start + popcount(this.mask[node]);
      for (let child = start; child < end; child++) {
        this.maxTail[node] = Math.max(
          this.maxTail[node],
          1 + this.maxTail[child],
        );
      }
    }
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
