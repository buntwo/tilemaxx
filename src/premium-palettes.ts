import { RULE_NAMES } from "../shared/model";

export const gamePlatforms = [
  { name: "Scrabble GO", palette: "scrabble-go", aliases: ["scrabblego"] },
  {
    name: RULE_NAMES.wwf,
    palette: "words-with-friends",
    aliases: ["wwf", "wwf2", "words with friends 2"],
  },
  { name: RULE_NAMES.wordfeud, palette: "wordfeud", aliases: ["word feud"] },
  { name: RULE_NAMES.crossplay, palette: "crossplay", aliases: ["crossplay"] },
  { name: RULE_NAMES.lexulous, palette: "lexulous", aliases: [] },
  { name: "In person", palette: "in-person", aliases: ["in-person", "irl"] },
] as const;

export function premiumPalette(platform?: string) {
  const name = platform?.trim().toLowerCase().replace(/\s+/g, " ");
  return (
    gamePlatforms.find(
      (option) =>
        option.name.toLowerCase() === name ||
        option.aliases.some((alias) => alias === name),
    )?.palette ?? "default"
  );
}
