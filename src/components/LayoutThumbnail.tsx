import type { Board, BoardTemplate, Premium } from "../../shared/model";

export default function LayoutThumbnail({
  template,
  board,
}: {
  template: BoardTemplate;
  board?: Board;
}) {
  const { size, start, premiums } = template;
  const cells = new Map<Premium | "played", string>();
  for (const [i, premium] of premiums.entries()) {
    const x = i % size;
    const y = Math.floor(i / size);
    const kind = board?.[i] ? "played" : premium;
    cells.set(
      kind,
      (cells.get(kind) ?? "") + `M${x + 0.08} ${y + 0.08}h0.84v0.84h-0.84z`,
    );
  }

  return (
    <svg
      className={board ? "board-thumbnail" : "layout-thumbnail"}
      viewBox={`-0.5 -0.5 ${size + 1} ${size + 1}`}
      aria-hidden="true"
    >
      {[...cells].map(([premium, path]) => (
        <path
          key={premium}
          className={premium === "played" ? "thumbnail-played" : undefined}
          fill={
            premium === "played"
              ? "var(--primary)"
              : `var(--${premium.toLowerCase() || "cell"})`
          }
          d={path}
        />
      ))}
      {!board && (
        <circle
          cx={(start % size) + 0.5}
          cy={Math.floor(start / size) + 0.5}
          r={0.26}
          fill="var(--text)"
        />
      )}
    </svg>
  );
}
