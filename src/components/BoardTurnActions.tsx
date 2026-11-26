import { ArrowLeftRight, SkipForward, UserRound, UsersRound } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { boardActionPlayer } from "../../shared/game-scoring";
import type { BoardlessTurn, Game, Player } from "../../shared/model";
import { rackLetters } from "../../shared/rack-entry";

export type RackExchangeEntry = {
  slots: number[];
  toggle: (slot: number) => void;
  confirm: () => void;
  cancel: () => void;
};

export function useBoardTurnActions(
  game: Game | undefined,
  showControls: boolean,
  onStart: () => void,
  onRecord: (player: Player, action: BoardlessTurn) => boolean,
) {
  const [opening, setOpening] = useState<{ gameId: string; player: Player }>();
  const [draft, setDraft] = useState<{ key: string; slots: number[]; count?: number }>();
  const exchangeButton = useRef<HTMLButtonElement>(null);
  const firstCount = useRef<HTMLButtonElement>(null);
  const countId = useId();
  const groupId = useId();
  const inferred = useMemo(() => game && boardActionPlayer(game), [game]);
  const player = inferred ?? (opening?.gameId === game?.id ? opening?.player : undefined) ?? "you";
  const key = game && showControls ? JSON.stringify([
    game.id, game.board, game.rack, game.past.at(-1)?.at, game.past.length, player,
  ]) : undefined;
  const exchange = draft?.key === key ? draft : undefined;
  const opponentExchange = !!exchange && player === "opponent";

  function cancel() {
    setDraft(undefined);
    exchangeButton.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (draft && !exchange) setDraft(undefined);
  }, [draft, exchange]);
  useEffect(() => {
    if (opponentExchange) firstCount.current?.focus();
  }, [opponentExchange]);
  useEffect(() => {
    if (!exchange) return;
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      cancel();
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [exchange]);

  if (!game) return {};
  const label = player === "you" ? "Your turn" : "Opponent’s turn";
  if (!key) return { player, label };

  function record(action: BoardlessTurn) {
    if (onRecord(player, action)) setDraft(undefined);
  }

  const controls = (
    <div className="board-turn-actions" data-player={player} role="group" aria-label={`Record turn · ${label}`}>
      {!inferred && (
        <button
          type="button"
          className="board-turn-button board-turn-player"
          aria-label={`${label}. Switch active player`}
          title={`${label}. Switch active player`}
          onClick={() => {
            setDraft(undefined);
            setOpening({ gameId: game.id, player: player === "you" ? "opponent" : "you" });
          }}
        >
          {player === "you" ? <UserRound size={14} aria-hidden="true" /> : <UsersRound size={14} aria-hidden="true" />}
        </button>
      )}
      <div className="board-turn-capsule">
        <button
          type="button"
          className="board-turn-button"
          aria-label="Pass"
          title="Pass"
          onClick={() => record({ kind: "pass" })}
        >
          <SkipForward size={14} aria-hidden="true" />
          <span className="board-control-label">Pass</span>
        </button>
        <button
          ref={exchangeButton}
          type="button"
          className="board-turn-button"
          aria-label="Exchange"
          title="Exchange"
          disabled={player === "you" && !rackLetters(game.rack)}
          aria-expanded={!!exchange}
          aria-controls={opponentExchange ? countId : undefined}
          onClick={() => {
            if (exchange) cancel();
            else {
              onStart();
              setDraft({ key, slots: [] });
            }
          }}
        >
          <ArrowLeftRight size={14} aria-hidden="true" />
          <span className="board-control-label">Exchange</span>
        </button>
      </div>
    </div>
  );

  const details = opponentExchange && (
    <div className="board-turn-count" data-player={player} id={countId}>
      <span id={groupId}>How many tiles did your opponent exchange?</span>
      <div className="board-turn-count-options" role="group" aria-labelledby={groupId}>
        {[...Array.from({ length: game.template.rackSize }, (_, i) => i + 1), 0].map((count, index) => (
          <button
            key={count}
            ref={index === 0 ? firstCount : undefined}
            type="button"
            className="button secondary"
            aria-pressed={exchange.count === count}
            onClick={() => setDraft({ ...exchange, count })}
          >
            {count || "Unknown"}
          </button>
        ))}
      </div>
      <div className="board-turn-confirm">
        <button
          type="button"
          className="button primary"
          disabled={exchange.count === undefined}
          onClick={() => record({ kind: "exchange", count: exchange.count || undefined })}
        >Record exchange</button>
        <button type="button" className="text-button" onClick={cancel}>Cancel</button>
      </div>
    </div>
  );

  const rackExchange: RackExchangeEntry | undefined = exchange && player === "you" ? {
    slots: exchange.slots,
    toggle(slot) {
      const slots = exchange.slots;
      setDraft({
        ...exchange,
        slots: slots.includes(slot) ? slots.filter((item) => item !== slot) : [...slots, slot].sort((a, b) => a - b),
      });
    },
    confirm: () => record({ kind: "exchange", slots: exchange.slots }),
    cancel,
  } : undefined;

  return { player, label, controls, details, rackExchange, dismiss: () => setDraft(undefined) };
}
