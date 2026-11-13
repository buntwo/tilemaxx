import { ShieldAlert, ShieldCheck } from "lucide-react";
import { coordinate, type Game, type Move } from "../../shared/model";
import { placeTiles } from "../../shared/move-analysis";
import type { MoveDefense, PremiumChange } from "../../shared/premium-defense";
import Board from "./Board";
import Modal from "./Modal";

const squareLabel = (change: PremiumChange, size: number) =>
  `${change.premium} at ${coordinate(change.square, size)}`;

export function defenseLabel(defense: MoveDefense, size: number) {
  return [
    defense.opened &&
      `Opens or strengthens ${squareLabel(defense.opened, size)}`,
    defense.closed && `Weakens ${squareLabel(defense.closed, size)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function PremiumDefense({
  game,
  move,
  defense,
  onClose,
}: {
  game: Game;
  move: Move;
  defense: MoveDefense;
  onClose: () => void;
}) {
  const { template } = game;
  const main = (defense.opened ?? defense.closed)!;
  const reply = defense.opened ? main.after : main.before;
  return (
    <Modal
      title={`Reply risk · ${move.word.toUpperCase()}`}
      subtitle={
        defense.depth === 1
          ? "One-tile premium replies"
          : "Premium replies using up to three tiles"
      }
      onClose={onClose}
    >
      <div className="defense-details">
        {([defense.opened, defense.closed] as const).map((change, index) => {
          if (!change) return null;
          const opened = index === 0;
          const Icon = opened ? ShieldAlert : ShieldCheck;
          return (
            <div key={change.square} className="defense-detail">
              <Icon
                className={opened ? "defense-warning" : "defense-covered"}
                size={18}
                aria-hidden="true"
              />
              <div>
                <strong>
                  {squareLabel(change, template.size)}{" "}
                  {opened ? "becomes more dangerous" : "becomes less dangerous"}
                </strong>
                <span>
                  Before {change.before ? `${change.before.score} pts` : "—"}
                  {" → "}
                  after {change.after ? `${change.after.score} pts` : "—"}
                </span>
              </div>
            </div>
          );
        })}
        {reply && (
          <div className="defense-example">
            <p>
              Example {defense.opened ? "after" : "before"} your play{" "}
              <strong>
                {reply.word.toUpperCase()} · {reply.score} pts
              </strong>
            </p>
            <p className="defense-help">
              Needs{" "}
              {reply.tiles
                .map(({ letter }) =>
                  letter === letter.toUpperCase()
                    ? letter
                    : `blank as ${letter.toUpperCase()}`,
                )
                .join(", ")}
            </p>
            <Board
              template={template}
              board={defense.opened ? placeTiles(game.board, move) : game.board}
              preview={reply}
              highlight={main.square}
              compact
            />
          </div>
        )}
        <p className="defense-help">
          Replies use unseen tiles, including tiles that may already be on your
          opponent’s rack.
        </p>
      </div>
    </Modal>
  );
}
