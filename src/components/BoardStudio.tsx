import { useState } from "react";
import { Grid2X2, LockKeyhole, Pencil, Plus, Trash2 } from "lucide-react";
import type { BoardTemplate } from "../../shared/model";
import BoardEditor from "./BoardEditor";
import Modal from "./Modal";

export default function BoardStudio({
  templates,
  onSave,
  onDelete,
  onClose,
}: {
  templates: BoardTemplate[];
  onSave: (template: BoardTemplate, editing: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  // undefined is the library; null creates a new board.
  const [editing, setEditing] = useState<BoardTemplate | null | undefined>();
  const [deleting, setDeleting] = useState<BoardTemplate | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (deleting)
    return (
      <Modal
        title="Delete this board?"
        subtitle={deleting.name}
        onClose={() => {
          if (!busy) setDeleting(null);
        }}
      >
        <p>
          This removes the custom board from Board studio on all devices.
          Existing games keep their saved layout. Deleting this template cannot
          be undone.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer className="modal-footer">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => setDeleting(null)}
          >
            Keep board
          </button>
          <button
            className="button danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onDelete(deleting.id);
                setDeleting(null);
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Deleting…" : "Delete permanently"}
          </button>
        </footer>
      </Modal>
    );
  if (editing !== undefined)
    return (
      <BoardEditor
        templates={templates}
        initial={editing || undefined}
        onClose={() => setEditing(undefined)}
        onSave={async (draft) => {
          await onSave(draft, !!editing);
          setEditing(undefined);
        }}
      />
    );
  const custom = templates.filter((template) => !template.builtin);
  return (
    <Modal
      title="Board studio"
      subtitle="Your saved layouts, ready for the next game."
      onClose={onClose}
    >
      <div className="studio-section-title">CUSTOM BOARDS</div>
      {custom.length ? (
        <div className="studio-list">
          {custom.map((template) => (
            <div className="studio-item" key={template.id}>
              <Grid2X2 size={20} />
              <div>
                <strong>{template.name}</strong>
                <small>
                  {template.size} × {template.size} · {template.rackSize} tiles
                  · {template.bingo}-point bonus
                </small>
              </div>
              <button
                className="button secondary"
                aria-label={`Edit ${template.name}`}
                onClick={() => setEditing(template)}
              >
                <Pencil size={14} />
                Edit
              </button>
              <button
                className="icon-button"
                aria-label={`Delete ${template.name}`}
                title={`Delete ${template.name}`}
                onClick={() => {
                  setDeleting(template);
                  setError("");
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="studio-empty">
          Create your first custom board from a preset, then make it your own.
        </p>
      )}
      <div className="studio-section-title">BUILT-IN BOARDS</div>
      <div className="studio-list">
        {templates
          .filter((template) => template.builtin)
          .map((template) => (
            <div className="studio-item" key={template.id}>
              <Grid2X2 size={20} />
              <div>
                <strong>{template.name}</strong>
                <small>
                  {template.size} × {template.size}
                </small>
              </div>
              <span className="studio-readonly">
                <LockKeyhole size={13} />
                Read-only
              </span>
            </div>
          ))}
      </div>
      <footer className="modal-footer">
        <button className="button primary" onClick={() => setEditing(null)}>
          <Plus size={16} />
          New custom board
        </button>
      </footer>
    </Modal>
  );
}
