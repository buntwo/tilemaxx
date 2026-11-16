import { useEffect, useState } from "react";
import Modal from "./Modal";

const storageKey = "tilemaxx:workspace-preferences";
const defaults = {
  highlightRackPreview: true,
  pulseMovePreviews: true,
  animatePlayedTiles: true,
  autoUpdate: true,
  singleComputeWorker: false,
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
    options: [["animatePlayedTiles", "Animate tiles when playing a move"]],
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
      highlightRackPreview: saved?.highlightRackPreview !== false,
      pulseMovePreviews: saved?.pulseMovePreviews !== false,
      animatePlayedTiles: saved?.animatePlayedTiles !== false,
      autoUpdate: saved?.autoUpdate !== false,
      singleComputeWorker: saved?.singleComputeWorker === true,
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
  preferences,
  concurrencyHint,
  workerLimit,
  onChange,
  onClose,
}: {
  preferences: Preferences;
  concurrencyHint: number | undefined;
  workerLimit: number;
  onChange: (preferences: Preferences) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Settings"
      subtitle="Applies to all games in this browser only."
      onClose={onClose}
    >
      <div className="workspace-preference-list">
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
          <label>
            <input
              type="checkbox"
              checked={preferences.singleComputeWorker}
              aria-describedby="compute-worker-scope"
              onChange={(event) =>
                onChange({
                  ...preferences,
                  singleComputeWorker: event.target.checked,
                })
              }
            />
            Limit to one compute worker
          </label>
          <p className="workspace-hardware-scope" id="compute-worker-scope">
            Applies to opponent reply histograms and automatic exact endgame
            lines.
          </p>
        </fieldset>
      </div>
    </Modal>
  );
}
