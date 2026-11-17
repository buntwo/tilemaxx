import { endgameStreaks } from "./endgame";
import type { Game } from "./model";
import { rackLetters, rackSlotsForMove } from "./rack-entry";
import { unseenTiles } from "./tile-pool";

/** Infer a last draw only when the latest board change was our own play. */
export function endgameAfterRefill(game: Game) {
  const { board, rack, template, past } = game;
  if (game.archived || game.scoring?.end || !rackLetters(rack)) return;
  const before = [...past]
    .reverse()
    .find(
      (entry) =>
        entry.player === "opponent" ||
        entry.board.some((tile, i) => tile !== board[i]),
    );
  // applyMove also records the score in games with score tracking paused.
  if (!before || before.player === "opponent" || before.score === undefined)
    return;
  if (before.board.some((tile, i) => tile && tile !== board[i])) return;
  const played = board.flatMap((letter, index) =>
    letter && !before.board[index] ? [{ index, letter }] : [],
  );
  if (!played.length) return;

  const used = rackSlotsForMove(
    { board: before.board, rack: before.rack },
    played,
  );
  if (!used) return;
  const refilled = [...rackLetters(rack)];
  for (const [slot, letter] of [...before.rack].entries()) {
    if (letter === "." || used.includes(slot)) continue;
    const index = refilled.indexOf(letter);
    if (index < 0) return;
    refilled.splice(index, 1);
  }
  if (!refilled.length) return;

  const prior = unseenTiles(before, template);
  const remaining = unseenTiles(game, template);
  if (
    prior.excess.length ||
    remaining.excess.length ||
    prior.total <= template.rackSize ||
    remaining.total !== template.rackSize
  )
    return;

  const streak = endgameStreaks[template.rules];
  return {
    opponentRack: remaining.tiles
      .map(({ symbol, count }) => symbol.repeat(count))
      .join(""),
    scorelessTurns: streak && !streak.passesOnly && !before.score ? 1 : 0,
  };
}
