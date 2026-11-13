import type { BoardTemplate } from "../../shared/model";
import { thumbnailKinds, type GameThumbnail } from "../../shared/game-index";

export default function LayoutThumbnail(
  props: { template: BoardTemplate } | { thumbnail: GameThumbnail },
) {
  const { size, kinds, start } =
    "template" in props
      ? { ...props.template, kinds: props.template.premiums }
      : {
          size: props.thumbnail.size,
          kinds: [...props.thumbnail.squares].map(
            (code) => thumbnailKinds[Number(code)],
          ),
          start: undefined,
        };
  const cells = new Map<(typeof thumbnailKinds)[number], string>();
  for (const [i, kind] of kinds.entries()) {
    const x = i % size;
    const y = Math.floor(i / size);
    cells.set(
      kind,
      (cells.get(kind) ?? "") + `M${x + 0.08} ${y + 0.08}h0.84v0.84h-0.84z`,
    );
  }

  return (
    <svg
      className={start === undefined ? "board-thumbnail" : "layout-thumbnail"}
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
      {start !== undefined && (
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
