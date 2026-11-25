import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import { parseWords } from "../shared/lexicon";
import {
  packFamiliarity,
  packProfileVocabulary,
  profileDictionaryRevision,
} from "../shared/profile-vocabulary";
import type { createStore } from "./store";

const compress = promisify(gzip);
const decompress = promisify(gunzip);
const header = "word,familiarity_score\n";
const maxCachedLists = 8;
type StudyFiles = { wow?: string; csw?: string };

function studyFiles(
  store: Pick<
    ReturnType<typeof createStore>,
    "dictionaries" | "dictionaryFile"
  >,
) {
  const lists = store.dictionaries();
  const files: StudyFiles = {};
  for (const [kind, pattern] of [
    ["wow", /^WOW24(?:V\d+)?$/],
    ["csw", /^CSW24(?:V\d+)?$/],
  ] as const) {
    const match = lists.find(({ id, name }) =>
      [id, name].some((value) =>
        pattern.test(
          value
            .toUpperCase()
            .replace(/\.TXT$/, "")
            .replace(/[^A-Z0-9]/g, ""),
        ),
      ),
    );
    if (match) files[kind] = store.dictionaryFile(match.id);
  }
  return files;
}

export function createProfileVocabularySource(
  root: string,
  files: () => StudyFiles,
) {
  let source: Promise<string> | undefined;
  function scores() {
    return (source ??= readFile(
      join(root, "server", "assets", "linguabase-v1.csv.gz"),
    )
      .then(decompress)
      .then((data) => {
        const text = data.toString("ascii");
        if (!text.startsWith(header))
          throw new Error("Invalid Linguabase familiarity source.");
        return text;
      })
      .catch((error) => {
        source = undefined;
        throw error;
      }));
  }

  async function pack(file: string, { wow, csw }: StudyFiles) {
    const [text, dictionary, wowText, cswText] = await Promise.all([
      scores(),
      readFile(file, "utf8"),
      wow && wow !== file ? readFile(wow, "utf8") : undefined,
      csw && csw !== file ? readFile(csw, "utf8") : undefined,
    ]);
    const words = parseWords(dictionary);
    const wowWords = wow === file ? words : wowText ? parseWords(wowText) : [];
    const cswWords = csw === file ? words : cswText ? parseWords(cswText) : [];
    const studied = new Set(wowWords.filter((word) => word.length <= 3));
    for (const word of cswWords) if (word.length === 2) studied.add(word);

    // Both sources are alphabetized tile spellings. Merge without storing a
    // 1.8-million-entry map on the server or in an analysis worker.
    let offset = header.length;
    let spelling = "";
    let comma = -1;
    let end = -1;
    function advance() {
      if (offset >= text.length) {
        spelling = "";
        return;
      }
      comma = text.indexOf(",", offset);
      end = text.indexOf("\n", comma);
      spelling = text.slice(offset, comma);
      offset = end + 1;
    }
    advance();
    const bytes = packProfileVocabulary(words, (word) => {
      while (spelling && spelling < word) advance();
      const score =
        spelling === word
          ? Math.floor(Number(text.slice(comma + 1, end)) * 100 + 1e-8)
          : undefined;
      return packFamiliarity(
        score,
        studied.has(word) || (!wow && !csw && word.length === 2),
      );
    });
    const revision = profileDictionaryRevision(words);
    const etag = `W/"${createHash("sha256").update(bytes).digest("hex")}"`;
    return { bytes, revision, etag, compressed: await compress(bytes) };
  }

  type Result = Awaited<ReturnType<typeof pack>>;
  const cache = new Map<string, { key: string; pending: Promise<Result> }>();
  return async (file: string) => {
    const study = files();
    const paths = [...new Set([file, study.wow, study.csw])].filter(
      (path): path is string => path !== undefined,
    );
    const stamps = await Promise.all(
      paths.map(async (path) => {
        const info = await stat(path);
        return [path, info.ino, info.size, info.mtimeMs, info.ctimeMs];
      }),
    );
    const key = JSON.stringify([study, stamps]);
    const existing = cache.get(file);
    cache.delete(file);
    const entry =
      existing?.key === key
        ? existing
        : {
            key,
            pending: pack(file, study),
          };
    cache.set(file, entry);
    if (cache.size > maxCachedLists) cache.delete(cache.keys().next().value!);
    try {
      return await entry.pending;
    } catch (error) {
      if (cache.get(file) === entry) cache.delete(file);
      throw error;
    }
  };
}

export type ProfileVocabularySource = ReturnType<
  typeof createProfileVocabularySource
>;

export const profileVocabularySource = (
  root: string,
  store: ReturnType<typeof createStore>,
) => createProfileVocabularySource(root, () => studyFiles(store));
