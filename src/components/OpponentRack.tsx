export default function OpponentRack({ rack }: { rack: string }) {
  if (!rack) return null;
  const tiles = [...rack];
  return (
    <>
      <small className="rack-owner-label" aria-hidden="true">Opponent</small>
      <div
        className="opponent-rack-tiles"
        role="img"
        aria-label={`Opponent rack: ${tiles.map((tile) => (tile === "?" ? "blank" : tile)).join(", ")}`}
      >
        {tiles.map((tile, index) => (
          <span
            className={tile === "?" ? "blank" : undefined}
            key={index}
            aria-hidden="true"
          >
            {tile}
          </span>
        ))}
      </div>
    </>
  );
}
