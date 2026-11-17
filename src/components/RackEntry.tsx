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
import {
  enterRack,
  eraseRack,
  rackLetters,
  reorderRack,
  rackSlotsForMove,
  sortedRackSlots,
} from "../../shared/rack-entry";
import { tileScore, type Game, type Move } from "../../shared/model";
import type { ExchangeAdvice } from "../../shared/exchange-advice";
import type { ExchangeResult } from "../../shared/exchange";
import type { OptimalExchangeResult } from "../../shared/optimal-exchange";
import {
  Ban,
  CircleCheck,
  Repeat2,
  Shuffle,
  SlidersHorizontal,
  Trophy,
} from "lucide-react";
import { canAnimateTiles } from "./tile-motion";
import { useRackKeyboard } from "./useRackKeyboard";
import { useRackReorder } from "./useRackReorder";
import ExchangeAnalysis from "./ExchangeAnalysis";
import OptimalExchange from "./OptimalExchange";
import ExchangeSuggestion, { exchangeAdviceDetail } from "./ExchangeSuggestion";
import OpponentRack from "./OpponentRack";

const SENTINEL = "\u200b";
const EXCHANGE_CACHE_LIMIT = 16;
const TILE_HOLD_MS = 450;
export type RackEntryHandle = {
  openSuggestedExchange: (reveal: boolean) => void;
  focusEntry: () => void;
};

