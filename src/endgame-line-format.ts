import type { EndgameLine } from "../shared/endgame";

export function endgameLength({ line }: EndgameLine) {
  const plies = line.length;
  const plays = line.filter((move) => move !== null).length;
  const passes = plies - plays;
  const label = `${plies} ${plies === 1 ? "ply" : "plies"}`;
  return {
    compact: passes ? `${label} (${plays})` : label,
    expanded: passes
      ? `${label} · ${plays} ${plays === 1 ? "play" : "plays"} · ${passes} ${passes === 1 ? "pass" : "passes"}`
      : label,
  };
}
