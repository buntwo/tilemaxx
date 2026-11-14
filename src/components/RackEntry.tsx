import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  enterRack,
  eraseRack,
  rackLetters,
  sortRack,
  rackSlotsForMove,
} from "../../shared/rack-entry";
import { tileScore, type Game, type Move } from "../../shared/model";
import { Ban, Repeat2, Shuffle, SlidersHorizontal } from "lucide-react";
import { canAnimateTiles } from "./tile-motion";
import ExchangeAnalysis from "./ExchangeAnalysis";

const SENTINEL = "\u200b";

export default function RackEntry({
  game,
  onChange,
  onSolve,
  positionKey,
  preview,
  flyingRack,
}: {
  game: Game;
  onChange: (game: Game) => void;
  onSolve: () => void;
  positionKey: string;
  preview?: Move | null;
  flyingRack?: { before: Game; slots: number[] };
}) {
  const [cursor, setCursor] = useState(game.rack.length);
  const [focused, setFocused] = useState(false);
  const [selectAll, setSelectAll] = useState(false);
  const [mode, setMode] = useState<"entry" | "exclude" | "exchange">("entry");
  const [simulation, setSimulation] = useState<string>();
  const excludeMode = mode === "exclude";
  const exchangeMode = mode === "exchange";
  const tools = useRef<HTMLDetailsElement>(null);
  const [exchangeMarks, setExchangeMarks] = useState<Record<number, string>>(
    {},
  );
  const input = useRef<HTMLInputElement>(null);
  const rack = useRef<HTMLDivElement>(null);
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
  const exchangeSlots = Object.keys(exchangeMarks)
    .map(Number)
    .filter((i) => game.rack[i] === exchangeMarks[i]);
  const exchangeKey = JSON.stringify([positionKey, exchangeSlots]);
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
    animateEdit(result.rack);
    const excludedRackSlots = selectAll
      ? []
      : excludedSlots.filter(
          (slot) => slot < from || slot >= Math.max(from + 1, result.cursor),
        );
    if (
      result.rack !== game.rack ||
      excludedRackSlots.length !== excludedSlots.length
    )
      onChange({
        ...game,
        rack: result.rack,
        excludedRackSlots: excludedRackSlots.length
          ? excludedRackSlots
          : undefined,
      });
    setCursor(result.cursor);
    setSelectAll(false);
    setExchangeMarks(
      Object.fromEntries(
        exchangeSlots
          .filter(
            (slot) =>
              !selectAll &&
              (slot < from || slot >= Math.max(from + 1, result.cursor)),
          )
          .map((slot) => [slot, game.rack[slot]]),
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
  function toggleExcluded(slot: number) {
    if (!game.rack[slot] || game.rack[slot] === ".") return;
    const next = excludedSlots.includes(slot)
      ? excludedSlots.filter((i) => i !== slot)
      : [...excludedSlots, slot].sort((a, b) => a - b);
    onChange({ ...game, excludedRackSlots: next.length ? next : undefined });
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
  }
  const previewSlots =
    preview && !flyingRack ? rackSlotsForMove(game, preview.tiles) : null;
  return (
    <div className="rack-entry">
      <div
        ref={rack}
        className="rack-tiles"
        style={{ "--rack-size": capacity } as CSSProperties}
        role="group"
        aria-label="Your rack tiles"
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
          const exchanging = !flyingRack && exchangeSlots.includes(i);
          const previewed = previewSlots?.includes(i);
          const active =
            focused && (selectAll || i === Math.min(position, capacity - 1));
          return (
            <button
              type="button"
              key={i}
              data-rack-slot={i}
              className={`rack-tile ${!tile ? "empty" : ""} ${tile === "?" ? "blank" : ""} ${excluded ? "excluded" : ""} ${exchanging ? "exchange-mark" : ""} ${active ? "selected" : ""} ${previewed ? "move-preview" : ""}`}
              aria-label={`Rack tile ${i + 1}: ${tile === "?" ? "blank" : tile || "empty"}${excluded ? ", held out of solver" : ""}${exchanging ? ", marked for exchange" : ""}${previewed ? ", used by preview" : ""}`}
              aria-pressed={
                exchangeMode ? exchanging : excludeMode ? excluded : active
              }
              aria-disabled={
                (excludeMode || exchangeMode) && !tile ? true : undefined
              }
              onPointerDown={(e) => e.preventDefault()}
              onClick={() =>
                exchangeMode
                  ? toggleExchange(i)
                  : excludeMode
                    ? toggleExcluded(i)
                    : focus(i)
              }
            >
              <span className="rack-slot-window" aria-hidden="true" />
              <span
                className={`rack-face${tile === "?" ? " blank" : ""}${!tile ? " empty" : ""}`}
              >
                {tile === "?" ? "" : tile || "·"}
                {tile && <small>{tileScore(tile, game.template.rules)}</small>}
              </span>
              {exchanging && (
                <Repeat2
                  className="rack-exchange-icon"
                  size={12}
                  aria-hidden="true"
                />
              )}
              {excluded && (
                <Ban
                  className="rack-excluded-icon"
                  size={12}
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>
      <input
        className="rack-keyboard-input"
        ref={input}
        aria-label="Rack letters"
        aria-describedby={helpId}
        value={SENTINEL}
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        onFocus={() => setFocused(true)}
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
              if (!selectAll) toggleExcluded(Math.min(position, capacity - 1));
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
      <div className="rack-entry-actions">
        <p id={helpId} className="rack-entry-help">
          {exchangeMode
            ? "Tap tiles to mark for exchange"
            : excludeMode
              ? "Tap tiles to hold or release them"
              : focused && selectAll
                ? "All tiles selected · type to replace"
                : "Space = blank · ↓ Hold · ↑ Exchange"}
        </p>
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
                  onChange({ ...game, ...sortRack(game) });
                }}
              >
                <Shuffle size={14} /> Sort rack
              </button>
              <button type="button" onClick={() => chooseMode("exclude")}>
                <Ban size={14} /> Exclude tiles
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
      {!!exchangeSlots.length && (
        <div className="rack-exchange-actions">
          <button
            type="button"
            className="button secondary"
            aria-expanded={simulation === exchangeKey}
            onClick={() =>
              setSimulation(
                simulation === exchangeKey ? undefined : exchangeKey,
              )
            }
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
      {simulation === exchangeKey && !!exchangeSlots.length && (
        <ExchangeAnalysis key={exchangeKey} game={game} slots={exchangeSlots} />
      )}
    </div>
  );
}
