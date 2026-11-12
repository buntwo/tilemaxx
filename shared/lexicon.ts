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

/** Compact, sorted trie: about 11 bytes per node, without an object per letter. */
export class Lexicon {
  first: Int32Array;
  next: Int32Array;
  letters: Uint8Array;
  terminal: Uint8Array;
  count: number;
  constructor(words: string[]) {
    const capacity = 1 + words.reduce((n, w) => n + w.length, 0);
    const first = new Int32Array(capacity),
      next = new Int32Array(capacity),
      letters = new Uint8Array(capacity),
      terminal = new Uint8Array(capacity);
    let used = 1,
      previous = "",
      path = [0];
    // parseWords sorts inputs; sort defensively for callers constructing test dictionaries.
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
    this.first = first.slice(0, used);
    this.next = next.slice(0, used);
    this.letters = letters.slice(0, used);
    this.terminal = terminal.slice(0, used);
    this.count = words.length;
  }
  child(node: number, letter: number): number {
    for (let i = this.first[node]; i; i = this.next[i])
      if (this.letters[i] === letter) return i;
    return 0;
  }
  has(word: string): boolean {
    let node = 0;
    for (const char of word.toUpperCase()) {
      node = this.child(node, char.charCodeAt(0) - 65);
      if (!node) return false;
    }
    return !!this.terminal[node];
  }
}
