import { ArrowLeftRight, ChevronsUpDown, SkipForward } from "lucide-react";
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
  const key = game && JSON.stringify([
    game.id, game.board, game.rack, game.past.at(-1)?.at, game.past.length, player,
  ]);
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

  if (!game || !key) return {};

  function record(action: BoardlessTurn) {
    if (onRecord(player, action)) setDraft(undefined);
  }

  const label = player === "you" ? "Your turn" : "Opponent’s turn";
  const controls = (
    <div className="board-turn-actions" data-player={player} role="group" aria-label={`Record turn · ${label}`}>
      <button type="button" className="board-turn-button" onClick={() => record({ kind: "pass" })}>
        <SkipForward size={14} aria-hidden="true" /> Pass
      </button>
      <button
        ref={exchangeButton}
        type="button"
        className="board-turn-button"
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
        <ArrowLeftRight size={14} aria-hidden="true" /> Exchange
      </button>
    </div>
  );

  const details = (
    <div className="board-turn-details" data-player={player}>
      {inferred ? <span className="board-turn-player" role="status">{label}</span> : (
        <button
          type="button"
          className="text-button board-turn-player"
          aria-label={`${label}. Switch active player`}
          onClick={() => {
            setDraft(undefined);
            setOpening({ gameId: game.id, player: player === "you" ? "opponent" : "you" });
          }}
        >
          {label} <ChevronsUpDown size={12} aria-hidden="true" />
        </button>
      )}
      {opponentExchange && (
        <div className="board-turn-count" id={countId}>
          <strong id={groupId}>How many tiles did your opponent exchange?</strong>
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
      )}
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

  return { controls, details, rackExchange, dismiss: () => setDraft(undefined) };
}
