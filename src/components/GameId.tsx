import { useRef } from "react";
import { Copy } from "lucide-react";

export default function GameId({
  id,
  onNotice,
}: {
  id: string;
  onNotice: (message: string) => void;
}) {
  const value = useRef<HTMLElement>(null);

  async function copy() {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(id);
        onNotice("Game ID copied.");
        return;
      }
    } catch {
      // Local HTTP installs and some browsers require the selection fallback.
    }

    if (value.current?.textContent !== id) return;
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(value.current);
      selection.removeAllRanges();
      selection.addRange(range);
      try {
        if (document.execCommand?.("copy")) {
          selection.removeAllRanges();
          onNotice("Game ID copied.");
          return;
        }
      } catch {
        // Leave the ID selected for manual copying.
      }
    }
    onNotice(
      selection
        ? "Game ID selected for copying."
        : "Select and copy the Game ID shown here.",
    );
  }

  return (
    <div className="game-id">
      <span>Game ID</span>
      <code ref={value}>{id}</code>
      <button
        className="icon-button"
        type="button"
        aria-label="Copy Game ID"
        title="Copy Game ID"
        onClick={() => void copy()}
      >
        <Copy size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
