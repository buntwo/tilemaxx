import { RULE_NAMES } from "../shared/model";

export const gamePlatforms = [
  { name: "Scrabble GO", palette: "scrabble-go", board: "scrabble", aliases: ["scrabblego"] },
  {
    name: RULE_NAMES.wwf,
    palette: "words-with-friends",
    board: "wwf",
    aliases: ["wwf", "wwf2", "words with friends 2"],
  },
  { name: RULE_NAMES.wordfeud, palette: "wordfeud", board: "wordfeud", aliases: ["word feud"] },
  { name: RULE_NAMES.crossplay, palette: "crossplay", board: "crossplay", aliases: ["crossplay"] },
  { name: RULE_NAMES.lexulous, palette: "lexulous", board: "lexulous", aliases: [] },
  { name: "In person", palette: "in-person", board: "scrabble", aliases: ["in-person", "irl"] },
] as const;

export function defaultPlatformBoard(platform: string) {
  return gamePlatforms.find(({ name }) => name === platform)?.board;
}

export function matchGamePlatform(platform?: string) {
  const name = platform?.trim().toLowerCase().replace(/\s+/g, " ");
  return gamePlatforms.find(
    (option) =>
      option.name.toLowerCase() === name ||
      option.aliases.some((alias) => alias === name),
  );
}

export function premiumPalette(platform?: string) {
  return (
    matchGamePlatform(platform)?.palette ?? "default"
  );
}
