import { ShieldAlert, ShieldCheck } from "lucide-react";
import { coordinate, type Game, type Move } from "../../shared/model";
import { placeTiles } from "../../shared/move-analysis";
import type { MoveDefense, PremiumChange } from "../../shared/premium-defense";
import { rackContainsChance, unseenTiles } from "../../shared/tile-pool";
import Board from "./Board";
import Modal from "./Modal";

const squareLabel = (change: PremiumChange, size: number) =>
  `${change.premium} at ${coordinate(change.square, size)}`;

export function blockedReplyPoints(change: PremiumChange) {
  return (change.before?.score ?? 0) - (change.after?.score ?? 0);
}

export function defenseLabel(defense: MoveDefense, size: number) {
  return [
    defense.opened &&
      `Up to ${defense.opened.after?.score} points through ${squareLabel(defense.opened, size)}`,
    defense.closed &&
      `Reduces the best checked reply through ${squareLabel(defense.closed, size)} by ${blockedReplyPoints(defense.closed)} points`,
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
      <PremiumDefenseContent game={game} move={move} defense={defense} />
    </Modal>
  );
}

export function PremiumDefenseContent({
  game,
  move,
  defense,
}: {
  game: Game;
  move: Move;
  defense: MoveDefense;
}) {
  const { template } = game;
  const main = (defense.opened ?? defense.closed)!;
  const reply = defense.opened ? main.after : main.before;
  const unseen = unseenTiles(game, template);
  const rackSize = Math.min(unseen.total, template.rackSize);
  const chance = reply
    ? rackContainsChance(
        unseen,
        rackSize,
        reply.tiles.map(({ letter }) =>
          letter === letter.toUpperCase() ? letter : "?",
        ),
      )
    : 0;
  return (
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
          <p className="defense-help">
            <strong>
              {chance > 0 && chance < 0.0005
                ? "<0.05%"
                : `${new Intl.NumberFormat(undefined, {
                    style: "percent",
                    maximumFractionDigits: chance < 0.01 ? 2 : 1,
                  }).format(chance)}`}
            </strong>{" "}
            of random {rackSize}-tile racks from {unseen.total} unseen tiles
            contain this combination.
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
  );
}

export function PremiumReplyNote({
  game,
  defense,
  opponentRackSize,
}: {
  game: Game;
  defense: MoveDefense;
  opponentRackSize: number;
}) {
  const { opened, closed } = defense;
  if (opened?.after) {
    const reply = opened.after;
    const unseen = unseenTiles(game, game.template);
    const need = reply.tiles.map(({ letter }) =>
      letter === letter.toUpperCase() ? letter : "?",
    );
    const percent = rackContainsChance(unseen, opponentRackSize, need) * 100;
    return (
      <p className="reply-example">
        <strong>
          {reply.word.toUpperCase()} · {reply.score} pts
        </strong>{" "}
        through {squareLabel(opened, game.template.size)}. Needs{" "}
        {need.join(", ")}.{" "}
        {percent > 0 && percent < 0.05 ? "<0.05" : Number(percent.toFixed(2))}%
        of random {opponentRackSize}-tile racks.
      </p>
    );
  }
  if (closed) {
    const square = squareLabel(closed, game.template.size);
    return (
      <p className="reply-example">
        {closed.after
          ? `Weakens ${square} by ${blockedReplyPoints(closed)} pts.`
          : `Cuts off the checked reply through ${square}.`}
      </p>
    );
  }
  return null;
}
