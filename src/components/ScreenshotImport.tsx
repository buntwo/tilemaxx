import { Fragment, useEffect, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, ScanLine } from "lucide-react";
import {
  type Board as BoardState,
  type BoardTemplate,
  type Premium,
  coordinate,
  emptyBoard,
  isWordfeudRules,
} from "../../shared/model";
import {
  type Crop,
  type Recognition,
  validateCrop,
} from "../../shared/screenshot";
import { acceptsScreenshot, isHeif } from "../../shared/heif";
import { convertHeif } from "../heif";
import { recognizeBoard } from "../recognize";
import { BoardInput } from "./BoardEntry";
import { saveScreenshotExample } from "../screenshot-example";
import { findBoard } from "../detect-board";
import Modal from "./Modal";
import ScreenshotPremiumReview from "./ScreenshotPremiumReview";
import { useGameCalculation } from "./GameCalculations";

export default function ScreenshotImport({
  template,
  onApply,
  onClose,
}: {
  template: BoardTemplate;
  onApply: (
    board: BoardState,
    premiums?: Premium[],
    clearBoard?: boolean,
  ) => void;
  onClose: () => void;
}) {
  const [detected, setDetected] = useState(false);
  const [source, setSource] = useState(""),
    [image, setImage] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>({
    left: 0,
    top: 0,
    width: 100,
    height: 100,
  });
  const [corner, setCorner] = useState<{ x: number; y: number } | null>(null);
  const [result, setResult] = useState<Recognition | null>(null),
    [selected, setSelected] = useState<number | null>(null);
  const [premiumMode, setPremiumMode] = useState(false);
  const [includePremiums, setIncludePremiums] = useState(false);
  const [clearBoard, setClearBoard] = useState(true);
  const [squares, setSquares] = useState<(Premium | null)[]>([]);
  const [layout, setLayout] = useState<"fixed" | "visible">("visible");
  const [selection, setSelection] = useState<{ index: number }>();
  const [exampleStatus, setExampleStatus] = useState("");
  const [savingExample, setSavingExample] = useState(false);
  const original = useRef<Recognition | null>(null);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  useGameCalculation(!!busy);
  const task = useRef<AbortController | null>(null),
    url = useRef(""),
    fileVersion = useRef(0);
  useEffect(
    () => () => {
      fileVersion.current++;
      task.current?.abort();
      URL.revokeObjectURL(url.current);
    },
    [],
  );
  function close() {
    task.current?.abort();
    onClose();
  }
  async function load(file?: File) {
    if (!file) return;
    task.current?.abort();
    setError("");
    setResult(null);
    setExampleStatus("");
    original.current = null;
    const version = ++fileVersion.current;
    if (!acceptsScreenshot(file)) {
      setError("Choose a PNG, JPEG, WebP, HEIF or HEIC image under 20 MB.");
      return;
    }
    const controller = new AbortController();
    task.current = controller;
    setBusy("Opening image…");
    let next = URL.createObjectURL(file);
    const img = new Image();
    try {
      img.src = next;
      try {
        await img.decode();
      } catch {
        if (!isHeif(file)) throw new Error("Could not open this image.");
        setBusy("Converting HEIF image…");
        const converted = await convertHeif(file, controller.signal);
        URL.revokeObjectURL(next);
        next = URL.createObjectURL(converted);
        img.src = next;
        await img.decode();
      }
      if (version !== fileVersion.current || controller.signal.aborted) {
        URL.revokeObjectURL(next);
        return;
      }
      if (img.naturalWidth * img.naturalHeight > 32_000_000)
        throw new Error(
          "This image is too large. Crop or resize it to under 32 megapixels.",
        );
      URL.revokeObjectURL(url.current);
      url.current = next;
      setSource(next);
      setImage(img);
      setCorner(null);
      const found = findBoard(img, template.size);
      setDetected(!!found);
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      setCrop(
        found || {
          left: 0,
          top: (img.naturalHeight - side) / 2,
          width: side,
          height: side,
        },
      );
    } catch (err) {
      URL.revokeObjectURL(next);
      if (version === fileVersion.current && !controller.signal.aborted)
        setError(
          (err as Error).message ||
            "Could not open this image. Try another screenshot.",
        );
    } finally {
      if (version === fileVersion.current) setBusy("");
    }
  }

  async function read() {
    if (!image) return;
    setError("");
    setCorner(null);
    try {
      validateCrop(
        crop,
        image.naturalWidth,
        image.naturalHeight,
        template.size,
      );
      const controller = new AbortController();
      task.current = controller;
      setBusy("Preparing the board…");
      const recognized = await recognizeBoard(
        image,
        crop,
        template.size,
        setBusy,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        startReview(recognized);
      }
    } catch (err) {
      if (!task.current?.signal.aborted)
        setError(
          (err as Error).message ||
            "Recognition failed. Try again with a tighter crop.",
        );
    } finally {
      setBusy("");
    }
  }
  function premiumSquares(recognized: Recognition, fixed: boolean) {
    const detection = recognized.premiums;
    if (!detection) return [...template.premiums];
    if (fixed && detection.fixed) return [...detection.fixed];
    return detection.squares.map((square, index) =>
      detection.style === "wordfeud" && index === template.start
        ? ""
        : recognized.board[index]
          ? null
          : square,
    );
  }
  function startReview(recognized: Recognition) {
    original.current = recognized;
    setResult(recognized);
    setPremiumMode(false);
    const detected = recognized.premiums;
    setIncludePremiums(!!detected);
    setClearBoard(true);
    setLayout(detected?.fixed ? "fixed" : "visible");
    setSquares(premiumSquares(recognized, !!detected?.fixed));
    setSelection({ index: recognized.uncertain[0] ?? template.start });
    setExampleStatus("");
  }
  function selectNextMarked(marked: number[]) {
    const next = marked.find((i) => i > (selected ?? -1)) ?? marked[0];
    if (next !== undefined) setSelection({ index: next });
  }
  function enterManually() {
    if (!image) return;
    try {
      validateCrop(
        crop,
        image.naturalWidth,
        image.naturalHeight,
        template.size,
      );
      setError("");
      startReview({
        board: emptyBoard(template.size),
        uncertain: [],
        candidates: 0,
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function saveExample() {
    if (!result || !original.current || !image) return;
    setSavingExample(true);
    setError("");
    setExampleStatus("");
    try {
      const { id } = await saveScreenshotExample(
        image,
        crop,
        template.size,
        original.current,
        result.board,
        includePremiums ? squares : undefined,
      );
      setExampleStatus(`Corrected example saved · ${id.slice(0, 8)}`);
    } catch (err) {
      setError(
        (err as Error).message || "Could not save the corrected example.",
      );
    } finally {
      setSavingExample(false);
    }
  }
  const squareWidth = crop.width / template.size;
  const squareHeight = crop.height / template.size;
  const selectedX =
    selected === null
      ? 0
      : crop.left + (selected % template.size) * squareWidth;
  const selectedY =
    selected === null
      ? 0
      : crop.top + Math.floor(selected / template.size) * squareHeight;
  return (
    <Modal
      title="Import a screenshot"
      subtitle="Choose a screenshot, then review the letters and premium squares."
      wide
      className="screenshot-modal"
      onClose={close}
    >
      {!result ? (
        <>
          <label className="screenshot-upload button secondary">
            <ImagePlus size={18} /> Choose screenshot
            <input
              aria-label="Screenshot file"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/heic,image/heif,image/heic-sequence,image/heif-sequence,.heic,.heif"
              disabled={!!busy}
              onChange={(e) => void load(e.target.files?.[0])}
            />
          </label>
          <p className="import-note">
            Recognition stays on this device. Use a straight-on screenshot with
            all {template.size} × {template.size} squares visible.
          </p>
          {image && (
            <>
              <p className="crop-instruction">
                {corner
                  ? "Now tap the board’s bottom-right corner."
                  : detected
                    ? "Board detected. Check the grid, then choose Read board. To adjust it, tap the top-left and bottom-right corners."
                    : "Couldn’t confidently find the board. Tap its top-left corner, then its bottom-right corner. Exclude coordinate labels and the rack."}
              </p>
              <div className="crop-stage">
                <div
                  className="crop-image"
                  onClick={(e) => {
                    if (busy) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const point = {
                      x: Math.max(
                        0,
                        Math.min(
                          image.naturalWidth,
                          ((e.clientX - rect.left) / rect.width) *
                            image.naturalWidth,
                        ),
                      ),
                      y: Math.max(
                        0,
                        Math.min(
                          image.naturalHeight,
                          ((e.clientY - rect.top) / rect.height) *
                            image.naturalHeight,
                        ),
                      ),
                    };
                    if (!corner) setCorner(point);
                    else {
                      if (point.x > corner.x && point.y > corner.y) {
                        setCrop({
                          left: corner.x,
                          top: corner.y,
                          width: point.x - corner.x,
                          height: point.y - corner.y,
                        });
                        setError("");
                      } else
                        setError(
                          "Choose the top-left corner first, then the bottom-right.",
                        );
                      setCorner(null);
                    }
                  }}
                >
                  <img
                    src={source}
                    alt="Screenshot to crop"
                    draggable={false}
                  />
                  <div
                    className="crop-grid"
                    aria-hidden="true"
                    style={{
                      left: `${(crop.left / image.naturalWidth) * 100}%`,
                      top: `${(crop.top / image.naturalHeight) * 100}%`,
                      width: `${(crop.width / image.naturalWidth) * 100}%`,
                      height: `${(crop.height / image.naturalHeight) * 100}%`,
                    }}
                  >
                    {Array.from({ length: template.size - 1 }, (_, index) => {
                      const position = `${((index + 1) * 100) / template.size}%`;
                      return (
                        <Fragment key={index}>
                          <span
                            className="crop-grid-column"
                            style={{ left: position }}
                          />
                          <span
                            className="crop-grid-row"
                            style={{ top: position }}
                          />
                        </Fragment>
                      );
                    })}
                  </div>
                  {corner && (
                    <span
                      className="crop-corner"
                      style={{
                        left: `${(corner.x / image.naturalWidth) * 100}%`,
                        top: `${(corner.y / image.naturalHeight) * 100}%`,
                      }}
                    />
                  )}
                </div>
              </div>
              <details className="crop-adjust">
                <summary>Fine-tune crop (pixels)</summary>
                <div className="crop-fields">
                  {(["left", "top", "width", "height"] as const).map((key) => (
                    <label key={key}>
                      {key}
                      <input
                        aria-label={`Crop ${key}`}
                        type="number"
                        min="0"
                        max={
                          key === "left" || key === "width"
                            ? image.naturalWidth
                            : image.naturalHeight
                        }
                        value={Math.round(crop[key])}
                        disabled={!!busy}
                        onChange={(e) =>
                          setCrop({ ...crop, [key]: Number(e.target.value) })
                        }
                      />
                    </label>
                  ))}
                </div>
              </details>
            </>
          )}
          <footer className="modal-footer">
            <button className="button secondary" onClick={close}>
              Cancel
            </button>
            {image && !busy && (
              <button
                className="button secondary"
                disabled={!!corner}
                onClick={enterManually}
              >
                Enter manually
              </button>
            )}
            <button
              className="button primary"
              disabled={!image || !!busy || !!corner}
              onClick={() => void read()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <ScanLine size={16} />
              )}{" "}
              {busy || "Read board"}
            </button>
          </footer>
        </>
      ) : (
        <>
          <p className="import-note">
            Compare the review board with the screenshot before saving. Check
            amber squares for letters or premiums that need review.
          </p>
          <label className="checkbox import-premiums-toggle">
            <input
              type="checkbox"
              checked={includePremiums}
              onChange={(e) => {
                setIncludePremiums(e.target.checked);
                if (!e.target.checked) setPremiumMode(false);
              }}
            />
            Import premium squares
          </label>
          {includePremiums && (
            <label className="checkbox import-clear-board">
              <input
                type="checkbox"
                checked={clearBoard}
                onChange={(event) => setClearBoard(event.target.checked)}
              />
              Clear board and start score tracking
            </label>
          )}
          {includePremiums &&
            result.premiums?.style === "wordfeud" &&
            !isWordfeudRules(template.rules) && (
              <p className="import-note">
                For Wordfeud tile values and play bonuses, import into a
                Wordfeud game.
              </p>
            )}
          {includePremiums &&
            result.premiums?.style === "scrabble-go" &&
            template.rules !== "scrabble" && (
              <p className="import-note">
                For Scrabble GO tile values and play bonuses, import into a
                Scrabble game.
              </p>
            )}
          {includePremiums && result.premiums?.fixed && (
            <label className="import-layout-choice">
              Layout source
              <select
                value={layout}
                onChange={(e) => {
                  const fixed = e.target.value === "fixed";
                  setLayout(fixed ? "fixed" : "visible");
                  setSquares(premiumSquares(result, fixed));
                }}
              >
                <option value="fixed">
                  {result.premiums.style === "wordfeud"
                    ? "Fixed Wordfeud layout"
                    : "Classic Scrabble layout"}
                </option>
                <option value="visible">Visible squares only</option>
              </select>
            </label>
          )}
          {includePremiums && (
            <div className="import-review-modes" aria-label="Review mode">
              <button
                type="button"
                className="button secondary"
                aria-pressed={!premiumMode}
                onClick={() => {
                  setPremiumMode(false);
                  if (selected !== null) setSelection({ index: selected });
                }}
              >
                Letters
              </button>
              <button
                type="button"
                className="button secondary"
                aria-pressed={premiumMode}
                onClick={() => setPremiumMode(true)}
              >
                Premium squares
              </button>
            </div>
          )}
          <div className="import-review">
            <div className="import-original">
              <span className="field-label">Screenshot</span>
              <svg
                viewBox={`${crop.left} ${crop.top} ${crop.width} ${crop.height}`}
                aria-label="Original board crop"
              >
                <image
                  href={source}
                  width={image!.naturalWidth}
                  height={image!.naturalHeight}
                />
                {selected !== null && (
                  <rect
                    className="import-source-highlight"
                    x={selectedX}
                    y={selectedY}
                    width={squareWidth}
                    height={squareHeight}
                  />
                )}
              </svg>
            </div>
            <div>
              <div className="import-review-heading">
                <span className="field-label">Review board</span>
                {selected !== null && (
                  <div className="import-tile-preview">
                    <span>{coordinate(selected, template.size)}</span>
                    <svg
                      viewBox={`${selectedX} ${selectedY} ${squareWidth} ${squareHeight}`}
                      aria-label={`Screenshot tile ${coordinate(selected, template.size)}`}
                    >
                      <image
                        href={source}
                        width={image!.naturalWidth}
                        height={image!.naturalHeight}
                      />
                    </svg>
                  </div>
                )}
              </div>
              {premiumMode ? (
                <ScreenshotPremiumReview
                  key={layout}
                  template={template}
                  board={result.board}
                  squares={squares}
                  style={result.premiums?.style}
                  onChange={(next) => {
                    setSquares(next);
                    setExampleStatus("");
                  }}
                  onSelect={setSelected}
                />
              ) : (
                <>
                  <BoardInput
                    template={
                      includePremiums
                        ? {
                            ...template,
                            premiums: squares.map((square) => square ?? ""),
                          }
                        : template
                    }
                    board={result.board}
                    selection={selection}
                    uncertain={new Set(result.uncertain)}
                    onCursorChange={setSelected}
                    inputLabel="Correct letters on review board"
                    onChange={(board) => {
                      if (result.premiums && layout === "visible") {
                        setSquares(
                          squares.map((premium, i) =>
                            Boolean(board[i]) !== Boolean(result.board[i]) &&
                            i !== template.start
                              ? board[i]
                                ? null
                                : result.premiums!.squares[i]
                              : premium,
                          ),
                        );
                      }
                      setResult({
                        ...result,
                        board,
                        uncertain: result.uncertain.filter(
                          (i) => board[i] === result.board[i],
                        ),
                      });
                      setExampleStatus("");
                    }}
                  />
                  <div className="uncertain-squares">
                    {!!result.uncertain.length && (
                      <>
                        <button
                          className="button secondary"
                          onClick={() => selectNextMarked(result.uncertain)}
                        >
                          Next marked square
                        </button>
                        <button
                          className="button secondary"
                          disabled={
                            selected === null ||
                            !result.uncertain.includes(selected)
                          }
                          onClick={() => {
                            const uncertain = result.uncertain.filter(
                              (i) => i !== selected,
                            );
                            setResult({ ...result, uncertain });
                            selectNextMarked(uncertain);
                          }}
                        >
                          Confirm square
                        </button>
                        <span role="status">
                          {result.uncertain.length} marked
                        </span>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="import-example">
            <button
              className="button secondary"
              onClick={() => void saveExample()}
              disabled={savingExample}
            >
              {savingExample ? "Saving example…" : "Save corrected example"}
            </button>
            <p className="import-note">
              Saves the cropped screenshot and your review on your Tilemaxx
              server for improving recognition.
            </p>
            {exampleStatus && <p role="status">{exampleStatus}</p>}
          </div>
          <p className="import-note">
            {includePremiums && squares.includes(null)
              ? "Unknown squares use plain scoring. You can undo the import."
              : "You can undo the import."}
          </p>
          <footer className="modal-footer">
            <button
              className="button secondary"
              onClick={() => {
                setResult(null);
                setError("");
              }}
            >
              Back to crop
            </button>
            <button
              className="button primary"
              onClick={() => {
                try {
                  if (includePremiums)
                    onApply(
                      result.board,
                      squares.map((square) => square ?? ""),
                      clearBoard,
                    );
                  else onApply(result.board);
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              Use this board
            </button>
          </footer>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
