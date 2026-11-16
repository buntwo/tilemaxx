import { useEffect, useState } from "react";
import Modal from "./Modal";

const storageKey = "tilemaxx:workspace-preferences";
const defaults = {
  highlightRackPreview: true,
  pulseMovePreviews: true,
  animatePlayedTiles: true,
  autoUpdate: true,
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
  onChange,
  onClose,
}: {
  preferences: Preferences;
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
      </div>
    </Modal>
  );
}
