import { parseWords } from "../shared/lexicon";
import { dictionaryText } from "./word-list-cache";

export type WordListSource = string | File;
export type WordListCheckRequest = {
  id: number;
  word: string;
  source: WordListSource;
};
export type WordListCheckReply = { id: number } & (
  | { found: boolean }
  | { error: string }
);

let words: Promise<Set<string>> | undefined;

async function readWords(source: WordListSource) {
  if (typeof source !== "string" && source.size > 12_000_000)
    throw new Error("Choose a text file smaller than 12 MB.");
  const text =
    typeof source === "string"
      ? await dictionaryText(source)
      : await source.text();
  const list = new Set(parseWords(text));
  if (!list.size)
    throw new Error("This file contains no valid word list entries.");
  return list;
}

// Each worker serves one list and parses it only once.
self.onmessage = async ({
  data: { id, word, source },
}: MessageEvent<WordListCheckRequest>) => {
  const pending = (words ??= readWords(source));
  let reply: WordListCheckReply;
  try {
    reply = { id, found: (await pending).has(word) };
  } catch (error) {
    if (words === pending) words = undefined;
    reply = { id, error: (error as Error).message };
  }
  self.postMessage(reply);
};
