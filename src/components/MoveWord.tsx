import { moveLetters } from "../../shared/notation";
import { Trophy } from "lucide-react";
import { DefinitionWord } from "./MoveDefinitions";
import {
  isBingo,
  type BingoRules,
  type Move,
  type Board,
} from "../../shared/model";

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

export function MoveLetters({
  move,
  size,
  board,
  showTileTitles = true,
}: {
  move: Move;
  size: number;
  board?: Board;
  showTileTitles?: boolean;
}) {
  const letters = moveLetters(move, size, board);
  return letters.map((tile, index) => (
    <span
      key={index}
      className={`result-letter ${tile.existing ? "existing" : "played"}${tile.blank ? " assigned-blank" : ""}`}
      title={
        !showTileTitles ? undefined : tile.existing
          ? "Already on board"
          : tile.blank
            ? "Play a blank"
            : "Play from rack"
      }
    >
      {tile.letter.toUpperCase()}
    </span>
  ));
}

type MoveWordProps =
  | {
      word: string;
      notation?: string;
      bingo?: boolean;
    }
  | {
      move: { word: string; tiles: readonly unknown[] };
      rules: BingoRules;
    };

export default function MoveWord(props: MoveWordProps) {
  const word = "move" in props ? props.move.word : props.word;
  const notation = "notation" in props ? props.notation ?? word : word;
  const bingo =
    "move" in props
      ? isBingo(props.rules, props.move.tiles.length)
      : props.bingo;
  return bingo ? (
    <DefinitionWord word={word} className="bingo-move-word">
      {notation} <BingoBadge />
    </DefinitionWord>
  ) : (
    <DefinitionWord word={word}>{notation}</DefinitionWord>
  );
}
