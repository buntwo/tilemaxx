import type { ReactNode } from "react";

export default function OpponentRack({
  rack,
  children,
  label = "Opponent",
  tileLabel = "Opponent rack",
}: {
  rack: string;
  children?: ReactNode;
  label?: string;
  tileLabel?: string;
}) {
  const tiles = [...rack];
  return (
    <div className="rack-lane opponent-rack-lane">
      <small className="rack-owner-label" aria-hidden="true">
        {label}
      </small>
      <div
        className="opponent-rack-tiles"
        role="img"
        aria-label={`${tileLabel}: ${tiles.map((tile) => (tile === "?" ? "blank" : tile)).join(", ")}`}
      >
        {tiles.map((tile, index) => (
          <span
            className={tile === "?" ? "blank" : undefined}
            key={index}
            aria-hidden="true"
          >
            {tile === "?" ? "" : tile}
          </span>
        ))}
      </div>
      {children}
    </div>
  );
}
