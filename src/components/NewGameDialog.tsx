import { useId, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { defaultDictionary } from "../../shared/dictionaries";
import {
  emptyBoard,
  type BoardTemplate,
  type Dictionary,
  type Game,
} from "../../shared/model";
import {
  boardLanguages,
  templateForLanguage,
  type GameLanguage,
} from "../../shared/presets";
import { defaultPlatformBoard } from "../premium-palettes";
import { GameDetailFields, readGameDetails } from "./GameDetails";
import Modal from "./Modal";

const wordListsByLanguage: Record<GameLanguage, string> = {
  en: "an English word list",
  "en-US": "a US English word list",
  "en-GB": "a UK English word list",
  fr: "Grammalecte or a French word list",
  it: "an Italian word list",
};

export default function NewGameDialog({
  profileId,
  profileName,
  templates,
  dictionaries,
  currentDictionaryId,
  opponentSuggestions,
  phoneLayout,
  online,
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
  online: boolean;
  onCreate: (
    game: Omit<Game, "id" | "revision" | "updatedAt">,
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [templateId, setTemplateId] = useState("scrabble");
  const [languageChoices, setLanguageChoices] = useState<
    Partial<Record<string, GameLanguage>>
  >({});
  const [dictionaryChoices, setDictionaryChoices] = useState<
    Partial<Record<string, string>>
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
  const boardLayout = templates.find(({ id }) => id === templateId);
  const languages = boardLanguages.get(templateId);
  const language = languageChoices[templateId] ?? languages?.[0].id;
  const template =
    boardLayout && language
      ? templateForLanguage(boardLayout, language)
      : boardLayout;
  const french =
    template?.rules === "scrabble-fr" || template?.rules === "wordfeud-fr";
  const dictionaryGroup = language
    ? `${templateId}:${language}`
    : french
      ? template.rules
      : "other";
  const preferred = defaultDictionary(
    dictionaries,
    currentDictionaryId,
    template?.rules,
    language,
  );
  const missingWordList =
    !preferred &&
    (language ? wordListsByLanguage[language] : french && "Grammalecte");
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
          if (submitting.current || !online) return;
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
            {languages && (
              <label>
                Language
                <select
                  value={language}
                  onChange={(event) =>
                    setLanguageChoices({
                      ...languageChoices,
                      [templateId]: event.currentTarget.value as GameLanguage,
                    })
                  }
                >
                  {languages.map(({ id, label }) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <span id={dictionaryLabelId}>Word list</span>
              <select
                aria-labelledby={dictionaryLabelId}
                aria-describedby={
                  missingWordList ? dictionaryHelpId : undefined
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
              {missingWordList && (
                <small id={dictionaryHelpId} className="muted">
                  Import {missingWordList} under Word lists, or choose an
                  installed list for this game.
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
          {!online && <p className="small muted">Connect to the server to create a game.</p>}
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
          <button className="button primary" disabled={busy || !online || !dictionaryId}>
            {busy ? "Creating…" : "Create game"}
            <ArrowRight size={16} />
          </button>
        </footer>
      </form>
    </Modal>
  );
}
