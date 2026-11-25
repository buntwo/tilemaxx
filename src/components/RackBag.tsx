export default function RackBag({
  count,
  label,
  invalid,
  controls,
  expanded,
  onClick,
}: {
  count: number | "?";
  label: string;
  invalid?: boolean;
  controls?: string;
  expanded?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="rack-bag"
      aria-label={onClick ? `Unseen tiles, ${label}` : label}
      aria-controls={controls}
      aria-expanded={expanded}
      title={label}
      data-empty={count === 0 || undefined}
      data-overdrawn={invalid || undefined}
      data-digits={String(count).length}
      disabled={!onClick}
      onClick={onClick}
    >
      {count}
    </button>
  );
}
