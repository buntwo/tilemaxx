import { useState, type ReactNode } from "react";
import { ArrowLeft, LockKeyhole, Pencil, Plus, Trash2 } from "lucide-react";
import { additionalPlayBonuses, type BoardTemplate } from "../../shared/model";
import BoardEditor from "./BoardEditor";
import Modal from "./Modal";
import LayoutThumbnail from "./LayoutThumbnail";

export default function BoardStudio({
  templates,
  headerControl,
  templateId,
  onEdit,
  onCloseEditor,
  onSave,
  onDelete,
  onBack,
}: {
  templates: BoardTemplate[];
  headerControl?: ReactNode;
  templateId?: string;
  onEdit: (id: string) => void;
  onCloseEditor: () => void;
  onSave: (template: BoardTemplate, editing: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onBack: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<BoardTemplate | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const editing = templates.find((template) => !template.builtin && template.id === templateId);
  if (editing || creating)
    return (
      <BoardEditor
        templates={templates}
        key={editing?.id ?? "new"}
        headerControl={headerControl}
        initial={editing}
        onClose={editing ? onCloseEditor : () => setCreating(false)}
        onSave={async (draft) => {
          await onSave(draft, !!editing);
          if (editing) onCloseEditor();
          else setCreating(false);
        }}
      />
    );
  const custom = templates.filter((template) => !template.builtin);
  return (
    <section className="studio-view" aria-labelledby="studio-heading">
      <div className="workspace-heading studio-heading">
        <div className="game-title-row">
          {headerControl}
          <h1 id="studio-heading">Board studio</h1>
        </div>
        <button className="button secondary archive-back" onClick={onBack}>
          <ArrowLeft size={16} /> Back to games
        </button>
      </div>
      {templateId && <p role="status">This board template is unavailable.</p>}
      <div className="panel studio-panel">
        <div className="studio-section-title">CUSTOM BOARDS</div>
        {custom.length ? (
          <div className="studio-list">
            {custom.map((template) => (
              <div className="studio-item" key={template.id}>
                <LayoutThumbnail template={template} />
                <div>
                  <strong>{template.name}</strong>
                  <small>
                    {template.size} × {template.size} · {template.rackSize}{" "}
                    tiles ·{" "}
                    {[
                      ...Object.entries(additionalPlayBonuses(template)),
                      [template.rackSize, template.bingo],
                    ]
                      .map(([tiles, points]) => `+${points} for ${tiles}`)
                      .join(" · ")}
                  </small>
                </div>
                <button
                  className="button secondary"
                  aria-label={`Edit ${template.name}`}
                  onClick={() => onEdit(template.id)}
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
                <LayoutThumbnail template={template} />
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
        <footer className="studio-footer">
          <button className="button primary" onClick={() => setCreating(true)}>
            <Plus size={16} />
            New custom board
          </button>
        </footer>
      </div>
      {deleting && (
        <Modal
          title="Delete this board?"
          subtitle={deleting.name}
          onClose={() => {
            if (!busy) setDeleting(null);
          }}
        >
          <p>
            This removes the custom board from Board studio on all devices.
            Existing games keep their saved layout. Deleting this template
            cannot be undone.
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
      )}
    </section>
  );
}
