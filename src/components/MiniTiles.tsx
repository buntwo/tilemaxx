export default function MiniTiles({
  tiles,
  opponent = false,
}: {
  tiles: string;
  opponent?: boolean;
}) {
  return (
    <span className={opponent ? "mini-tiles opponent" : "mini-tiles"}>
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
