import { useEffect, useEffectEvent } from "react";

export default function useKeyboardShortcuts({
  enabled,
  focusRack,
  toggleBoardCoordinates,
  changeGameHistory,
  searchGames,
  showGuide,
}: {
  enabled: boolean;
  focusRack: () => boolean;
  toggleBoardCoordinates: () => boolean;
  changeGameHistory: (action: "undo" | "redo") => boolean;
  searchGames: () => boolean;
  showGuide: () => void;
}) {
  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    if (
      !enabled ||
      event.defaultPrevented ||
      event.isComposing ||
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      document.querySelector("dialog[open]")
    )
      return;

    const key = event.key.toLowerCase();
    // Option generates a symbol instead of a letter on macOS.
    if (event.altKey && !event.shiftKey) {
      if ((key === "r" || event.code === "KeyR") && focusRack())
        event.preventDefault();
      else if ((key === "b" || event.code === "KeyB") && toggleBoardCoordinates())
        event.preventDefault();
      else if ((key === "u" || event.code === "KeyU") && changeGameHistory("undo"))
        event.preventDefault();
      else if ((key === "y" || event.code === "KeyY") && changeGameHistory("redo"))
        event.preventDefault();
      else if ((key === "f" || event.code === "KeyF") && searchGames())
        event.preventDefault();
      return;
    }
    if (event.altKey || key !== "?") return;
    if (
      event.target instanceof HTMLElement &&
      (event.target.isContentEditable ||
        event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])"))
    )
      return;
    event.preventDefault();
    showGuide();
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handleKey(event);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
