import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type {
  DefinitionLanguage,
  DefinitionLookup,
  WordDefinition,
} from "../../shared/definitions";
import type { Move } from "../../shared/model";
import { api } from "../store";
import Modal from "./Modal";

const HOVER_DELAY_MS = 500;
const LEAVE_DELAY_MS = 200;

type TargetWord = { word: string; direction?: Move["direction"] };
type Selection = {
  anchor: HTMLElement;
  words: TargetWord[];
} & ({ kind: "hover" | "tile" } | { kind: "sheet"; title: string });

export function useDefinitionTooltip(
  language: DefinitionLanguage | undefined,
  positionKey: unknown,
  sheetLocked = false,
) {
  const id = useId();
  const [selection, setSelection] = useState<Selection>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const tip = useRef<HTMLDivElement>(null);
  const cancelTimer = useCallback(() => clearTimeout(timer.current), []);
  const close = useCallback(() => {
    cancelTimer();
    setSelection(undefined);
  }, [cancelTimer]);

  useLayoutEffect(() => {
    close();
    return cancelTimer;
  }, [language, positionKey, close, cancelTimer]);

  useEffect(() => {
    if (!language || selection?.kind === "sheet") return;
    function outside(event: Event) {
      if (event.target instanceof Node && tip.current?.contains(event.target))
        return;
      close();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", outside, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", close);
    };
  }, [language, selection?.kind, close]);

  function open(anchor: HTMLElement, words: TargetWord[]) {
    if (!language || !words.length) return;
    cancelTimer();
    setSelection({ anchor, words, kind: "tile" });
  }

  function openSheet(anchor: HTMLElement, words: TargetWord[], title: string) {
    if (!language || !words.length) return;
    cancelTimer();
    setSelection({ anchor, words, kind: "sheet", title });
  }

  function hover(anchor: HTMLElement, word: string) {
    if (!language) return;
    cancelTimer();
    if (selection?.anchor === anchor) return;
    setSelection(undefined);
    timer.current = setTimeout(() => {
      if (anchor.isConnected)
        setSelection({ anchor, words: [{ word }], kind: "hover" });
    }, HOVER_DELAY_MS);
  }

  function leave() {
    cancelTimer();
    timer.current = setTimeout(close, LEAVE_DELAY_MS);
  }

  return {
    id: selection?.kind === "sheet" ? undefined : id,
    open,
    openSheet,
    hover,
    leave,
    anchor: selection?.anchor,
    popup:
      language &&
      selection &&
      createPortal(
        selection.kind === "sheet" ? (
          <DefinitionSheet
            language={language}
            selection={selection}
            locked={sheetLocked}
            onClose={close}
          />
        ) : (
          <DefinitionTooltip
            id={id}
            language={language}
            selection={selection}
            tip={tip}
            onEnter={cancelTimer}
            onLeave={leave}
          />
        ),
        document.body,
      ),
  };
}

function positionTooltip(tip: HTMLElement, anchor: HTMLElement) {
  const edge = 8;
  const gap = 8;
  const viewportWidth =
    document.documentElement.clientWidth || window.innerWidth;
  const width = Math.min(280, viewportWidth - edge * 2);
  const rect = anchor.getBoundingClientRect();
  const right = viewportWidth - rect.right - gap - edge;
  const left = rect.left - gap - edge;
  const side =
    right >= Math.min(200, width)
      ? "right"
      : left >= Math.min(200, width)
        ? "left"
        : "vertical";
  const fittedWidth = Math.min(
    width,
    side === "right" ? right : side === "left" ? left : width,
  );
  tip.style.width = `${fittedWidth}px`;
  const height = tip.offsetHeight;
  const center = rect.top + rect.height / 2;
  const leftOffset =
    side === "right"
      ? rect.right + gap
      : side === "left"
        ? rect.left - gap - fittedWidth
        : Math.min(rect.left, viewportWidth - edge - fittedWidth);
  const topOffset =
    side !== "vertical"
      ? center - 24
      : rect.bottom + gap + height <= window.innerHeight - edge
        ? rect.bottom + gap
        : rect.top - gap - height;
  const top = Math.max(
    edge,
    Math.min(topOffset, window.innerHeight - edge - height),
  );
  const arrow = Math.max(11, Math.min(center - top, height - 11));
  tip.style.left = `${Math.max(edge, leftOffset)}px`;
  tip.style.top = `${top}px`;
  tip.style.setProperty("--definition-arrow-offset", `${arrow}px`);
  tip.dataset.side = side;
}

