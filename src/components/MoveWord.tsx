import { Trophy } from "lucide-react";
import { isBingo, type BingoRules } from "../../shared/model";

export function BingoBadge({
  full = false,
  title = "Bingo",
  className = "",
}: {
  full?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <span
      className={`bingo-badge ${className}`}
      role="img"
      aria-label="Bingo"
      title={title}
    >
      <Trophy size={10} aria-hidden="true" />
      {full && "BINGO"}
    </span>
  );
}

type MoveWordProps =
  | { word: string; bingo?: boolean }
  | { move: { word: string; tiles: readonly unknown[] }; rules: BingoRules };

export default function MoveWord(props: MoveWordProps) {
  const word = "move" in props ? props.move.word : props.word;
  const bingo =
    "move" in props
      ? isBingo(props.rules, props.move.tiles.length)
      : props.bingo;
  return bingo ? (
    <span className="bingo-move-word">
      {word} <BingoBadge />
    </span>
  ) : (
    word
  );
}
