import type { ReplayFrame, ReplayRackLayout } from "../../shared/game-replay";
import { ReplayDrawShelf } from "./GameReplay";
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import {
  enterRack,
  eraseRack,
  rackLetters,
  reorderRack,
  rackSlotsForMove,
  sortedRackSlots,
  splitRack,
} from "../../shared/rack-entry";
import { minimumBingoTiles, type Game, type Move } from "../../shared/model";
import type { ExchangeResult } from "../../shared/exchange";
import type { OptimalExchangeResult } from "../../shared/optimal-exchange";
import {
  Ban,
  CircleCheck,
  Repeat2,
  Pencil,
  Shuffle,
  SlidersHorizontal,
  Trophy,
} from "lucide-react";
import { canAnimateTiles } from "./tile-motion";
import { useRackKeyboard } from "./useRackKeyboard";
import { useRackReorder } from "./useRackReorder";
import ExchangeAnalysis, { type ExchangeBingoEstimate } from "./ExchangeAnalysis";
import OptimalExchange from "./OptimalExchange";
import ExchangeSuggestion, { exchangeAdviceDetail, type SwapAdvice } from "./ExchangeSuggestion";
import OpponentRack from "./OpponentRack";
import TilePool from "./TilePool";
import RackBag from "./RackBag";
import { unseenTiles } from "../../shared/tile-pool";
import { createTileFaceContent, RackTileFace } from "./TileFace";
import type { RackExchangeEntry } from "./BoardTurnActions";

const SENTINEL = "\u200b";
const EXCHANGE_CACHE_LIMIT = 16;
const TILE_HOLD_MS = 450;
export type RackEntryHandle = {
  openSuggestedExchange: (reveal: boolean) => void;
  focusEntry: (firstEmpty?: boolean) => void;
};

