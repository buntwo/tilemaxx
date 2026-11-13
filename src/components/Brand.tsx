import { useEffect, useRef, useState, type Ref } from "react";
import { flushSync } from "react-dom";
import { Flame } from "lucide-react";
import { tileScore } from "../../shared/model";
import {
  animateBrandReturn,
  BRAND_RETURN_PAUSE,
  BRAND_WORD,
} from "./brand-animation";
import { attachBrandSparkle } from "./brand-sparkle";

const uniqueLetters = "TILEMAX";
const brandIndex = Math.floor(Math.random() * uniqueLetters.length);
const brandLetter = uniqueLetters[brandIndex];
const highlightedIndex =
  brandLetter === "X" && Math.random() < 0.5 ? brandIndex + 1 : brandIndex;
const fireTileKey = "tilemaxx:fire-next-refresh";
const fireTileCombo = [6, 7, 4, 5, 6, 7];

function forceFireTile() {
  try {
    if (sessionStorage.getItem(fireTileKey) !== "1") return false;
    sessionStorage.removeItem(fireTileKey);
    return true;
  } catch {
    return false;
  }
}

const brandOnFire = forceFireTile() || Math.random() < 0.1;

export function updateFavicon() {
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!icon) return;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = brandOnFire ? "#af3228" : "#184f41";
  ctx.beginPath();
  ctx.roundRect(2, 2, 60, 60, 12);
  ctx.fill();
  ctx.fillStyle = brandOnFire ? "#fff5dd" : "#f3e6c9";
  ctx.font = "bold 43px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(brandLetter, 31, 46);
  ctx.font = "bold 14px system-ui";
  ctx.textAlign = "right";
  ctx.fillText(String(tileScore(brandLetter, "scrabble")), 56, 54);
  icon.type = "image/png";
  icon.href = canvas.toDataURL();
}

export function BrandTile({
  letter = brandLetter,
  ref,
}: {
  letter?: string;
  ref?: Ref<HTMLSpanElement>;
}) {
  return (
    <span
      ref={ref}
      className={`brand-mark${brandOnFire ? " on-fire" : ""}`}
      aria-hidden="true"
    >
      <span className="brand-face">
        {letter}
        <small>{tileScore(letter, "scrabble")}</small>
      </span>
      {brandOnFire && <Flame className="brand-flame" size={19} />}
    </span>
  );
}

export default function Brand({ onFireArmed }: { onFireArmed?: () => void }) {
  const [selected, setSelected] = useState(highlightedIndex);
  const selectedRef = useRef(highlightedIndex);
  const tileButton = useRef<HTMLButtonElement>(null);
  const tile = useRef<HTMLSpanElement>(null);
  const word = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const stopMotion = useRef<(() => void) | undefined>(undefined);
  const tapStart = useRef<{ pointer: number; index: number } | null>(null);
  const combo = useRef({ length: 0, lastTap: 0 });

  function recordTap(index: number) {
    const now = performance.now();
    const length =
      now - combo.current.lastTap <= 2000 ? combo.current.length : 0;
    const next =
      index === fireTileCombo[length]
        ? length + 1
        : index === fireTileCombo[0]
          ? 1
          : 0;
    combo.current = { length: next, lastTap: now };
    if (next !== fireTileCombo.length) return;
    combo.current.length = 0;
    try {
      sessionStorage.setItem(fireTileKey, "1");
    } catch {
      return;
    }
    onFireArmed?.();
  }

  function cancelReturn() {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    stopMotion.current?.();
    stopMotion.current = undefined;
  }

  useEffect(() => cancelReturn, []);
  useEffect(() => {
    if (tileButton.current && tile.current)
      return attachBrandSparkle(tileButton.current, tile.current, brandOnFire);
  }, []);

  function preview(index: number) {
    cancelReturn();
    selectedRef.current = index;
    setSelected(index);
  }

  function scheduleReturn() {
    if (
      selectedRef.current === highlightedIndex ||
      timer.current !== undefined ||
      stopMotion.current
    )
      return;

    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      if (tile.current && word.current) {
        stopMotion.current = animateBrandReturn(
          tile.current,
          word.current,
          selectedRef.current,
          highlightedIndex,
          () => flushSync(() => preview(highlightedIndex)),
        );
      }
    }, BRAND_RETURN_PAUSE);
  }

  return (
    <div className={`brand${brandOnFire ? " on-fire" : ""}`}>
      <button
        className="brand-tile-button"
        ref={tileButton}
        type="button"
        aria-label="Sparkle the Tilemaxx tile"
      >
        <BrandTile ref={tile} letter={BRAND_WORD[selected].toUpperCase()} />
      </button>
      <a
        className="brand-name"
        href="/"
        aria-label="Tilemaxx"
        onClick={(e) => e.preventDefault()}
      >
        <span
          ref={word}
          className="brand-word"
          onPointerLeave={scheduleReturn}
          onPointerMove={(e) => {
            if (
              e.pointerType === "mouse" ||
              !e.currentTarget.hasPointerCapture(e.pointerId)
            )
              return;
            const letter = document
              .elementFromPoint(e.clientX, e.clientY)
              ?.closest<HTMLElement>("[data-brand-letter]");
            if (letter && e.currentTarget.contains(letter)) {
              preview(Number(letter.dataset.brandLetter));
            } else {
              scheduleReturn();
            }
          }}
          onPointerUp={(e) => {
            const tap = tapStart.current;
            if (tap?.pointer === e.pointerId) {
              tapStart.current = null;
              const target =
                e.pointerType === "mouse"
                  ? e.target
                  : document.elementFromPoint?.(e.clientX, e.clientY);
              if (target === e.currentTarget.children[tap.index])
                recordTap(tap.index);
            }
            if (e.pointerType !== "mouse") scheduleReturn();
          }}
          onPointerCancel={() => {
            tapStart.current = null;
            scheduleReturn();
          }}
          onLostPointerCapture={scheduleReturn}
        >
          {[...BRAND_WORD].map((letter, index) => (
            <span
              key={index}
              data-brand-letter={index}
              className={
                index === selected
                  ? `brand-highlight${brandOnFire ? " on-fire" : ""}`
                  : undefined
              }
              onPointerEnter={(e) => {
                if (e.pointerType === "mouse" || e.pointerType === "pen")
                  preview(index);
              }}
              onPointerDown={(e) => {
                if (!e.isPrimary || e.button !== 0) return;
                tapStart.current = { pointer: e.pointerId, index };
                if (e.pointerType === "mouse") return;
                word.current?.setPointerCapture(e.pointerId);
                preview(index);
              }}
            >
              {letter}
            </span>
          ))}
        </span>
        <span className="brand-caption">A LITTLE WORD WISDOM</span>
      </a>
    </div>
  );
}
