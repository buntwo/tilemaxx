import { Redo2, Undo2 } from "lucide-react";

export default function BoardHistoryControls({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="icon-button board-undo"
        disabled={!canUndo}
        aria-label="Undo"
        aria-keyshortcuts="Alt+U"
        title="Undo (Alt/Option+U)"
        onClick={onUndo}
      >
        <Undo2 size={17} />
      </button>
      <button
        type="button"
        className="icon-button board-redo"
        disabled={!canRedo}
        aria-label="Redo"
        aria-keyshortcuts="Alt+Y"
        title="Redo (Alt/Option+Y)"
        onClick={onRedo}
      >
        <Redo2 size={17} />
      </button>
    </>
  );
}
