import { useEffect, useId, useRef, useState } from "react";
import { enterRack, eraseRack, rackLetters } from "../../shared/rack-entry";
import { tileScore, type Game } from "../../shared/model";

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
  const input = useRef<HTMLInputElement>(null);
  // A directly selected tile is replaced/erased once; typing and deletion
  // return to insertion-cursor behavior for subsequent Backspaces.
  const eraseSelected = useRef(false);
  const helpId = useId();
  const capacity = game.template.rackSize;
  const position = Math.min(cursor, capacity);
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
  function save(result: { rack: string; cursor: number }) {
    if (result.rack !== game.rack) onChange({ ...game, rack: result.rack });
    setCursor(result.cursor);
    setSelectAll(false);
  }
  function enter(text: string) {
    if (!/[a-z ?]/i.test(text)) return;
    eraseSelected.current = false;
    save(
      enterRack(
        selectAll ? "" : game.rack,
        selectAll ? 0 : position,
        text,
        capacity,
      ),
    );
  }
  function erase(forward = false) {
    const selected = forward || eraseSelected.current;
    eraseSelected.current = false;
    save(
      selectAll
        ? { rack: "", cursor: 0 }
        : eraseRack(
            game.rack,
            selected ? Math.min(position, capacity - 1) : position,
            selected ? "selected" : "backward",
          ),
    );
  }
  function focus(i: number) {
    eraseSelected.current = true;
    setCursor(i);
    setSelectAll(false);
    setFocused(true);
    input.current?.focus({ preventScroll: true });
    input.current?.setSelectionRange(1, 1);
  }
  return (
    <div className="rack-entry">
      <div className="rack-tiles" role="group" aria-label="Your rack tiles">
        {Array.from({ length: capacity }, (_, i) => {
          const tile = game.rack[i] === "." ? "" : game.rack[i];
          const active =
            focused && (selectAll || i === Math.min(position, capacity - 1));
          return (
            <button
              type="button"
              key={i}
              className={`rack-tile ${!tile ? "empty" : ""} ${tile === "?" ? "blank" : ""} ${active ? "selected" : ""} ${active && position === capacity && !selectAll ? "rack-end" : ""}`}
              aria-label={`Rack tile ${i + 1}: ${tile === "?" ? "blank" : tile || "empty"}`}
              aria-pressed={active}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => focus(i)}
            >
              {tile === "?" ? "" : tile || "·"}
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
              setCursor(Math.max(0, selectAll ? 0 : position - 1));
              setSelectAll(false);
              break;
            case "ArrowRight":
              eraseSelected.current = true;
              setCursor(
                Math.min(capacity, selectAll ? game.rack.length : position + 1),
              );
              setSelectAll(false);
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
      <p id={helpId} className="rack-entry-help">
        {focused && selectAll
          ? "All tiles selected · type to replace"
          : focused && position === capacity
            ? "End of rack · tap a tile to edit"
            : "Tap a tile and type · Space = blank"}
      </p>
    </div>
  );
}
