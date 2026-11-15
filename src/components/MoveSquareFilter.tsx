import { useMemo, useState, type ReactNode } from "react";
import type { Game } from "../../shared/model";
import type { RequiredSquares } from "../../shared/move-results";

const noSquares: readonly number[] = [];

export function useMoveSquareFilter(game: Game | undefined) {
  const size = game?.template.size ?? 0;
  const key = game && JSON.stringify([game.id, size, game.board]);
  const [selection, setSelection] = useState({
    key,
    indices: noSquares,
    selecting: false,
  });
  if (selection.key !== key)
    setSelection({ key, indices: noSquares, selecting: false });

  const { indices, selecting } = selection;
  const marks = useMemo(() => new Set(indices), [indices]);
  const requiredSquares = useMemo<RequiredSquares | undefined>(
    () => (indices.length ? { size, indices } : undefined),
    [size, indices],
  );

  return {
    marks,
    requiredSquares,
    selecting,
    setSelecting(selecting: boolean) {
      setSelection((current) => ({ ...current, selecting }));
    },
    toggle(index: number) {
      setSelection((current) => ({
        ...current,
        indices: current.indices.includes(index)
          ? current.indices.filter((i) => i !== index)
          : [...current.indices, index].sort((a, b) => a - b),
      }));
    },
    clear() {
      setSelection((current) => ({ ...current, indices: noSquares }));
    },
  };
}

export function MoveSquareFilterControls({
  count,
  onClear,
  onDone,
  historyControls,
}: {
  count: number;
  onClear: () => void;
  onDone: () => void;
  historyControls?: ReactNode;
}) {
  return (
    <div className="move-square-controls">
      <span
        role="status"
        aria-label={
          !count && historyControls
            ? "Mark squares a word must cover"
            : undefined
        }
      >
        {count
          ? `${count} ${count === 1 ? "square" : "squares"} selected`
          : historyControls
            ? "Mark squares"
            : "Mark squares a word must cover"}
      </span>
      <button
        className="text-button"
        type="button"
        disabled={!count}
        onClick={onClear}
      >
        Clear
      </button>
      <button className="text-button" type="button" onClick={onDone}>
        Done
      </button>
      {historyControls}
    </div>
  );
}
