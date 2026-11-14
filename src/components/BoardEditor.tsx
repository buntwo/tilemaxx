import { useState } from "react";
import { ArrowLeft, Check, RotateCcw } from "lucide-react";
import Board from "./Board";
import {
  type BoardTemplate,
  type Premium,
  type Rules,
  RULE_NAMES,
  emptyBoard,
} from "../../shared/model";
import { PRESETS } from "../../shared/presets";
import {
  getTileCounts,
  MAX_TILE_COUNT,
  TILE_SYMBOLS,
} from "../../shared/tile-pool";

export default function BoardEditor({
  templates,
  initial,
  onSave,
  onClose,
}: {
  templates: BoardTemplate[];
  initial?: BoardTemplate;
  onSave: (t: BoardTemplate) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<BoardTemplate>({
    ...(initial || PRESETS[0]),
    id: initial?.id || "custom",
    name: initial?.name || "My custom board",
    builtin: false,
    premiums: [...(initial || PRESETS[0]).premiums],
  });
  const [brush, setBrush] = useState<Premium | "start">("DW"),
    [symmetry, setSymmetry] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const tileCounts = getTileCounts(draft);
  const tileTotal = Object.values(tileCounts).reduce(
    (total, count) => total + count,
    0,
  );
  function resize(size: number) {
    if (!Number.isInteger(size) || size < 5 || size > 25) return;
    const premiums: Premium[] = Array(size * size).fill("");
    for (let r = 0; r < Math.min(size, draft.size); r++)
      for (let c = 0; c < Math.min(size, draft.size); c++)
        premiums[r * size + c] = draft.premiums[r * draft.size + c];
    setDraft({
      ...draft,
      size,
      premiums,
      start: Math.floor(size / 2) * size + Math.floor(size / 2),
    });
  }
  function paint(i: number) {
    if (brush === "start") {
      setDraft({ ...draft, start: i });
      return;
    }
    const premiums = [...draft.premiums],
      n = draft.size,
      r = Math.floor(i / n),
      c = i % n;
    const cells = symmetry
      ? [
          [r, c],
          [r, n - 1 - c],
          [n - 1 - r, c],
          [n - 1 - r, n - 1 - c],
        ]
      : [[r, c]];
    for (const [row, col] of cells) premiums[row * n + col] = brush;
    setDraft({ ...draft, premiums });
  }
  return (
    <section
      className="studio-view studio-editor"
      aria-labelledby="studio-editor-heading"
    >
      <div className="workspace-heading studio-heading">
        <h1 id="studio-editor-heading">
          {initial ? "Edit board" : "New custom board"}
        </h1>
        <button className="button secondary archive-back" onClick={onClose}>
          <ArrowLeft size={16} /> Board studio
        </button>
      </div>
      <form
        className="panel studio-panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSave({ ...draft, tileCounts });
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        <div className="editor-layout">
          <div className="editor-controls">
            <label>
              Board name
              <input
                required
                maxLength={80}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            {!initial && (
              <label>
                Start from
                <select
                  defaultValue="scrabble"
                  onChange={(e) => {
                    const t = templates.find((t) => t.id === e.target.value)!;
                    setDraft({
                      ...t,
                      name: draft.name,
                      id: "custom",
                      builtin: false,
                      premiums: [...t.premiums],
                    });
                  }}
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="form-row">
              <label>
                Board size
                <select
                  value={draft.size}
                  onChange={(e) => resize(+e.target.value)}
                >
                  {Array.from({ length: 21 }, (_, i) => (
                    <option key={i} value={i + 5}>
                      {i + 5} × {i + 5}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Rack size
                <input
                  type="number"
                  min={1}
                  max={10}
                  required
                  value={draft.rackSize}
                  onChange={(e) =>
                    setDraft({ ...draft, rackSize: +e.target.value })
                  }
                />
              </label>
            </div>
            <label>
              Tile values
              <select
                value={draft.rules}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    rules: e.target.value as Rules,
                  })
                }
              >
                {Object.entries(RULE_NAMES).map(([rules, name]) => (
                  <option key={rules} value={rules}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Full-rack bonus
              <input
                type="number"
                min={0}
                max={200}
                required
                value={draft.bingo}
                onChange={(e) => setDraft({ ...draft, bingo: +e.target.value })}
              />
            </label>
            <span className="field-label">Paint a square</span>
            <div className="paint-palette">
              {(["", "DL", "TL", "QL", "DW", "TW", "QW", "start"] as const).map(
                (p) => (
                  <button
                    type="button"
                    aria-pressed={brush === p}
                    className={`brush ${p.toLowerCase()} ${brush === p ? "active" : ""}`}
                    key={p}
                    onClick={() => setBrush(p)}
                  >
                    {p === "start" ? "★ Start" : p || "Erase"}
                  </button>
                ),
              )}
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={symmetry}
                onChange={(e) => setSymmetry(e.target.checked)}
              />
              Mirror across both axes
            </label>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                setDraft({
                  ...draft,
                  premiums: Array(draft.size ** 2).fill(""),
                })
              }
            >
              <RotateCcw size={15} />
              Clear bonuses
            </button>
          </div>
          <Board
            template={draft}
            board={emptyBoard(draft.size)}
            onSelect={paint}
            paint
          />
        </div>
        <details className="tile-count-editor">
          <summary>Starting tile counts · {tileTotal} tiles</summary>
          <div className="tile-count-fields">
            {TILE_SYMBOLS.map((symbol) => (
              <label key={symbol}>
                {symbol === "?" ? "Blank" : symbol}
                <input
                  aria-label={`Starting ${symbol === "?" ? "blank" : symbol} count`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_TILE_COUNT}
                  value={tileCounts[symbol]}
                  onChange={(e) => {
                    const count = Math.max(
                      0,
                      Math.min(
                        MAX_TILE_COUNT,
                        Math.trunc(Number(e.target.value)),
                      ),
                    );
                    setDraft({
                      ...draft,
                      tileCounts: { ...tileCounts, [symbol]: count },
                    });
                  }}
                />
              </label>
            ))}
          </div>
        </details>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !draft.name.trim()}
          >
            <Check size={16} />
            {busy
              ? "Saving…"
              : initial
                ? "Save changes"
                : "Save board template"}
          </button>
        </footer>
      </form>
    </section>
  );
}
