import { useId, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { defaultDictionary } from "../../shared/dictionaries";
import {
  emptyBoard,
  type BoardTemplate,
  type Dictionary,
  type Game,
} from "../../shared/model";
import { defaultPlatformBoard } from "../premium-palettes";
import { GameDetailFields, readGameDetails } from "./GameDetails";
import Modal from "./Modal";

export default function NewGameDialog({
  profileId,
  profileName,
  templates,
  dictionaries,
  currentDictionaryId,
  opponentSuggestions,
  phoneLayout,
  onCreate,
  onClose,
}: {
  profileId: string;
  profileName?: string;
  templates: readonly BoardTemplate[];
  dictionaries: readonly Dictionary[];
  currentDictionaryId?: string;
  opponentSuggestions: readonly string[];
  phoneLayout: boolean;
  onCreate: (
    game: Omit<Game, "id" | "revision" | "updatedAt">,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [templateId, setTemplateId] = useState("scrabble");
  const [dictionaryChoices, setDictionaryChoices] = useState<
    Partial<Record<"french" | "other", string>>
  >({});
  const [trackScores, setTrackScores] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const templateChosen = useRef(false);
  const submitting = useRef(false);
  const layoutLabelId = useId();
  const layoutHelpId = useId();
  const dictionaryLabelId = useId();
  const dictionaryHelpId = useId();
  const template = templates.find(({ id }) => id === templateId);
  const french = template?.rules === "scrabble-fr";
  const dictionaryGroup = french ? "french" : "other";
  const preferred = defaultDictionary(
    dictionaries,
    currentDictionaryId,
    template?.rules,
  );
  const chosen = dictionaryChoices[dictionaryGroup];
  const dictionaryId =
    dictionaries.find(({ id }) => id === chosen)?.id ?? preferred?.id ?? "";

  return (
    <Modal
      title="New game"
      className="new-game-modal"
      onClose={onClose}
      closeDisabled={busy}
    >
      <form
        aria-busy={busy}
        onSubmit={async (event) => {
          event.preventDefault();
          if (submitting.current) return;
          const details = readGameDetails(event.currentTarget);
          if (!template) {
            setError("That board template was deleted. Choose another board.");
            return;
          }
          if (!dictionaryId) return;
          submitting.current = true;
          setBusy(true);
          setError("");
          try {
            await onCreate({
              profileId,
              ...details,
              template,
              dictionaryId,
              board: emptyBoard(template.size),
              rack: "",
              past: [],
              future: [],
              archived: false,
              trackScores,
            });
          } catch (error) {
            setError((error as Error).message);
          } finally {
            submitting.current = false;
            setBusy(false);
          }
        }}
      >
        <div className="new-game-fields">
          <GameDetailFields
            opponentSuggestions={opponentSuggestions}
            initialFocus={!phoneLayout}
            collapseDetails
            onPlatformChange={(platform) => {
              const board = defaultPlatformBoard(platform);
              if (
                !templateChosen.current &&
                board &&
                templates.some(({ id }) => id === board)
              )
                setTemplateId(board);
            }}
          >
            <label>
              <span id={layoutLabelId}>Board layout</span>
              <small id={layoutHelpId} className="muted">
                Sets the game rules, board and rack sizes, tile bag counts, and
                scoring bonuses.
              </small>
              <select
                aria-labelledby={layoutLabelId}
                aria-describedby={layoutHelpId}
                value={templateId}
                onChange={(event) => {
                  templateChosen.current = true;
                  setTemplateId(event.currentTarget.value);
                }}
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} · {template.size} × {template.size}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span id={dictionaryLabelId}>Word list</span>
              <select
                aria-labelledby={dictionaryLabelId}
                aria-describedby={
                  french && !preferred ? dictionaryHelpId : undefined
                }
                required
                value={dictionaryId}
                onChange={(event) =>
                  setDictionaryChoices({
                    ...dictionaryChoices,
                    [dictionaryGroup]: event.currentTarget.value,
                  })
                }
              >
                {!dictionaryId && (
                  <option value="" disabled>
                    Choose a word list
                  </option>
                )}
                {dictionaries.map((dictionary) => (
                  <option key={dictionary.id} value={dictionary.id}>
                    {dictionary.name} · {dictionary.count.toLocaleString()}{" "}
                    words
                  </option>
                ))}
              </select>
              {french && !preferred && (
                <small id={dictionaryHelpId} className="muted">
                  Import Grammalecte under Word lists, or choose an installed
                  list for this game.
                </small>
              )}
            </label>
            <label className="score-checkbox">
              <input
                type="checkbox"
                checked={trackScores}
                onChange={(event) =>
                  setTrackScores(event.currentTarget.checked)
                }
              />
              Track scores
            </label>
          </GameDetailFields>
          <p className="small muted">
            Saved under {profileName}. Custom layouts are available in Board
            studio.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="modal-footer">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button primary" disabled={busy || !dictionaryId}>
            {busy ? "Creating…" : "Create game"}
            <ArrowRight size={16} />
          </button>
        </footer>
      </form>
    </Modal>
  );
}
