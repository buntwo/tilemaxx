import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CircleCheck, CircleX, Upload } from "lucide-react";
import { definitionTileKey } from "../../shared/definitions";
import { dictionaryDefinitionLanguage } from "../../shared/dictionaries";
import type { Dictionary } from "../../shared/model";
import type {
  WordListCheckReply,
  WordListCheckRequest,
  WordListSource,
} from "../word-list-checker.worker";
import { DefinitionResults } from "./DefinitionTooltip";
import Modal from "./Modal";

type Check = {
  source: WordListSource;
  word: string;
  result: "checking" | "found" | "missing" | { error: string };
};

export default function WordListChecker({
  dictionaries,
  selectedId,
  onSelectList,
  onClose,
}: {
  dictionaries: Dictionary[];
  selectedId?: string;
  onSelectList: (id: string) => void;
  onClose: () => void;
}) {
  const [usingFile, setUsingFile] = useState(false);
  const [file, setFile] = useState<File>();
  const [input, setInput] = useState("");
  const [check, setCheck] = useState<Check>();
  const worker = useRef<{ source: WordListSource; instance: Worker }>(null);
  const requestId = useRef(0);
  useEffect(() => setUsingFile(false), [selectedId]);
  const dictionary =
    dictionaries.find(({ id }) => id === selectedId) ??
    dictionaries[0];
  const local = usingFile ? file : undefined;
  const source = local ?? dictionary?.id;
  const listName = local?.name ?? dictionary?.name;
  const current = check?.source === source ? check : undefined;
  const result = current?.result;
  const language = !local && dictionary ? dictionaryDefinitionLanguage(dictionary) : undefined;
  const definitionWords = useMemo(() => {
    if (current?.result === "found") return [{ word: current.word }];
  }, [current]);

  useEffect(() => () => worker.current?.instance.terminate(), []);

  function clearCheck() {
    requestId.current++;
    setCheck(undefined);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!source || result === "checking") return;
    const word = (language ? definitionTileKey(input) ?? "" : input.trim()).toUpperCase();
    if (!/^[A-Z]{2,25}$/.test(word)) {
      setCheck({
        source,
        word,
        result: { error: language ? "Enter one word with 2–25 letters." : "Enter one word with 2–25 letters from A to Z." },
      });
      return;
    }
    const id = ++requestId.current;
    setCheck({ source, word, result: "checking" });
    let instance: Worker | undefined;
    const fail = () => {
      if (instance && worker.current?.instance === instance) {
        instance.terminate();
        worker.current = null;
      }
      if (id === requestId.current)
        setCheck({
          source,
          word,
          result: {
            error: "Could not start the word list checker. Try again.",
          },
        });
    };
    try {
      if (worker.current?.source !== source) {
        worker.current?.instance.terminate();
        worker.current = null;
        worker.current = {
          source,
          instance: new Worker(
            new URL("../word-list-checker.worker.ts", import.meta.url),
            { type: "module" },
          ),
        };
      }
      instance = worker.current.instance;
      instance.onmessage = ({ data }: MessageEvent<WordListCheckReply>) => {
        if (id !== requestId.current || data.id !== id) return;
        setCheck({
          source,
          word,
          result:
            "error" in data
              ? { error: data.error }
              : data.found
                ? "found"
                : "missing",
        });
      };
      instance.onerror = fail;
      instance.postMessage({ id, word, source } satisfies WordListCheckRequest);
    } catch {
      fail();
    }
  }

  return (
    <Modal
      title="Word list checker"
      className="word-list-checker"
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="word-list-checker-source">
          <label>
            Word list
            <select
              value={local ? "" : (dictionary?.id ?? "")}
              disabled={!source}
              onChange={(event) => {
                const id = event.target.value;
                setUsingFile(!id);
                if (id) onSelectList(id);
                clearCheck();
              }}
            >
              {!source && <option value="">No word lists available</option>}
              {dictionaries.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
              {file && <option value="">{file.name} (local file)</option>}
            </select>
          </label>
          <label className="button secondary file-button">
            <Upload size={16} aria-hidden="true" /> Open text file
            <input
              type="file"
              accept=".txt,text/plain"
              aria-label="Open word list file"
              onChange={(event) => {
                const next = event.currentTarget.files?.[0];
                if (!next) return;
                setFile(next);
                setUsingFile(true);
                clearCheck();
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>
        <div className="word-list-checker-query">
          <label>
            Word
            <input
              type="text"
              value={input}
              data-initial-focus
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              onChange={(event) => {
                setInput(event.target.value);
                clearCheck();
              }}
            />
          </label>
          <button
            className="button primary"
            type="submit"
            disabled={!source || !input.trim() || result === "checking"}
          >
            Check word
          </button>
        </div>
        <div className="word-list-checker-result" role="status">
          {result === "checking" && (
            <span className="muted">Checking {listName}…</span>
          )}
          {current && result === "found" && (
            <span className="value-good">
              <CircleCheck size={17} aria-hidden="true" />{" "}
              <strong>{current.word}</strong> is in {listName}.
            </span>
          )}
          {current && result === "missing" && (
            <span className="value-bad">
              <CircleX size={17} aria-hidden="true" />{" "}
              <strong>{current.word}</strong> is absent from {listName}.
            </span>
          )}
          {typeof result === "object" && (
            <span className="error">{result.error}</span>
          )}
        </div>
      </form>
      {language && (
        <div className="word-definition-result" aria-live="polite">
          <DefinitionResults language={language} words={definitionWords} onlyAvailable />
        </div>
      )}
    </Modal>
  );
}