export default function RackEntry({
  ref,
  game,
  onChange,
  onSolve,
  phoneLayout,
  onReviewEdit,
  positionKey,
  exchangeAdvice,
  exchangeBag,
  exchangeBagConfirmed,
  opponentRack,
  preview,
  flyingRack,
}: {
  ref?: Ref<RackEntryHandle>;
  game: Game;
  onChange: (game: Game) => void;
  onSolve: () => void;
  phoneLayout: boolean;
  onReviewEdit?: () => void;
  positionKey: string;
  exchangeAdvice?: ExchangeAdvice;
  exchangeBag: number;
  exchangeBagConfirmed: boolean;
  opponentRack: string;
  preview?: Move | null;
  flyingRack?: { before: Game; slots: number[] };
}) {
  const [cursor, setCursor] = useState(game.rack.length);
  const [focused, setFocused] = useState(false);
  const [selectAll, setSelectAll] = useState(false);
  const [mode, setMode] = useState<
    "entry" | "exclude" | "require" | "exchange"
  >("entry");
  const [simulation, setSimulation] = useState<{
    key: string;
    optimalResult?: OptimalExchangeResult;
    bingoEstimate?: number;
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
  const exchangeMode = mode === "exchange";
  const reviewing = !!onReviewEdit;
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
  const canReorder = !reviewing && !flyingRack && mode === "entry";
  const exchangeSlots = Object.keys(exchangeMarks)
    .map(Number)
    .filter((i) => game.rack[i] === exchangeMarks[i]);
  const exchangeKey = JSON.stringify([positionKey, exchangeSlots, exchangeBag]);
  const optimalKey = JSON.stringify([positionKey, exchangeBag]);
  const activeSimulation =
    simulation?.key === exchangeKey ? simulation : undefined;
  const canOpenOptimal = !opponentRack && exchangeBag > 0;
  const showingOptimal = canOpenOptimal && optimalOpen?.key === optimalKey;
  const reorder = useRackReorder({
    rack,
    letters: game.rack,
    positionKey,
    enabled: canReorder,
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
  useEffect(() => () => clearTimeout(holdTimer.current), [positionKey]);
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
    mode === "entry" && !exchangeSlots.length && !flyingRack && !focused
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
        tile.className = `rack-face rack-slide${letter === "?" ? " blank" : ""}`;
        tile.textContent = letter === "?" ? "" : letter;
        const score = document.createElement("small");
        score.textContent = String(tileScore(letter, game.template.rules));
        tile.append(score);
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
  function editFromReview(slot: number) {
    onReviewEdit?.();
    chooseMode("entry");
    focus(slot);
  }
  function focusEntry() {
    if (document.activeElement !== input.current) {
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
    const key = JSON.stringify([positionKey, slots, exchangeBag]);
    setAcceptedAdvice({ key, detail: exchangeAdviceDetail(exchangeAdvice) });
    setSimulation({ key });
  }
  const previewSlots =
    preview && !flyingRack ? rackSlotsForMove(game, preview.tiles) : null;
  const playerTiles = (
    <div
      ref={rack}
      className="rack-tiles"
      role="group"
      aria-label="Your rack tiles"
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
        const excluded = (
          flyingRack?.before.excludedRackSlots ?? excludedSlots
        ).includes(i);
        const required =
          !!tile &&
          (flyingRack?.before.requiredRackSlots ?? requiredSlots).includes(i);
        const exchanging = !flyingRack && exchangeSlots.includes(i);
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
            data-rack-reorderable={canReorder && tile ? "" : undefined}
            className={`rack-tile ${!tile ? "empty" : ""} ${tile === "?" ? "blank" : ""} ${excluded ? "excluded" : ""} ${required ? "required-tile" : ""} ${exchanging ? "exchange-mark" : ""} ${active ? "selected" : ""} ${previewed ? "move-preview" : ""}`}
            aria-label={`Rack tile ${i + 1}: ${tile === "?" ? "blank" : tile || "empty"}${excluded ? ", held out of solver" : ""}${required ? ", required for this move" : ""}${exchanging ? ", marked for exchange" : ""}${previewed ? ", used by preview" : ""}${onReviewEdit ? ", edit rack" : ""}`}
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
              !onReviewEdit && mode !== "entry" && !tile ? true : undefined
            }
            aria-keyshortcuts={canReorder && tile ? "Shift+ArrowLeft Shift+ArrowRight" : undefined}
            onKeyDown={(event) => {
              if (
                !canReorder || !tile || !event.shiftKey ||
                (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
              )
                return;
              event.preventDefault();
              reorder.moveTile(i, i + (event.key === "ArrowLeft" ? -1 : 1));
            }}
            onPointerDown={(event) => {
              if (event.isPrimary === false) return;
              event.preventDefault();
              clearTimeout(holdTimer.current);
              tileHold.current = null;
              suppressTap.current = false;
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
              <span
                className={`rack-face${tile === "?" ? " blank" : ""}${!tile ? " empty" : ""}`}
              >
                {tile === "?" ? "" : tile || "·"}
                {tile && <small>{tileScore(tile, game.template.rules)}</small>}
              </span>
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
  const rackTools = (
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
          <summary className="text-button">
            <SlidersHorizontal size={13} /> Rack tools
          </summary>
          <div className="rack-tools-menu">
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
  return (
    <div
      className="rack-entry"
      style={
        {
          "--rack-size": capacity,
          "--opponent-rack-size": opponentRack.length,
        } as CSSProperties
      }
    >
      <div className="rack-lane rack-player-lane">
        {opponentRack && (
          <small className="rack-owner-label" aria-hidden="true">
            You
          </small>
        )}
        {playerTiles}
        {!reviewing && (
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
        )}
      </div>
      {opponentRack && (
        <OpponentRack rack={opponentRack}>{rackTools}</OpponentRack>
      )}
      <input
        className="rack-keyboard-input"
        ref={input}
        tabIndex={onReviewEdit ? -1 : undefined}
        aria-label="Rack letters"
        aria-keyshortcuts="Alt+R"
        aria-describedby={opponentRack ? undefined : helpId}
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
          enter(e.clipboardData.getData("text"));
        }}
        onCopy={(e) => {
          if (selectAll) {
            e.preventDefault();
            e.clipboardData.setData("text/plain", rackLetters(game.rack));
          }
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
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
              "ArrowLeft",
              "ArrowRight",
              "ArrowDown",
              "ArrowUp",
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
            case "ArrowLeft":
              eraseSelected.current = true;
              setCursor(
                Math.max(
                  0,
                  selectAll ? 0 : Math.min(position, capacity - 1) - 1,
                ),
              );
              setSelectAll(false);
              break;
            case "ArrowRight":
              eraseSelected.current = true;
              setCursor(
                Math.min(capacity, selectAll ? game.rack.length : position + 1),
              );
              setSelectAll(false);
              break;
            case "ArrowDown":
              if (!selectAll) cycleTileMark(Math.min(position, capacity - 1));
              break;
            case "ArrowUp":
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
      {!opponentRack && (
        <div className="rack-entry-actions">
          <div className="rack-lane-hint">
            <p id={helpId} className="rack-entry-help" hidden={!!advice}>
              {exchangeMode
                ? "Tap tiles to mark for exchange"
                : excludeMode
                  ? "Tap tiles to hold or release them"
                  : requireMode
                    ? "Tap tiles that every move must use"
                    : focused && selectAll
                      ? "All tiles selected · type to replace"
                      : phoneLayout
                        ? "Tap to type · hold to mark"
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
          {canOpenOptimal && (
            <button
              ref={optimalButton}
              type="button"
              className="text-button rack-optimal-exchange"
              aria-expanded={showingOptimal}
              onClick={() => {
                chooseMode("entry");
                setSimulation(undefined);
                setOptimalOpen(showingOptimal ? undefined : { key: optimalKey });
              }}
            >
              <Trophy size={13} aria-hidden="true" /> Optimal exchange
            </button>
          )}
          {rackTools}
        </div>
      )}
      {!!exchangeSlots.length && (
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
          bag={exchangeBag}
          assumed={!exchangeBagConfirmed}
          restoredResult={optimalOpen.result}
          onClose={() => {
            setOptimalOpen(undefined);
            optimalButton.current?.focus({ preventScroll: true });
          }}
          onUse={({ slots, chance }, result) => {
            setExchangeMarks(
              Object.fromEntries(slots.map((slot) => [slot, game.rack[slot]])),
            );
            setOptimalOpen(undefined);
            openExchange.current = { reveal: false };
            setSimulation({
              key: JSON.stringify([positionKey, slots, exchangeBag]),
              optimalResult: result,
              bingoEstimate: chance,
            });
          }}
        />
      )}
      {activeSimulation && !!exchangeSlots.length && (
        <ExchangeAnalysis
          key={exchangeKey}
          game={game}
          slots={exchangeSlots}
          bagSize={exchangeBag}
          bagAssumed={!exchangeBagConfirmed}
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
    </div>
  );
}
