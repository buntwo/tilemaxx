/** Shared persistent word lists, also available to workers on plain HTTP LANs. */
export interface WordListStorage {
  get(url: string): Promise<string | undefined>;
  put(url: string, text: string): Promise<void>;
}

function database(databaseName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Word-list storage is busy."));
    request.onsuccess = () => resolve(request.result);
  });
}

function persistentStore<T>(databaseName: string, storeName: string): {
  get(key: string): Promise<T | undefined>;
  put(key: string, value: T): Promise<void>;
} {
  return {
    async get(key) {
      const db = await database(databaseName, storeName);
      try {
        return await new Promise<T | undefined>((resolve, reject) => {
          const request = db.transaction(storeName).objectStore(storeName).get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    },
    async put(key, value) {
      const db = await database(databaseName, storeName);
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(storeName, "readwrite");
          transaction.objectStore(storeName).put(value, key);
          transaction.oncomplete = () => resolve();
          transaction.onerror = transaction.onabort = () =>
            reject(transaction.error);
        });
      } finally {
        db.close();
      }
    },
  };
}

const storage: WordListStorage = persistentStore<string>("tilemaxx-word-lists", "words");
export type CachedVocabulary = { key: string; etag?: string; bytes: ArrayBuffer };
export const vocabularyStorage = persistentStore<CachedVocabulary>("tilemaxx-profile-vocabulary", "scores");

export const dictionaryUrl = (id: string) =>
  `/api/dictionaries/${encodeURIComponent(id)}`;

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
