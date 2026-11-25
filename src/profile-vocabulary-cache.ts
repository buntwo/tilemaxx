import {
  decodeProfileVocabulary,
  profileDictionaryRevision,
  profileVocabularyUrl,
  type EnglishProfileVocabulary,
  type ProfileDictionary,
} from "../shared/profile-vocabulary";
import {
  dictionaryUrl,
  loadWordList,
  vocabularyStorage,
} from "./word-list-cache";

const revisions = new WeakMap<readonly string[], string>();
const pending = new Map<string, Promise<EnglishProfileVocabulary>>();

export async function fetchProfileVocabulary(
  dictionary: ProfileDictionary,
  url: string,
  storage = vocabularyStorage,
): Promise<EnglishProfileVocabulary> {
  const previous = await storage.get(dictionary.id).catch(() => undefined);
  let cached: EnglishProfileVocabulary | undefined;
  if (previous?.key === url) {
    try {
      cached = decodeProfileVocabulary(
        new Uint8Array(previous.bytes),
        dictionary.words,
      );
    } catch {
      // An invalid cache entry can be replaced when the server is reachable.
    }
  }
  if (cached && globalThis.navigator?.onLine === false) return cached;
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers:
        cached && previous?.etag
          ? { "If-None-Match": previous.etag }
          : undefined,
    });
  } catch (error) {
    if (cached) return cached;
    throw new Error(
      "Connect to Tilemaxx to download this game's playing style vocabulary.",
      { cause: error },
    );
  }
  if (response.status === 304 && cached) return cached;
  if (response.status === 409) {
    await loadWordList(dictionaryUrl(dictionary.id), { refresh: true }).catch(
      () => undefined,
    );
    throw new Error(
      "This word list changed. Reload Tilemaxx and find moves again.",
    );
  }
  if (!response.ok) {
    if (cached) return cached;
    throw new Error("Could not load this game's playing style vocabulary.");
  }
  const bytes = await response.arrayBuffer();
  const vocabulary = decodeProfileVocabulary(
    new Uint8Array(bytes),
    dictionary.words,
  );
  await storage
    .put(dictionary.id, {
      key: url,
      etag: response.headers.get("ETag") ?? undefined,
      bytes,
    })
    .catch(() => {});
  return vocabulary;
}

export function loadDictionaryVocabulary(dictionary: ProfileDictionary) {
  let revision = revisions.get(dictionary.words);
  if (revision === undefined) {
    revision = profileDictionaryRevision(dictionary.words);
    revisions.set(dictionary.words, revision);
  }
  const url = profileVocabularyUrl(dictionary.id, revision);
  const existing = pending.get(url);
  if (existing) return existing;
  const load = fetchProfileVocabulary(dictionary, url).catch((error) => {
    pending.delete(url);
    throw error;
  });
  pending.set(url, load);
  if (pending.size > 4) pending.delete(pending.keys().next().value!);
  return load;
}
