import { tileScore, type Rules } from "../../shared/model";

function tileLetter(tile: string) {
  return tile === "?" ? "" : tile.toUpperCase();
}

export default function TileFace({ tile, rules, hidePoints = false }: {
  tile: string;
  rules: Rules;
  hidePoints?: boolean;
}) {
  return (
    <span className="tile-face-content">
      <span className="tile-letter">{tileLetter(tile)}</span>
      {!hidePoints && <span className="tile-points">{tileScore(tile, rules)}</span>}
    </span>
  );
}

export function RackTileFace({ tile, rules, unknown }: {
  tile?: string;
  rules: Rules;
  unknown?: boolean;
}) {
  return (
    <span className={`rack-face${unknown ? " unknown" : !tile ? " empty" : tile === "?" ? " tile-face blank" : " tile-face"}`}>
      {unknown ? "?" : tile ? <TileFace tile={tile} rules={rules} /> : "·"}
    </span>
  );
}

export function createTileFaceContent(tile: string, rules: Rules) {
  const content = document.createElement("span");
  content.className = "tile-face-content";
  const letter = document.createElement("span");
  letter.className = "tile-letter";
  letter.textContent = tileLetter(tile);
  const points = document.createElement("span");
  points.className = "tile-points";
  points.textContent = String(tileScore(tile, rules));
  content.append(letter, points);
  return content;
}
