import Modal from "./Modal";

const sections = [
  {
    title: "Workspace",
    shortcuts: [
      ["Alt / Option + R", "Focus the rack"],
      ["Alt / Option + F", "Search games by opponent"],
      ["?", "Open this guide outside text fields"],
    ],
  },
  {
    title: "Board and rack",
    shortcuts: [
      ["Enter", "Find moves from the board or rack"],
      ["Shift + Enter", "Switch board entry direction"],
      ["→ / ↓", "Switch board direction or advance the cursor"],
      ["Space", "Enter a blank tile"],
      ["↓", "Cycle rack tile through normal, excluded, and required"],
      ["↑", "Mark or unmark a rack tile for exchange"],
      ["Shift + ← / →", "Reorder a focused rack tile"],
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

export default function KeyboardShortcuts({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <div className="keyboard-shortcuts">
        {sections.map(({ title, shortcuts }) => (
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
