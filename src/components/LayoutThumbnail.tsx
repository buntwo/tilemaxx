import type { BoardTemplate, Premium } from "../../shared/model";

export default function LayoutThumbnail({
  template,
}: {
  template: BoardTemplate;
}) {
  const { size, start, premiums } = template;
  const cells = new Map<Premium, string>();
  for (const [i, premium] of premiums.entries()) {
    const x = i % size;
    const y = Math.floor(i / size);
    cells.set(
      premium,
      (cells.get(premium) ?? "") + `M${x + 0.08} ${y + 0.08}h0.84v0.84h-0.84z`,
    );
  }

  return (
    <svg
      className="layout-thumbnail"
      viewBox={`-0.5 -0.5 ${size + 1} ${size + 1}`}
      aria-hidden="true"
    >
      {[...cells].map(([premium, path]) => (
        <path
          key={premium}
          fill={`var(--${premium.toLowerCase() || "cell"})`}
          d={path}
        />
      ))}
      <circle
        cx={(start % size) + 0.5}
        cy={Math.floor(start / size) + 0.5}
        r={0.26}
        fill="var(--text)"
      />
    </svg>
  );
}
