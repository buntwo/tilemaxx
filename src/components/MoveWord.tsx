import { Fragment } from "react";
import {
  moveLetters,
  moveNotation,
  recordedMoveNotation,
  type NotationMove,
} from "../../shared/notation";
import { Trophy } from "lucide-react";
import {
  isBingo,
  type BingoRules,
  type Move,
  type Board,
  type TurnPosition,
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
}: {
  move: Move;
  size: number;
  board?: Board;
}) {
  const letters = moveLetters(move, size, board);
  return letters.map((tile, index) => (
    <Fragment key={index}>
      {tile.existing && !letters[index - 1]?.existing && (
        <span className="move-parenthesis">(</span>
      )}
      <span
        className={`result-letter ${tile.existing ? "existing" : "played"}${tile.blank ? " assigned-blank" : ""}`}
        title={
          tile.existing
            ? tile.blank
              ? "Already on board · blank"
              : "Already on board"
            : tile.blank
              ? "Play a blank"
              : "Play from rack"
        }
      >
        {tile.letter}
      </span>
      {tile.existing && !letters[index + 1]?.existing && (
        <span className="move-parenthesis">)</span>
      )}
    </Fragment>
  ));
}

type MoveWordProps =
  | {
      word: string;
      bingo?: boolean;
      position?: Pick<TurnPosition, "board" | "tiles" | "direction">;
      size?: number;
    }
  | {
      move: NotationMove;
      rules: BingoRules & { size?: number };
      board?: Board;
    };

export default function MoveWord(props: MoveWordProps) {
  const word =
    "move" in props
      ? moveNotation(props.move, props.rules.size, props.board)
      : props.position && props.size
        ? recordedMoveNotation(props, props.position, props.size)
        : props.word;
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
