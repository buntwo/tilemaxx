export default function MiniTiles({ tiles }: { tiles: string }) {
  return (
    <span className="mini-tiles">
      {[...tiles].map((tile, i) => (
        <span
          key={i}
          className={tile === "?" ? "blank" : undefined}
          role={tile === "?" ? "img" : undefined}
          aria-label={tile === "?" ? "Blank tile" : undefined}
        >
          {tile === "?" ? "" : tile}
        </span>
      ))}
    </span>
  );
}
