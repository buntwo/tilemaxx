import { useMemo, useState } from "react";
import { isSimulatedStyle, isSoloSimulatedStyle } from "../shared/simulated-styles";
import type { MoveStyle } from "../shared/move-results";
import { PLAYER_PROFILES } from "../shared/player-profiles";

export function useGamePlayingStyle(gameId?: string, solo = false) {
  const [selections, setSelections] = useState(
    () => new Map<string, MoveStyle | undefined>(),
  );
  const key = gameId ? `tilemaxx:playing-style:${gameId}` : undefined;
  const stored = useMemo(() => {
    if (!key) return;
    try {
      const value = localStorage.getItem(key) ?? undefined;
      return isSimulatedStyle(value)
        ? (isSoloSimulatedStyle(value) === solo ? value : undefined)
        : PLAYER_PROFILES.find((profile) => profile === value);
    } catch {
      return undefined;
    }
  }, [key, solo]);

  function select(style?: MoveStyle) {
    if (!gameId || !key || (isSimulatedStyle(style) && isSoloSimulatedStyle(style) !== solo)) return;
    setSelections((current) => new Map(current).set(gameId, style));
    try {
      if (style) localStorage.setItem(key, style);
      else localStorage.removeItem(key);
    } catch {
      // Keep the in-memory selection if storage is unavailable.
    }
  }

  const style =
    gameId && selections.has(gameId) ? selections.get(gameId) : stored;
  return [style, select] as const;
}
