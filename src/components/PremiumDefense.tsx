import { ShieldAlert, ShieldCheck } from "lucide-react";
import { coordinate, type Game, type Move } from "../../shared/model";
import { placeTiles } from "../../shared/move-analysis";
import type { MoveDefense, PremiumChange } from "../../shared/premium-defense";
import type { PremiumReply } from "../../shared/solver";
import { rackContainsChance, unseenTiles } from "../../shared/tile-pool";
import { scoreTone } from "../score-tone";
import Board from "./Board";
import Modal from "./Modal";
import MoveWord from "./MoveWord";

const squareLabel = (change: PremiumChange, size: number) =>
  `${change.premium} at ${coordinate(change.square, size)}`;
const neededTiles = (reply: PremiumReply) =>
  reply.tiles.map(({ letter }) => letter === letter.toUpperCase() ? letter : "?");
const chanceFormats = [0, 1, 2].map((maximumFractionDigits) =>
  new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits }),
);

function formatChance(chance: number, compact = false) {
  const floor = compact ? 0.01 : 0.0005;
  if (chance > 0 && chance < floor) return compact ? "<1%" : "<0.05%";
  return chanceFormats[compact ? 0 : chance < 0.01 ? 2 : 1].format(chance);
}

export function createPremiumReplyChance(
  unseen: ReturnType<typeof unseenTiles> | undefined,
  rackSize: number,
) {
  const cache = new Map<string, number>();
  return (reply: PremiumReply) => {
    if (!unseen) return 0;
    const needed = neededTiles(reply).sort();
    const key = needed.join("");
    let chance = cache.get(key);
    if (chance === undefined) {
      chance = rackContainsChance(unseen, rackSize, needed);
      cache.set(key, chance);
    }
    return chance;
  };
}

function blockedReplyPoints(change: PremiumChange) {
  return (change.before?.score ?? 0) - (change.after?.score ?? 0);
}

function defenseLabel(defense: MoveDefense, size: number, chance?: number) {
  return [
    defense.opened &&
      `Up to ${defense.opened.after?.score} points through ${squareLabel(defense.opened, size)}${chance === undefined ? "" : `. ${formatChance(chance)} chance of holding the tiles for this reply`}`,
    defense.closed &&
      `Reduces the best checked reply through ${squareLabel(defense.closed, size)} by ${blockedReplyPoints(defense.closed)} points`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function PremiumRiskButton({
  defense,
  size,
  moveLabel,
  chanceFor,
  onClick,
}: {
  defense: MoveDefense;
  size: number;
  moveLabel: string;
  chanceFor: ReturnType<typeof createPremiumReplyChance>;
  onClick: () => void;
}) {
  const opened = defense.opened?.after;
  const chance = opened && chanceFor(opened);
  // Measure the extra points over the previous reply or a routine 25-point play.
  const added = opened
    ? Math.max(0, opened.score - Math.max(defense.opened?.before?.score ?? 0, 25))
    : 0;
  const tone = chance === undefined ? undefined
    : chance < 0.1 ? "muted"
      : chance >= 0.2 && chance * added >= 3 ? "high" : "caution";
  const label = defenseLabel(defense, size, chance);
  return (
    <button
      type="button"
      className={`icon-button ${opened ? "defense-risk" : "defense-covered"}`}
      data-risk={tone}
      aria-label={`Reply risk for ${moveLabel}. ${label}`}
      title={label}
      onClick={onClick}
    >
      <span className="result-defense-badge" aria-hidden="true">
        {opened ? `↑${opened.score}` : defense.closed && `−${blockedReplyPoints(defense.closed)}`}
        {chance !== undefined && (
          <span className="result-defense-chance">{formatChance(chance, true)}</span>
        )}
      </span>
    </button>
  );
}

export default function PremiumDefense({
  game,
  move,
  defense,
  opponentRackSize,
  onClose,
}: {
  game: Game;
  move: Move;
  defense: MoveDefense;
  opponentRackSize: number;
  onClose: () => void;
}) {
  return (
    <Modal
      title={
        <>
          Reply risk · <MoveWord move={move} rules={game.template} />
        </>
      }
      subtitle={
        defense.depth === 1
          ? "One-tile premium replies"
          : "Premium replies using up to three tiles"
      }
      onClose={onClose}
    >
      <PremiumDefenseContent game={game} move={move} defense={defense} opponentRackSize={opponentRackSize} />
    </Modal>
  );
}

export function PremiumDefenseContent({
  game,
  move,
  defense,
  opponentRackSize,
}: {
  game: Game;
  move: Move;
  defense: MoveDefense;
  opponentRackSize: number;
}) {
  const { template } = game;
  const main = (defense.opened ?? defense.closed)!;
  const reply = defense.opened ? main.after : main.before;
  const unseen = unseenTiles(game, template);
  const rackSize = Math.min(unseen.total, opponentRackSize);
  const chance = reply
    ? rackContainsChance(
        unseen,
        rackSize,
        neededTiles(reply),
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
                after{" "}
                <b className={scoreTone(blockedReplyPoints(change))}>
                  {change.after ? `${change.after.score} pts` : "—"}
                </b>
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
              <MoveWord
                move={{ ...reply, word: reply.word.toUpperCase() }}
                rules={template}
              />{" "}
              · {reply.score} pts
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
              {formatChance(chance)}
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
    const need = neededTiles(reply);
    const chance = rackContainsChance(unseen, opponentRackSize, need);
    return (
      <p className="reply-example">
        <strong>
          <MoveWord
            move={{ ...reply, word: reply.word.toUpperCase() }}
            rules={game.template}
          />{" "}
          · <span className="value-bad">{reply.score} pts</span>
        </strong>{" "}
        through {squareLabel(opened, game.template.size)}. Needs{" "}
        {need.join(", ")}.{" "}
        {formatChance(chance)}
        of random {opponentRackSize}-tile racks.
      </p>
    );
  }
  if (closed) {
    const square = squareLabel(closed, game.template.size);
    return (
      <p className="reply-example">
        {closed.after ? (
          <>
            Weakens {square} by{" "}
            <strong className={scoreTone(blockedReplyPoints(closed))}>
              {blockedReplyPoints(closed)} pts
            </strong>
            .
          </>
        ) : (
          `Cuts off the checked reply through ${square}.`
        )}
      </p>
    );
  }
  return null;
}