export default function RackEntry({
  ref,
  game,
  onChange,
  onSolve,
  phoneLayout,
  onReviewEdit,
  detailsTarget,
  onEnterOwnPlay,
  positionKey,
  exchangeAdvice,
  bagCount,
  bagConfirmed,
  tileCountsInvalid,
  exchangeScorelessTurns,
  opponentRack,
  preview,
  flyingRack,
  replayFrame,
  recordedPreview,
  replayRackLayout,
  drawShelf,
  recordingExchange,
}: {
  ref?: Ref<RackEntryHandle>;
  game: Game;
  onChange: (game: Game) => void;
  onSolve: () => void;
  phoneLayout: boolean;
  onReviewEdit?: () => void;
  detailsTarget: HTMLDivElement | null;
  onEnterOwnPlay?: () => void;
  positionKey: string;
  exchangeAdvice?: SwapAdvice;
  bagCount: number;
  bagConfirmed: boolean;
  tileCountsInvalid: boolean;
  exchangeScorelessTurns: number;
  opponentRack: string;
  preview?: Pick<Move, "tiles"> | null;
  flyingRack?: { before: Game; slots: number[] };
  replayFrame?: ReplayFrame;
  recordedPreview?: boolean;
  replayRackLayout?: ReplayRackLayout;
  drawShelf?: boolean;
  recordingExchange?: RackExchangeEntry;
}) {
  const [cursor, setCursor] = useState(game.rack.length);
  const [focused, setFocused] = useState(false);
  const [selectAll, setSelectAll] = useState(false);
  const [tilePoolOpen, setTilePoolOpen] = useState(false);
  const tilePoolId = useId();
  const [mode, setMode] = useState<
    "entry" | "exclude" | "require" | "exchange"
  >("entry");
  const [simulation, setSimulation] = useState<{
    key: string;
    optimalResult?: OptimalExchangeResult;
    bingoEstimate?: ExchangeBingoEstimate;
  }>();
  const [optimalOpen, setOptimalOpen] = useState<{
    key: string;
    result?: OptimalExchangeResult;
  }>();
  const [exchangeResults, setExchangeResults] =
    useState<Map<string, ExchangeResult>>();
  const [acceptedAdvice, setAcceptedAdvice] = useState<{
    key: string;
    detail: string;
  }>();
  const excludeMode = mode === "exclude";
  const requireMode = mode === "require";
  const recording = !!recordingExchange;
  const exchangeMode = mode === "exchange" || recording;
  const reviewing = !!onReviewEdit;
  const bagLabel = `${bagCount}${bagConfirmed ? "" : " estimated"} ${bagCount === 1 ? "tile" : "tiles"} in the bag`;
  const recordedBag = replayFrame?.bag;
  const bagUnavailable = !!replayFrame && !recordedBag;
  const bagEstimate = recordedBag
    ? `${recordedBag.count}${recordedBag.estimated ? " estimated" : ""} ${recordedBag.count === 1 ? "tile" : "tiles"} in the bag before the play`
    : bagLabel;
  const bagInvalid = recordedBag?.invalid ?? tileCountsInvalid;
  const bagStatus = bagInvalid ? `${bagEstimate}, check tile counts` : bagEstimate;
  const recordedOpponent = replayFrame?.move?.player === "opponent";
  const tools = useRef<HTMLDetailsElement>(null);
  const openExchange = useRef<{ reveal: boolean }>(null);
  const exchangeButton = useRef<HTMLButtonElement>(null);
  const optimalButton = useRef<HTMLButtonElement>(null);
  const tileHold = useRef<{ pointerId: number; x: number; y: number }>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const suppressTap = useRef(false);
  const [exchangeMarks, setExchangeMarks] = useState<Record<number, string>>(
    {},
  );
  const input = useRef<HTMLInputElement>(null);
  const rack = useRef<HTMLDivElement>(null);
  const trackKeyboardFocus = useRackKeyboard(
    phoneLayout,
    reviewing,
    cursor,
    rack,
    input,
  );
  const slides = useRef(
    new Map<number, { letter: string; stop: () => void }>(),
  );
  // A directly selected tile is replaced/erased once; typing and deletion
  // return to insertion-cursor behavior for subsequent Backspaces.
  const eraseSelected = useRef(false);
  const helpId = useId();
  const capacity = game.template.rackSize;
  const position = Math.min(cursor, capacity);
  const excludedSlots = game.excludedRackSlots ?? [];
  const requiredSlots = game.requiredRackSlots ?? [];
  // Exchange selections address physical slots even when solver results can be reused.
  const slotKey = JSON.stringify([positionKey, game.rack, excludedSlots, requiredSlots]);
  const canReorder = !reviewing && !flyingRack && !recording && mode === "entry";
  const exchangeSlots = Object.keys(exchangeMarks)
    .map(Number)
    .filter((i) => game.rack[i] === exchangeMarks[i]);
  const optimalKey = JSON.stringify([slotKey, bagCount, exchangeScorelessTurns]);
  const exchangeKey = JSON.stringify([optimalKey, exchangeSlots]);
  const activeSimulation =
    simulation?.key === exchangeKey ? simulation : undefined;
  const canOpenOptimal = !game.solo && !opponentRack && bagCount > 0;
  const bingoMinimum = minimumBingoTiles(game.template);
  const enoughBingoTiles = splitRack(game).available.length >= bingoMinimum;
  const showingOptimal = !recording && canOpenOptimal && enoughBingoTiles && optimalOpen?.key === optimalKey;
  const reorder = useRackReorder({
    rack,
    letters: game.rack,
    positionKey: slotKey,
    enabled: canReorder,
    vertical: phoneLayout,
    prepare: () => {
      for (const slide of slides.current.values()) slide.stop();
    },
    onReorder: applyOrder,
  });
  function applyOrder(order: number[]) {
    const next = reorderRack(game, order);
    const nextCursor = order.indexOf(position);
    if (nextCursor !== -1) setCursor(nextCursor);
    setExchangeMarks(Object.fromEntries(order.flatMap((slot, i) =>
      exchangeSlots.includes(slot) ? [[i, game.rack[slot]]] : [])));
    if (
      next.rack !== game.rack ||
      next.excludedRackSlots.join(",") !== excludedSlots.join(",") ||
      next.requiredRackSlots.join(",") !== requiredSlots.join(",")
    )
      onChange({ ...game, ...next });
  }
  useEffect(() => {
    setExchangeResults(undefined);
  }, [optimalKey]);
  useEffect(() => () => clearTimeout(holdTimer.current), [slotKey]);
  const cacheExchangeResult = useCallback(
    (result: ExchangeResult) => {
      setExchangeResults((previous) => {
        const next = new Map(previous);
        next.delete(exchangeKey);
        next.set(exchangeKey, result);
        if (next.size > EXCHANGE_CACHE_LIMIT)
          next.delete(next.keys().next().value!);
        return next;
      });
    },
    [exchangeKey],
  );
  const advice =
    !recording && mode === "entry" && !exchangeSlots.length && !flyingRack && !focused
      ? exchangeAdvice
      : undefined;
  useLayoutEffect(() => {
    if (!openExchange.current || !activeSimulation) return;
    const { reveal } = openExchange.current;
    openExchange.current = null;
    exchangeButton.current?.focus({ preventScroll: true });
    if (reveal)
      rack.current?.scrollIntoView({
        block: "start",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  });
  useImperativeHandle(ref, () => ({ openSuggestedExchange, focusEntry }));
  useLayoutEffect(() => {
    if (!recording) return;
    input.current?.blur();
    if (tools.current) tools.current.open = false;
    setMode("entry");
    rack.current?.querySelector<HTMLButtonElement>(".rack-tile:not(.empty)")?.focus();
  }, [recording]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!tools.current?.contains(event.target as Node) && tools.current)
        tools.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => {
    const blur = () => {
      setFocused(false);
      setSelectAll(false);
    };
    const focus = () => setFocused(document.activeElement === input.current);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    return () => {
      for (const slide of slides.current.values()) slide.stop();
      slides.current.clear();
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
    };
  }, []);
  useLayoutEffect(() => {
    for (const [index, slide] of slides.current)
      if (flyingRack || (game.rack[index] || ".") !== slide.letter)
        slide.stop();
  }, [game.rack, flyingRack]);
  function save(result: { rack: string; cursor: number }, from: number) {
    reorder.cancel();
    animateEdit(result.rack);
    const untouched = (slot: number) =>
      !selectAll && (slot < from || slot >= Math.max(from + 1, result.cursor));
    const excludedRackSlots = excludedSlots.filter(untouched);
    const requiredRackSlots = requiredSlots.filter(untouched);
    if (
      result.rack !== game.rack ||
      excludedRackSlots.length !== excludedSlots.length ||
      requiredRackSlots.length !== requiredSlots.length
    )
      onChange({
        ...game,
        rack: result.rack,
        excludedRackSlots: excludedRackSlots.length
          ? excludedRackSlots
          : undefined,
        requiredRackSlots: requiredRackSlots.length
          ? requiredRackSlots
          : undefined,
      });
    setCursor(result.cursor);
    setSelectAll(false);
    setExchangeMarks(
      Object.fromEntries(
        exchangeSlots.filter(untouched).map((slot) => [slot, game.rack[slot]]),
      ),
    );
  }
  function animateEdit(next: string) {
    if (!canAnimateTiles()) return;
    for (let i = 0; i < capacity; i++) {
      const before = game.rack[i] || ".";
      const after = next[i] || ".";
      if (before === after) continue;
      const slot = rack.current?.querySelector<HTMLElement>(
        `[data-rack-slot="${i}"]`,
      );
      if (!slot) continue;
      const mask = slot.querySelector(".rack-slot-window");
      if (!mask) continue;
      const current = mask.querySelector(".rack-slide:last-child");
      const transform = current ? getComputedStyle(current).transform : "none";
      slides.current.get(i)?.stop();
      function face(letter: string) {
        const tile = document.createElement("span");
        tile.className = `rack-face rack-slide tile-face${letter === "?" ? " blank" : ""}`;
        tile.append(createTileFaceContent(letter, game.template.rules));
        mask!.append(tile);
        return tile;
      }
      const removing = after === ".";
      const outgoing = !removing && before !== "." ? face(before) : undefined;
      const moving = face(removing ? before : after);
      slot.dataset.rackSliding = "";
      const animation = moving.animate(
        removing
          ? [
              { transform: transform === "none" ? "translateY(0)" : transform },
              { transform: "translateY(108%)" },
            ]
          : [
              { transform: "translateY(-108%)" },
              { transform: "translateY(0)" },
            ],
        {
          duration: removing ? 240 : 320,
          easing: removing
            ? "cubic-bezier(.42,0,.68,1)"
            : "cubic-bezier(.28,.3,.24,1)",
          fill: "both",
        },
      );
      const stop = () => {
        if (slides.current.get(i)?.stop !== stop) return;
        slides.current.delete(i);
        moving.remove();
        outgoing?.remove();
        delete slot.dataset.rackSliding;
        animation.cancel();
      };
      slides.current.set(i, { letter: after, stop });
      animation.finished.then(stop, stop);
    }
  }
  function enter(text: string) {
    if (!/[a-z ?]/i.test(text)) return;
    eraseSelected.current = false;
    const start = selectAll ? 0 : Math.min(position, capacity - 1);
    const result = enterRack(selectAll ? "" : game.rack, start, text, capacity);
    if (result.cursor !== start) save(result, start);
  }
  function erase(forward = false) {
    const selected = forward || eraseSelected.current;
    eraseSelected.current = false;
    const result = selectAll
      ? { rack: "", cursor: 0 }
      : eraseRack(
          game.rack,
          selected ? Math.min(position, capacity - 1) : position,
          selected ? "selected" : "backward",
        );
    if (selectAll || result.rack !== game.rack) save(result, result.cursor);
    else setCursor(result.cursor);
  }
  function focus(i: number) {
    eraseSelected.current = true;
    setCursor(i);
    setSelectAll(false);
    setFocused(true);
    input.current?.focus({ preventScroll: true });
    input.current?.setSelectionRange(1, 1);
  }
  function markTile(slot: number, mark?: "excluded" | "required") {
    if (!game.rack[slot] || game.rack[slot] === ".") return;
    function setMark(slots: number[], markSlot: boolean) {
      const next = slots.filter((i) => i !== slot);
      if (markSlot) next.push(slot);
      return next.length ? next.sort((a, b) => a - b) : undefined;
    }
    onChange({
      ...game,
      excludedRackSlots: setMark(excludedSlots, mark === "excluded"),
      requiredRackSlots: setMark(requiredSlots, mark === "required"),
    });
  }

  function cycleTileMark(slot: number) {
    const mark = excludedSlots.includes(slot)
      ? "required"
      : requiredSlots.includes(slot)
        ? undefined
        : "excluded";
    markTile(slot, mark);
  }

  function toggleExchange(slot: number) {
    if (!game.rack[slot] || game.rack[slot] === ".") return;
    const marks = Object.fromEntries(
      exchangeSlots.map((i) => [i, game.rack[i]]),
    );
    if (exchangeSlots.includes(slot)) delete marks[slot];
    else marks[slot] = game.rack[slot];
    setExchangeMarks(marks);
  }
  function chooseMode(next: typeof mode) {
    input.current?.blur();
    if (tools.current) tools.current.open = false;
    setMode(next);
    setOptimalOpen(undefined);
  }
  function toggleOptimal() {
    chooseMode("entry");
    setSimulation(undefined);
    setOptimalOpen(showingOptimal ? undefined : { key: optimalKey });
  }
  function editFromReview(slot: number) {
    onReviewEdit?.();
    chooseMode("entry");
    focus(slot);
  }
  function focusEntry(firstEmpty = false) {
    if (firstEmpty || document.activeElement !== input.current) {
      const gap = game.rack.indexOf(".");
      editFromReview(Math.min(gap === -1 ? game.rack.length : gap, capacity - 1));
    }
    rack.current?.scrollIntoView?.({ block: "nearest" });
  }
  function openSuggestedExchange(reveal: boolean) {
    if (!exchangeAdvice || flyingRack) return;
    const { slots } = exchangeAdvice;
    chooseMode("entry");
    openExchange.current = { reveal };
    setExchangeMarks(
      Object.fromEntries(slots.map((slot) => [slot, game.rack[slot]])),
    );
    const key = JSON.stringify([optimalKey, slots]);
    setAcceptedAdvice({ key, detail: exchangeAdviceDetail(exchangeAdvice) });
    setSimulation({ key });
  }
  const previewSlots = preview && !flyingRack
    ? recordedPreview ? replayRackLayout?.playedSlots : rackSlotsForMove(game, preview.tiles)
    : null;
  const previousTileKey = phoneLayout ? "ArrowUp" : "ArrowLeft";
  const nextTileKey = phoneLayout ? "ArrowDown" : "ArrowRight";
  const cycleMarkKey = phoneLayout ? "ArrowRight" : "ArrowDown";
  const exchangeKeyShortcut = phoneLayout ? "ArrowLeft" : "ArrowUp";
  const playerTiles = (
    <div
      ref={rack}
      className="rack-tiles"
      role="group"
      aria-label={recordedOpponent ? "Opponent rack" : "Your rack tiles"}
      onClick={
        onReviewEdit
          ? (event) => {
              if (event.target === event.currentTarget)
                editFromReview(Math.min(position, capacity - 1));
            }
          : undefined
      }
    >
      {Array.from({ length: capacity }, (_, i) => {
        const letter = flyingRack
          ? flyingRack.slots.includes(i)
            ? "."
            : flyingRack.before.rack[i]
          : game.rack[i];
        const tile = letter === "." ? "" : letter;
        const unknown = !tile && !flyingRack && replayRackLayout?.unknownSlots.includes(i);
        const tileLabel = unknown ? "unknown" : tile === "?" ? "blank" : tile || "empty";
        const excluded = (
          flyingRack?.before.excludedRackSlots ?? excludedSlots
        ).includes(i);
        const required =
          !!tile &&
          (flyingRack?.before.requiredRackSlots ?? requiredSlots).includes(i);
        const exchanging = !flyingRack && (recordingExchange?.slots ?? exchangeSlots).includes(i);
        const exchangeIcon = exchanging && (
          <Repeat2 className="rack-exchange-icon" size={12} strokeWidth={3.2} aria-hidden="true" />
        );
        const previewed = previewSlots?.includes(i);
        const active =
          focused && (selectAll || i === Math.min(position, capacity - 1));
        return (
          <button
            type="button"
            key={i}
            data-rack-slot={i}
            data-used-group-start={recordedPreview && previewed && i > 0 && !previewSlots?.includes(i - 1) || undefined}
            data-rack-reorderable={canReorder && tile ? "" : undefined}
            className={`rack-tile ${!tile && !unknown ? "empty" : ""} ${tile === "?" ? "blank" : ""} ${excluded ? "excluded" : ""} ${required ? "required-tile" : ""} ${exchanging ? "exchange-mark" : ""} ${active ? "selected" : ""} ${previewed ? "move-preview" : ""}`}
            aria-label={`Rack tile ${i + 1}: ${tileLabel}${excluded ? ", held out of solver" : ""}${required ? ", required for this move" : ""}${exchanging ? ", marked for exchange" : ""}${previewed ? ", used by preview" : ""}${onReviewEdit ? ", edit rack" : ""}`}
            aria-pressed={
              onReviewEdit
                ? undefined
                : exchangeMode
                  ? exchanging
                  : excludeMode
                    ? excluded
                    : requireMode
                      ? required
                      : active
            }
            aria-disabled={
              !onReviewEdit && (mode !== "entry" || recording) && !tile ? true : undefined
            }
            aria-keyshortcuts={canReorder && tile ? `Shift+${previousTileKey} Shift+${nextTileKey}` : undefined}
            onKeyDown={(event) => {
              if (
                !canReorder || !tile || !event.shiftKey ||
                (event.key !== previousTileKey && event.key !== nextTileKey)
              )
                return;
              event.preventDefault();
              reorder.moveTile(i, i + (event.key === previousTileKey ? -1 : 1));
            }}
            onPointerDown={(event) => {
              if (event.isPrimary === false) return;
              event.preventDefault();
              clearTimeout(holdTimer.current);
              tileHold.current = null;
              suppressTap.current = false;
              if (recording) return;
              if (tile) reorder.begin(event, i);
              if (event.pointerType !== "touch" || !tile || flyingRack) return;
              tileHold.current = {
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
              };
              holdTimer.current = setTimeout(() => {
                reorder.cancel();
                suppressTap.current = true;
                onReviewEdit?.();
                cycleTileMark(i);
              }, TILE_HOLD_MS);
            }}
            onPointerMove={(event) => {
              const hold = tileHold.current;
              if (
                reorder.move(event) ||
                (hold && hold.pointerId === event.pointerId &&
                  Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 10)
              ) {
                clearTimeout(holdTimer.current);
                suppressTap.current = true;
              }
            }}
            onPointerUp={(event) => {
              if (reorder.finish(event)) suppressTap.current = true;
              if (tileHold.current?.pointerId === event.pointerId)
                clearTimeout(holdTimer.current);
            }}
            onPointerCancel={(event) => {
              if (reorder.finish(event, true)) suppressTap.current = true;
              if (tileHold.current?.pointerId !== event.pointerId) return;
              clearTimeout(holdTimer.current);
              tileHold.current = null;
              suppressTap.current = true;
            }}
            onLostPointerCapture={(event) => {
              if (reorder.finish(event, true)) suppressTap.current = true;
            }}
            onContextMenu={(event) => {
              if (tileHold.current) event.preventDefault();
            }}
            onClick={(event) => {
              const wasTouch = tileHold.current !== null || event.detail !== 0;
              tileHold.current = null;
              if (suppressTap.current && wasTouch) {
                suppressTap.current = false;
                return;
              }
              if (recordingExchange) {
                if (tile) {
                  event.currentTarget.focus({ preventScroll: true });
                  recordingExchange.toggle(i);
                }
                return;
              }
              onReviewEdit
                ? editFromReview(i)
                : exchangeMode
                  ? toggleExchange(i)
                  : excludeMode
                    ? markTile(i, excluded ? undefined : "excluded")
                    : requireMode
                      ? markTile(i, required ? undefined : "required")
                      : focus(i);
            }}
          >
            <span className="rack-slot">
              <RackTileFace tile={tile} rules={game.template.rules} unknown={unknown} />
              <span className="rack-slot-window" aria-hidden="true" />
              {required ? (
                <span className="rack-required-stripe" aria-hidden="true">
                  REQ
                  {exchangeIcon}
                </span>
              ) : exchangeIcon}
              {excluded && (
                <Ban
                  className="rack-excluded-icon"
                  size={12}
                  aria-hidden="true"
                />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
  const rackTools = !recording && (
    <div className="rack-lane-tools">
      {mode === "entry" ? (
        <details
          ref={tools}
          className="rack-tools"
          onKeyDown={(event) => {
            if (event.key === "Escape" && tools.current?.open) {
              tools.current.open = false;
              tools.current.querySelector("summary")?.focus();
            }
          }}
        >
          <summary
            className="text-button"
            onClick={phoneLayout ? onReviewEdit : undefined}
            title={phoneLayout ? "Rack tools" : undefined}
          >
            <SlidersHorizontal size={phoneLayout ? 16 : 13} aria-hidden="true" />
            {phoneLayout ? <span className="rack-visually-hidden">Rack tools</span> : " Rack tools"}
          </summary>
          <div className="rack-tools-menu">
            {onEnterOwnPlay && (phoneLayout || !game.solo) && (
              <button type="button" onClick={() => {
                chooseMode("entry");
                onEnterOwnPlay();
              }}>
                <Pencil size={14} /> Enter your play
              </button>
            )}
            {phoneLayout && (
              <button
                type="button"
                onClick={() => {
                  chooseMode("entry");
                  reorder.shuffle();
                }}
                disabled={!canReorder || rackLetters(game.rack).length < 2}
              >
                <Shuffle size={14} /> Shuffle rack
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                chooseMode("entry");
                reorder.cancel();
                applyOrder(sortedRackSlots(game.rack));
              }}
            >
              <Shuffle size={14} /> Sort rack
            </button>
            <button type="button" onClick={() => chooseMode("exclude")}>
              <Ban size={14} /> Exclude tiles
            </button>
            <button type="button" onClick={() => chooseMode("require")}>
              <CircleCheck size={14} /> Require tiles
            </button>
            <button type="button" onClick={() => chooseMode("exchange")}>
              <Repeat2 size={14} /> Mark exchange
            </button>
            {phoneLayout && canOpenOptimal && (
              <button
                type="button"
                onClick={toggleOptimal}
                disabled={!enoughBingoTiles}
                aria-expanded={showingOptimal}
              >
                <Trophy size={14} /> Optimal exchange
              </button>
            )}
          </div>
        </details>
      ) : (
        <button
          type="button"
          className="text-button"
          onClick={() => chooseMode("entry")}
        >
          Done
        </button>
      )}
    </div>
  );
  const bagButton = (
    <RackBag
      count={bagUnavailable ? "?" : recordedBag?.count ?? bagCount}
      label={bagUnavailable ? "Bag count unavailable" : bagStatus}
      invalid={!bagUnavailable && bagInvalid}
      controls={bagUnavailable ? undefined : tilePoolId}
      expanded={bagUnavailable ? undefined : tilePoolOpen}
      onClick={bagUnavailable ? undefined : () => {
        onReviewEdit?.();
        setTilePoolOpen((open) => !open);
      }}
    />
  );
  const details = (
    <>
      {recordingExchange ? (
        <div className="rack-exchange-actions rack-record-exchange" role="group" aria-label="Exchange your tiles">
          <span role="status">{recordingExchange.slots.length} selected</span>
          <button
            type="button"
            className="button primary"
            disabled={!recordingExchange.slots.length}
            onClick={() => {
              setExchangeMarks({});
              setSimulation(undefined);
              recordingExchange.confirm();
            }}
          >Record exchange</button>
          <button type="button" className="text-button" onClick={recordingExchange.cancel}>Cancel</button>
        </div>
      ) : !!exchangeSlots.length && (
        <div className="rack-exchange-actions">
          <button
            ref={exchangeButton}
            type="button"
            className="button secondary"
            aria-expanded={!!activeSimulation}
            onClick={() => {
              setOptimalOpen(undefined);
              setSimulation(
                activeSimulation ? undefined : { key: exchangeKey },
              );
            }}
          >
            Simulate exchange ({exchangeSlots.length})
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => setExchangeMarks({})}
          >
            Clear marks
          </button>
        </div>
      )}
      {showingOptimal && optimalOpen && !flyingRack && (
        <OptimalExchange
          key={optimalKey}
          game={game}
          bag={bagCount}
          scorelessTurns={exchangeScorelessTurns}
          restoredResult={optimalOpen.result}
          onClose={() => {
            setOptimalOpen(undefined);
            const control = phoneLayout ? tools.current?.querySelector("summary") : optimalButton.current;
            control?.focus({ preventScroll: true });
          }}
          onUse={({ slots, chance }, result) => {
            setExchangeMarks(
              Object.fromEntries(slots.map((slot) => [slot, game.rack[slot]])),
            );
            setOptimalOpen(undefined);
            openExchange.current = { reveal: false };
            setSimulation({
              key: JSON.stringify([optimalKey, slots]),
              optimalResult: result,
              bingoEstimate: { chance, afterReply: !!result.refinementDraws },
            });
          }}
        />
      )}
      {!recording && activeSimulation && !!exchangeSlots.length && (
        <ExchangeAnalysis
          key={exchangeKey}
          game={game}
          slots={exchangeSlots}
          bagSize={bagCount}
          bagAssumed={!bagConfirmed}
          cachedResult={exchangeResults?.get(exchangeKey)}
          bingoEstimate={activeSimulation.bingoEstimate}
          onResult={cacheExchangeResult}
          onBack={
            activeSimulation.optimalResult
              ? () => {
                  setSimulation(undefined);
                  setOptimalOpen({
                    key: optimalKey,
                    result: activeSimulation.optimalResult,
                  });
                }
              : undefined
          }
          recommendation={
            acceptedAdvice?.key === exchangeKey
              ? acceptedAdvice.detail
              : undefined
          }
        />
      )}
      {!bagUnavailable && <TilePool
        pool={replayFrame?.unseen ?? unseenTiles(game, game.template)}
        rackUnknown={replayFrame?.unseenRackUnknown}
        solo={game.solo}
        id={tilePoolId}
        open={tilePoolOpen}
        hideWhenClosed={phoneLayout}
        onOpenChange={setTilePoolOpen}
      />}
    </>
  );
  return (
    <div
      className="rack-entry"
      data-recorded-preview={recordedPreview || undefined}
      data-recording-exchange={recording || undefined}
      data-replay-opponent={recordedOpponent || undefined}
      data-draw-shelf={drawShelf || undefined}
      style={
        {
          "--rack-size": capacity,
          "--opponent-rack-rows": Math.ceil(opponentRack.length / 2),
        } as CSSProperties
      }
    >
      {phoneLayout && rackTools}
      <div className="rack-lane rack-player-lane">
        {opponentRack && (
          <small className="rack-owner-label" aria-hidden="true">
            You
          </small>
        )}
        {playerTiles}
        {drawShelf && (
          <ReplayDrawShelf
            draw={recordedPreview ? replayFrame?.draw : undefined}
            rules={game.template.rules}
            start={previewSlots?.length ? Math.min(...previewSlots) : 0}
          />
        )}
        {!phoneLayout && !reviewing && (
          <>
            <button
              type="button"
              className="button secondary rack-shuffle"
              aria-label="Shuffle rack"
              title="Shuffle rack"
              disabled={!canReorder || rackLetters(game.rack).length < 2}
              onClick={reorder.shuffle}
            >
              <Shuffle size={16} aria-hidden="true" />
            </button>
            {bagButton}
          </>
        )}
      </div>
      {opponentRack && (
        <OpponentRack rack={opponentRack}>{!phoneLayout && rackTools}</OpponentRack>
      )}
      {phoneLayout && bagButton}
      <input
        className="rack-keyboard-input"
        ref={input}
        tabIndex={onReviewEdit || recording ? -1 : undefined}
        readOnly={recording}
        aria-label="Rack letters"
        aria-keyshortcuts="Alt+R"
        aria-describedby={opponentRack || phoneLayout ? undefined : helpId}
        value={SENTINEL}
        autoCapitalize="characters"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onFocus={() => {
          trackKeyboardFocus();
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          setSelectAll(false);
        }}
        onChange={(e) => {
          if (!e.currentTarget.value) erase();
          else enter(e.currentTarget.value.replaceAll(SENTINEL, ""));
          e.currentTarget.value = SENTINEL;
          e.currentTarget.setSelectionRange(1, 1);
        }}
        onPaste={(e) => {
          e.preventDefault();
          if (!recording) enter(e.clipboardData.getData("text"));
        }}
        onCopy={(e) => {
          if (selectAll) {
            e.preventDefault();
            e.clipboardData.setData("text/plain", rackLetters(game.rack));
          }
        }}
        onKeyDown={(e) => {
          if (recording || e.nativeEvent.isComposing) return;
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
            e.preventDefault();
            setSelectAll(true);
            return;
          }
          if (e.metaKey || e.ctrlKey || e.altKey) return;
          if (
            ![
              "Backspace",
              "Delete",
              previousTileKey,
              nextTileKey,
              cycleMarkKey,
              exchangeKeyShortcut,
              "Home",
              "End",
              "Escape",
              "Enter",
            ].includes(e.key)
          )
            return;
          e.preventDefault();
          switch (e.key) {
            case "Backspace":
              erase();
              break;
            case "Delete":
              erase(true);
              break;
            case previousTileKey:
              eraseSelected.current = true;
              setCursor(
                Math.max(
                  0,
                  selectAll ? 0 : Math.min(position, capacity - 1) - 1,
                ),
              );
              setSelectAll(false);
              break;
            case nextTileKey:
              eraseSelected.current = true;
              setCursor(
                Math.min(capacity, selectAll ? game.rack.length : position + 1),
              );
              setSelectAll(false);
              break;
            case cycleMarkKey:
              if (!selectAll) cycleTileMark(Math.min(position, capacity - 1));
              break;
            case exchangeKeyShortcut:
              if (!selectAll) toggleExchange(Math.min(position, capacity - 1));
              break;
            case "Home":
              eraseSelected.current = true;
              setCursor(0);
              setSelectAll(false);
              break;
            case "End":
              eraseSelected.current = false;
              setCursor(game.rack.length);
              setSelectAll(false);
              break;
            case "Escape":
              input.current?.blur();
              break;
            case "Enter":
              input.current?.blur();
              onSolve();
              break;
          }
        }}
      />
      {!opponentRack && !phoneLayout && (
        <div className="rack-entry-actions">
          <div className="rack-lane-hint">
            <p id={helpId} className="rack-entry-help" hidden={!!advice || recording}>
              {exchangeMode
                ? "Tap tiles to mark for exchange"
                : excludeMode
                  ? "Tap tiles to hold or release them"
                  : requireMode
                    ? "Tap tiles that every move must use"
                    : focused && selectAll
                      ? "All tiles selected · type to replace"
                      : "Space = blank · ↓ Hold / Require · ↑ Exchange · Enter = find moves"}
            </p>
            {advice && (
              <ExchangeSuggestion
                advice={advice}
                rack={game.rack}
                onOpen={() => openSuggestedExchange(false)}
              />
            )}
          </div>
          {game.solo && onEnterOwnPlay && (
            <button type="button" className="text-button rack-own-play" onClick={() => {
              chooseMode("entry");
              onEnterOwnPlay();
            }}>
              <Pencil size={14} /> Enter your play
            </button>
          )}
          {!recording && canOpenOptimal && (
            <button
              ref={optimalButton}
              type="button"
              className="text-button rack-optimal-exchange"
              disabled={!enoughBingoTiles}
              title={!enoughBingoTiles
                ? `Optimal exchange needs at least ${bingoMinimum} playable rack tiles for a bingo.`
                : undefined}
              aria-expanded={showingOptimal}
              onClick={toggleOptimal}
            >
              <span className="rack-optimal-exchange-label">
                <Trophy size={13} aria-hidden="true" /> Optimal exchange
              </span>
            </button>
          )}
          {rackTools}
        </div>
      )}
      {phoneLayout
        ? detailsTarget && createPortal(details, detailsTarget)
        : details}
    </div>
  );
}
