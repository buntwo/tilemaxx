import type { Board } from "../../shared/model";

export default function BoardThumbnail({
  board,
  size,
}: {
  board: Board;
  size: number;
}) {
  // Connect occupied neighbors, with no grid lines or tile labels.
  const runs: string[] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; ) {
      if (!board[row * size + col]) {
        col++;
        continue;
      }
      const start = col;
      do {
        col++;
      } while (col < size && board[row * size + col]);
      runs.push(`M${start + 0.45} ${row + 0.5}H${col - 0.45}`);
      if (row + 1 < size)
        for (let x = start; x < col; x++) {
          if (board[(row + 1) * size + x])
            runs.push(`M${x + 0.5} ${row + 0.5}v1`);
        }
    }
  }
  return (
    <svg
      className="board-thumbnail"
      viewBox={`-1 -1 ${size + 2} ${size + 2}`}
      aria-hidden="true"
    >
      <path
        d={runs.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={0.86}
        strokeLinecap="round"
      />
    </svg>
  );
}
