import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { computeWorkerLimit, isWorkerCount } from "../compute-workers";
import Modal from "./Modal";

const storageKey = "tilemaxx:workspace-preferences";
type TurnBorder = "panel-and-divider" | "panel-only";
const defaults = {
  boardTurnBorder: "panel-only" as TurnBorder,
  highlightRackPreview: true,
  pulseMovePreviews: true,
  animatePlayedTiles: true,
  skipPlayedTiles: true,
  autoUpdate: true,
  limitComputeWorkers: false,
  computeWorkerCap: 1,
};
type Preferences = typeof defaults;

const sections = [
  {
    title: "Move previews",
    options: [
      ["highlightRackPreview", "Highlight rack tiles on move preview"],
      ["pulseMovePreviews", "Pulse move previews"],
    ],
  },
  {
    title: "Gameplay",
    options: [
      ["animatePlayedTiles", "Animate tiles when playing a move"],
      ["skipPlayedTiles", "Skip played tiles during board entry"],
    ],
  },
  {
    title: "Updates",
    options: [
      ["autoUpdate", "Automatically reload when an update is available"],
    ],
  },
] as const;

function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    return {
      // The old field automatically saved the previous default in every browser.
      boardTurnBorder: saved?.boardTurnBorder === "panel-and-divider"
        ? "panel-and-divider"
        : defaults.boardTurnBorder,
      highlightRackPreview: saved?.highlightRackPreview !== false,
      pulseMovePreviews: saved?.pulseMovePreviews !== false,
      animatePlayedTiles: saved?.animatePlayedTiles !== false,
      skipPlayedTiles: saved?.skipPlayedTiles !== false,
      autoUpdate: saved?.autoUpdate !== false,
      limitComputeWorkers: (saved?.limitComputeWorkers ?? saved?.singleComputeWorker) === true,
      computeWorkerCap: isWorkerCount(saved?.computeWorkerCap)
        ? saved.computeWorkerCap
        : defaults.computeWorkerCap,
    };
  } catch {
    return defaults;
  }
}

export function useWorkspacePreferences() {
  const [preferences, setPreferences] = useState(readPreferences);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferences));
    } catch {}
  }, [preferences]);
  return [preferences, setPreferences] as const;
}

export default function WorkspaceSettings({
  theme,
  onThemeChange,
  preferences,
  concurrencyHint,
  workerLimit,
  onChange,
  onClose,
}: {
  theme: string;
  onThemeChange: (theme: string) => void;
  preferences: Preferences;
  concurrencyHint: number | undefined;
  workerLimit: number;
  onChange: (preferences: Preferences) => void;
  onClose: () => void;
}) {
  const availableWorkers = computeWorkerLimit(undefined, concurrencyHint);
  const [capDraft, setCapDraft] = useState<string>();
  const cap = Math.min(preferences.computeWorkerCap, availableWorkers);
  return (
    <Modal
      title="Settings"
      subtitle="Applies to all games in this browser only."
      onClose={onClose}
    >
      <div className="workspace-preference-list">
        <fieldset>
          <legend>Appearance</legend>
          <div className="theme-switch" role="group" aria-label="Color theme">
            {([
              ["light", "Light", Sun],
              ["dark", "Dark", Moon],
              ["system", "System", Monitor],
            ] as const).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                aria-label={`${value} theme`}
                aria-pressed={theme === value}
                className={theme === value ? "active" : ""}
                onClick={() => onThemeChange(value)}
              >
                <Icon size={15} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <div className="workspace-turn-border">
            <span id="turn-border-label">Turn border</span>
            <div className="theme-switch" role="group" aria-labelledby="turn-border-label">
              {([
                ["panel-only", "Panel only"],
                ["panel-and-divider", "Panel and divider"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={preferences.boardTurnBorder === value}
                  className={preferences.boardTurnBorder === value ? "active" : ""}
                  onClick={() => onChange({ ...preferences, boardTurnBorder: value })}
                >
                  <span
                    className="turn-border-preview"
                    data-divider={value === "panel-and-divider" || undefined}
                    aria-hidden="true"
                  />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </fieldset>
        {sections.map(({ title, options }) => (
          <fieldset key={title}>
            <legend>{title}</legend>
            {options.map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={preferences[key]}
                  onChange={(event) =>
                    onChange({ ...preferences, [key]: event.target.checked })
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
        ))}
        <fieldset>
          <legend>Hardware info</legend>
          <dl className="workspace-hardware-info">
            <div>
              <dt>Browser concurrency hint</dt>
              <dd>{concurrencyHint ?? "Unavailable"}</dd>
            </div>
            <div>
              <dt>Compute worker limit</dt>
              <dd aria-live="polite">{workerLimit}</dd>
            </div>
          </dl>
          <div className="workspace-worker-limit">
            <label>
              <input
                type="checkbox"
                checked={preferences.limitComputeWorkers}
                aria-describedby="compute-worker-scope"
                onChange={(event) =>
                  onChange({
                    ...preferences,
                    limitComputeWorkers: event.target.checked,
                  })
                }
              />
              Limit compute workers to
            </label>
            <input
              type="number"
              aria-label="Maximum compute workers"
              min={1}
              max={availableWorkers}
              step={1}
              value={capDraft ?? cap}
              disabled={!preferences.limitComputeWorkers}
              onChange={(event) => {
                const { value, valueAsNumber, validity } = event.currentTarget;
                if (validity.valid && isWorkerCount(valueAsNumber)) {
                  setCapDraft(undefined);
                  onChange({ ...preferences, computeWorkerCap: valueAsNumber });
                } else {
                  setCapDraft(value);
                }
              }}
              onBlur={() => setCapDraft(undefined)}
            />
          </div>
          <p className="workspace-hardware-scope" id="compute-worker-scope">
            Applies to reply histograms, exact endgame lines, Solve endgame,
            board-based bingo odds, Optimal exchange, and policy timelines.
          </p>
        </fieldset>
      </div>
    </Modal>
  );
}
