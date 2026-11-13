import { useEffect, useId, useRef, useState } from "react";
import { enterRack, eraseRack, rackLetters } from "../../shared/rack-entry";
import { tileScore, type Game } from "../../shared/model";
import { Ban } from "lucide-react";

const SENTINEL = "\u200b";

export default function RackEntry({
  game,
  onChange,
  onSolve,
}: {
  game: Game;
  onChange: (game: Game) => void;
  onSolve: () => void;
}) {
  const [cursor, setCursor] = useState(game.rack.length);
  const [focused, setFocused] = useState(false);
  const [selectAll, setSelectAll] = useState(false);
  const [excludeMode, setExcludeMode] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // A directly selected tile is replaced/erased once; typing and deletion
  // return to insertion-cursor behavior for subsequent Backspaces.
  const eraseSelected = useRef(false);
  const helpId = useId();
  const capacity = game.template.rackSize;
  const position = Math.min(cursor, capacity);
  const excludedSlots = game.excludedRackSlots ?? [];
  useEffect(() => {
    const blur = () => {
      setFocused(false);
      setSelectAll(false);
    };
    const focus = () => setFocused(document.activeElement === input.current);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
    };
  }, []);
  function save(result: { rack: string; cursor: number }, from: number) {
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
  return (
    <div className="rack-entry">
      <div className="rack-tiles" role="group" aria-label="Your rack tiles">
        {Array.from({ length: capacity }, (_, i) => {
          const tile = game.rack[i] === "." ? "" : game.rack[i];
          const excluded = excludedSlots.includes(i);
          const active =
            focused && (selectAll || i === Math.min(position, capacity - 1));
          return (
            <button
              type="button"
              key={i}
              className={`rack-tile ${!tile ? "empty" : ""} ${tile === "?" ? "blank" : ""} ${excluded ? "excluded" : ""} ${active ? "selected" : ""}`}
              aria-label={`Rack tile ${i + 1}: ${tile === "?" ? "blank" : tile || "empty"}${excluded ? ", held out of solver" : ""}`}
              aria-pressed={excludeMode ? excluded : active}
              aria-disabled={excludeMode && !tile ? true : undefined}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => (excludeMode ? toggleExcluded(i) : focus(i))}
            >
              {tile === "?" ? "" : tile || "·"}
              {excluded && (
                <Ban
                  className="rack-excluded-icon"
                  size={12}
                  aria-hidden="true"
                />
              )}
              {tile && (
                <small>
                  {tile === "?" ? 0 : tileScore(tile, game.template.rules)}
                </small>
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
          {excludeMode
            ? "Tap tiles to hold or release them"
            : focused && selectAll
              ? "All tiles selected · type to replace"
              : "Space = blank · ↓ = hold tile"}
        </p>
        <button
          type="button"
          className="button secondary rack-exclude-button"
          aria-pressed={excludeMode}
          onClick={() => {
            input.current?.blur();
            setExcludeMode(!excludeMode);
          }}
        >
          {excludeMode ? "Done" : "Exclude tiles"}
        </button>
      </div>
    </div>
  );
}
