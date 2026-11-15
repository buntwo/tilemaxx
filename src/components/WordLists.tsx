import { useState } from "react";
import { BookOpen, Check, Trash2, Upload } from "lucide-react";
import type { Dictionary } from "../../shared/model";
import { store } from "../store";
import Modal from "./Modal";

export default function WordLists({
  dictionaries,
  selectedId,
  onClose,
  onNotify,
}: {
  dictionaries: Dictionary[];
  selectedId?: string;
  onClose: () => void;
  onNotify: (message: string) => void;
}) {
  const [deleting, setDeleting] = useState<Dictionary>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const errorNotice = error && (
    <p className="error" role="alert">
      {error}
    </p>
  );

  if (deleting) {
    function keepList() {
      if (busy) return;
      setDeleting(undefined);
      setError("");
    }
    return (
      <Modal
        key="remove"
        title="Remove this word list?"
        subtitle={deleting.name}
        onClose={keepList}
      >
        <p>
          This permanently removes the list on all devices. Move review will be
          unavailable for turns recorded with this list.
        </p>
        {errorNotice}
        <footer className="modal-footer">
          <button
            type="button"
            className="button secondary"
            data-initial-focus
            disabled={busy}
            onClick={keepList}
          >
            Keep word list
          </button>
          <button
            type="button"
            className="button danger"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await store.deleteDictionary(deleting.id);
                setDeleting(undefined);
                onNotify(`${deleting.name} removed.`);
              })
            }
          >
            {busy ? "Removing…" : "Remove word list"}
          </button>
        </footer>
      </Modal>
    );
  }

  return (
    <Modal
      key="lists"
      title="Word lists"
      subtitle="Choose a dictionary per game. Imported lists are available on all your devices."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="dictionary-list">
        {dictionaries.map((dictionary) => (
          <div key={dictionary.id}>
            <span className="dictionary-icon">
              <BookOpen size={20} aria-hidden="true" />
            </span>
            <div>
              <strong>
                {dictionary.name}
                <span className="small muted">
                  {dictionary.count.toLocaleString()} words
                </span>
              </strong>
              <p>{dictionary.description}</p>
            </div>
            {selectedId === dictionary.id && (
              <Check size={18} role="img" aria-label="Selected for this game" />
            )}
            {!dictionary.builtin && (
              <button
                type="button"
                className="icon-button dictionary-remove"
                title={`Remove ${dictionary.name}`}
                aria-label={`Remove ${dictionary.name}`}
                disabled={busy}
                onClick={() => {
                  setError("");
                  setDeleting(dictionary);
                }}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="import-box">
        <h3>Bring your own word list</h3>
        <p>
          A .txt file with one English word per line. You can import NWL, other
          Collins editions, or your own house dictionary.
        </p>
        <label
          className={`button secondary file-button ${busy ? "disabled" : ""}`}
        >
          <Upload size={16} aria-hidden="true" />
          {busy ? "Importing…" : "Import word list"}
          <input
            type="file"
            accept=".txt,text/plain"
            disabled={busy}
            aria-label="Import word list"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void run(async () => {
                if (file.size > 12_000_000)
                  throw new Error(
                    "Please choose a text file smaller than 12 MB.",
                  );
                const dictionary = await store.importDictionary(
                  file.name.replace(/\.txt$/i, ""),
                  await file.text(),
                );
                onNotify(
                  `${dictionary.name} imported: ${dictionary.count.toLocaleString()} words.`,
                );
              });
              event.target.value = "";
            }}
          />
        </label>
        {errorNotice}
      </div>
      <p className="small muted">
        ENABLE and Wordnik are open word-game lists. Their contents differ from
        official tournament lists and the current Words With Friends dictionary.
      </p>
    </Modal>
  );
}
