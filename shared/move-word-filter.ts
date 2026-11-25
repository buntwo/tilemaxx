import { RE2JS } from "re2js";

export function compileMoveWordFilter(source: string): {
  matches: (word: string) => boolean;
  error?: string;
} {
  const text = source.trim();
  if (!text) return { matches: () => true };
  if (text.length > 256)
    return { matches: () => false, error: "Use a pattern of 256 characters or fewer." };
  if (/^[a-z]+$/i.test(text)) {
    const word = text.toUpperCase();
    return { matches: (candidate) => candidate.includes(word) };
  }
  const pattern = text.startsWith("/") && text.endsWith("/") && text.length > 1
    ? text.slice(1, -1)
    : text;
  try {
    const regex = RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE);
    return { matches: (word) => regex.test(word) };
  } catch {
    return { matches: () => false, error: "Invalid or unsupported regular expression." };
  }
}