function DefinitionTooltip({
  id,
  language,
  selection,
  tip,
  onEnter,
  onLeave,
}: {
  id: string;
  language: DefinitionLanguage;
  selection: Selection;
  tip: React.RefObject<HTMLDivElement | null>;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const result = useDefinitionLookup(language, selection.words);
  const hover = selection.kind === "hover";

  useLayoutEffect(() => {
    if (tip.current) positionTooltip(tip.current, selection.anchor);
  }, [tip, selection, result]);

  return (
    <div
      className="definition-tooltip"
      id={id}
      ref={tip}
      role={hover ? "tooltip" : "region"}
      aria-label={hover ? undefined : "Word definitions"}
      onPointerEnter={hover ? onEnter : undefined}
      onPointerLeave={hover ? onLeave : undefined}
    >
      <div className="definition-tooltip-content">
        <DefinitionContent
          language={language}
          words={selection.words}
          result={result}
        />
      </div>
    </div>
  );
}

function DefinitionSheet({
  language,
  selection,
  locked,
  onClose,
}: {
  language: DefinitionLanguage;
  selection: Extract<Selection, { kind: "sheet" }>;
  locked: boolean;
  onClose: () => void;
}) {
  const result = useDefinitionLookup(language, selection.words);
  return (
    <Modal
      title={selection.title}
      className={
        locked ? "definition-sheet waiting-for-release" : "definition-sheet"
      }
      onClose={onClose}
      closeDisabled={locked}
    >
      <div aria-live="polite" inert={locked}>
        <DefinitionContent
          language={language}
          words={selection.words}
          result={result}
        />
      </div>
    </Modal>
  );
}

function useDefinitionLookup(
  language: DefinitionLanguage,
  words: TargetWord[],
) {
  const [response, setResponse] = useState<{
    words: TargetWord[];
    lookup?: DefinitionLookup;
  }>();
  useEffect(() => {
    const request = new AbortController();
    const query = new URLSearchParams({ language });
    for (const { word } of words) query.append("word", word);
    void api<DefinitionLookup>(
      `/definitions?${query}`,
      "GET",
      undefined,
      request.signal,
    )
      .then((lookup) => {
        if (!request.signal.aborted) setResponse({ words, lookup });
      })
      .catch(() => {
        if (!request.signal.aborted) setResponse({ words });
      });
    return () => request.abort();
  }, [language, words]);
  return response?.words === words ? response : undefined;
}

function DefinitionContent({
  language,
  words,
  result,
}: {
  language: DefinitionLanguage;
  words: TargetWord[];
  result: ReturnType<typeof useDefinitionLookup>;
}) {
  if (!result)
    return <p className="definition-muted">Looking up definitions…</p>;
  if (!result.lookup?.available)
    return <p className="definition-muted">Definitions unavailable.</p>;
  const { entries } = result.lookup;
  return (
    <>
      {words.map(({ word, direction }, index) => (
        <section className="definition-word" key={direction ?? word}>
          {direction && (
            <p className="definition-heading">
              <span>{direction === "across" ? "Across" : "Down"}</span>
              <strong>{word}</strong>
            </p>
          )}
          <Glosses
            language={language}
            compact={!direction}
            entries={preferredSpellings(entries[index])}
          />
        </section>
      ))}
    </>
  );
}

function preferredSpellings(entries: WordDefinition[]) {
  const bySpelling = new Map<string, WordDefinition>();
  for (const entry of entries) {
    const first = bySpelling.get(entry.spelling);
    if (
      !first ||
      (entry.spelling === entry.headword && first.headword !== entry.spelling)
    ) {
      bySpelling.set(entry.spelling, entry);
    }
  }
  return [...bySpelling.values()];
}

function Glosses({
  language,
  compact,
  entries,
}: {
  language: DefinitionLanguage;
  compact: boolean;
  entries: WordDefinition[];
}) {
  if (!entries.length)
    return <p className="definition-muted">No definition found.</p>;
  return (
    <dl className={compact ? "definition-preview" : "definition-glosses"}>
      {entries.map(
        ({ spelling, headword, partOfSpeech, glosses, sourceUrl }) => (
          <div key={spelling}>
            <dt>
              <span lang={language}>
                {sourceUrl ? (
                  <a href={sourceUrl} target="_blank" rel="noreferrer">
                    {spelling}
                    {headword !== spelling && ` → ${headword}`}
                  </a>
                ) : (
                  spelling
                )}
              </span>
              {compact && partOfSpeech && <i>{partOfSpeech}</i>}
            </dt>
            <dd>{glosses[0]}</dd>
          </div>
        ),
      )}
    </dl>
  );
}
