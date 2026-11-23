import Modal from "./Modal";

const sections = (phoneLayout: boolean) => [
  {
    title: "Workspace",
    shortcuts: [
      ["Alt / Option + B", "Open or close the board coordinate overlay"],
      ["Alt / Option + R", "Focus the rack"],
      ["Alt / Option + F", "Search games by opponent"],
      ["?", "Open this guide outside text fields"],
    ],
  },
  {
    title: "Board and rack",
    shortcuts: [
      ["Alt / Option + U", "Undo the last change"],
      ["Alt / Option + Y", "Redo the last undone change"],
      ["H6 / 6H", "Select a square and start typing across. Type a second digit after H1 for a two-digit row."],
      ["← / → or ↑ / ↓", "Adjust the column or row after typing the first part of a coordinate"],
      ["Enter", "Find moves from the board or rack"],
      ["Shift + Enter", "Switch board entry direction"],
      ["→ / ↓", "Switch board direction or advance the cursor"],
      ["Space", "Enter a blank tile"],
      [phoneLayout ? "↑ / ↓" : "← / →", "Move between rack tiles"],
      [phoneLayout ? "→" : "↓", "Cycle rack tile through normal, excluded, and required"],
      [phoneLayout ? "←" : "↑", "Mark or unmark a rack tile for exchange"],
      [phoneLayout ? "Shift + ↑ / ↓" : "Shift + ← / →", "Reorder a focused rack tile"],
    ],
  },
  {
    title: "Lists",
    shortcuts: [
      ["↑ / ↓", "Move through games in the game picker"],
      ["Enter", "Open the first game that matches your search"],
      ["P", "Pin or unpin the focused move preview"],
      ["Esc", "Close the game picker or shortcut guide"],
    ],
  },
];

export default function KeyboardShortcuts({ phoneLayout, onClose }: { phoneLayout: boolean; onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <div className="keyboard-shortcuts">
        {sections(phoneLayout).map(({ title, shortcuts }) => (
          <section key={title}>
            <h3>{title}</h3>
            <dl>
              {shortcuts.map(([keys, action]) => (
                <div key={action}>
                  <dt><kbd>{keys}</kbd></dt>
                  <dd>{action}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
