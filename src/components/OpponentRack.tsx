export default function OpponentRack({
  rack,
  assumed,
}: {
  rack: string;
  assumed: boolean;
}) {
  if (!rack) return null;
  return (
    <div className="opponent-rack">
      <div className="opponent-rack-label">
        <strong>Opponent rack</strong>
        <small>{assumed ? "Bag assumed empty" : "Bag empty"}</small>
      </div>
      <div
        className="opponent-rack-tiles"
        role="img"
        aria-label={`Opponent rack: ${[...rack].map((tile) => (tile === "?" ? "blank" : tile)).join(", ")}`}
      >
        {[...rack].map((tile, index) => (
          <span
            className={tile === "?" ? "blank" : undefined}
            key={index}
            aria-hidden="true"
          >
            {tile}
          </span>
        ))}
      </div>
    </div>
  );
}
