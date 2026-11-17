import { Trophy } from "lucide-react";
import { isBingo, type BingoRules, type Move } from "../../shared/model";

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

export function MoveLetters({ move, size }: { move: Move; size: number }) {
  const placed = new Map(move.tiles.map((tile) => [tile.index, tile.letter]));
  const start = move.row * size + move.col;
  const stride = move.direction === "across" ? 1 : size;
  return [...move.word].map((letter, i) => {
    const tile = placed.get(start + i * stride);
    const blank = tile !== undefined && tile === tile.toLowerCase();
    return (
      <span
        key={i}
        className={`result-letter ${tile ? "played" : "existing"}${blank ? " assigned-blank" : ""}`}
        title={blank ? "Play a blank" : tile ? "Play from rack" : "Already on board"}
      >
        {letter}
      </span>
    );
  });
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
