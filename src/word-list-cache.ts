/** Shared persistent word lists, also available to workers on plain HTTP LANs. */
export interface WordListStorage {
  get(url: string): Promise<string | undefined>;
  put(url: string, text: string): Promise<void>;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("tilemaxx-word-lists", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("words");
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Word-list storage is busy."));
    request.onsuccess = () => resolve(request.result);
  });
}

const storage: WordListStorage = {
  async get(url) {
    const db = await database();
    try {
      return await new Promise<string | undefined>((resolve, reject) => {
        const request = db.transaction("words").objectStore("words").get(url);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  },
  async put(url, text) {
    const db = await database();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("words", "readwrite");
        transaction.objectStore("words").put(text, url);
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () =>
          reject(transaction.error);
      });
    } finally {
      db.close();
    }
  },
};

export const dictionaryUrl = (id: string) =>
  `/api/dictionaries/${encodeURIComponent(id)}`;
export const familiarWordsUrl = "/dictionaries/moby-frequent.txt";

export async function loadWordList(
  url: string,
  options: { refresh?: boolean; storage?: WordListStorage } = {},
): Promise<{ text: string; persisted: boolean }> {
  const cache = options.storage ?? storage;
  const cached = await cache.get(url).catch(() => undefined);
  if (cached !== undefined && !options.refresh)
    return { text: cached, persisted: true };
  let response: Response;
  try {
    response = await fetch(url);
    if (!response.ok) throw new Error("Could not download the word list.");
    const text = await response.text();
    if (!text.trim() || /<\s*(?:!doctype|html)\b/i.test(text))
      throw new Error("The server did not return a word list.");
    let persisted = cached === text;
    if (!persisted) {
      try {
        await cache.put(url, text);
        persisted = true;
      } catch {
        // Storage failures must not prevent online solving.
      }
    }
    return { text, persisted };
  } catch (error) {
    if (cached !== undefined) return { text: cached, persisted: true };
    throw new Error(
      "This word list is not available offline yet. Connect to Tilemaxx to download it.",
      { cause: error },
    );
  }
}

export async function dictionaryText(id: string) {
  return (await loadWordList(dictionaryUrl(id))).text;
}
