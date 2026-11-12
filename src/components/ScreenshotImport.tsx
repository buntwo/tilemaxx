import { useEffect, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, ScanLine } from "lucide-react";
import {
  type Board as BoardState,
  type BoardTemplate,
  coordinate,
} from "../../shared/model";
import {
  type Crop,
  type Recognition,
  validateCrop,
} from "../../shared/screenshot";
import { recognizeBoard } from "../recognize";
import Board from "./Board";
import Modal from "./Modal";

export default function ScreenshotImport({
  template,
  onApply,
  onClose,
}: {
  template: BoardTemplate;
  onApply: (board: BoardState) => void;
  onClose: () => void;
}) {
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
    [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
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
    setBusy("");
    if (
      !/^image\/(png|jpeg|webp)$/.test(file.type) ||
      file.size > 20 * 1024 * 1024
    ) {
      setError("Choose a PNG, JPEG or WebP screenshot under 20 MB.");
      return;
    }
    const version = ++fileVersion.current,
      next = URL.createObjectURL(file),
      img = new Image();
    try {
      img.src = next;
      await img.decode();
      if (version !== fileVersion.current) {
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
      // Start with a square centered in the screenshot; the user marks exact edges.
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      setCrop({
        left: 0,
        top: (img.naturalHeight - side) / 2,
        width: side,
        height: side,
      });
    } catch (err) {
      URL.revokeObjectURL(next);
      if (version === fileVersion.current)
        setError(
          (err as Error).message.includes("too large")
            ? (err as Error).message
            : "Could not open this image. Try a PNG or JPEG screenshot.",
        );
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
        setResult(recognized);
        setSelected(recognized.uncertain[0] ?? 0);
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
  function changeTile(letter: string) {
    if (!result) return;
    const board = [...result.board];
    board[selected] = letter;
    setResult({
      ...result,
      board,
      uncertain: result.uncertain.filter((i) => i !== selected),
    });
  }
  return (
    <Modal
      title="Import a screenshot"
      subtitle="Choose a Scrabble GO screenshot, frame the board, then review the letters."
      wide
      onClose={close}
    >
      {!result ? (
        <>
          <label className="screenshot-upload button secondary">
            <ImagePlus size={18} /> Choose screenshot
            <input
              aria-label="Screenshot file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
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
                  : "Tap the board’s top-left corner, then its bottom-right corner. Exclude coordinate labels and the rack."}
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
                    style={{
                      left: `${(crop.left / image.naturalWidth) * 100}%`,
                      top: `${(crop.top / image.naturalHeight) * 100}%`,
                      width: `${(crop.width / image.naturalWidth) * 100}%`,
                      height: `${(crop.height / image.naturalHeight) * 100}%`,
                      backgroundSize: `${100 / template.size}% ${100 / template.size}%`,
                    }}
                  />
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
          <p className="import-note" role="status">
            Found {result.board.filter(Boolean).length} letters.{" "}
            {result.uncertain.length
              ? `${result.uncertain.length} squares need a closer look.`
              : "Check every row against the screenshot."}{" "}
            Empty squares can also be missed. Mark any assigned blanks manually.
          </p>
          <div className="import-review">
            <div className="import-original">
              <span className="field-label">SCREENSHOT</span>
              <svg
                viewBox={`${crop.left} ${crop.top} ${crop.width} ${crop.height}`}
                aria-label="Original board crop"
              >
                <image
                  href={source}
                  width={image!.naturalWidth}
                  height={image!.naturalHeight}
                />
              </svg>
            </div>
            <div>
              <span className="field-label">
                RECOGNIZED BOARD · TAP TO CORRECT
              </span>
              <Board
                template={template}
                board={result.board}
                selected={selected}
                onSelect={setSelected}
              />
            </div>
          </div>
          {!!result.uncertain.length && (
            <div className="uncertain-squares">
              <span>Check:</span>
              {result.uncertain.map((i) => (
                <button
                  key={i}
                  className="button secondary small"
                  onClick={() => setSelected(i)}
                >
                  {coordinate(i, template.size)}
                </button>
              ))}
            </div>
          )}
          <div className="import-correction">
            <label>
              Letter at {coordinate(selected, template.size)}
              <input
                aria-label="Recognized tile letter"
                maxLength={1}
                autoComplete="off"
                autoCapitalize="characters"
                value={result.board[selected].toUpperCase()}
                onChange={(e) =>
                  changeTile(
                    e.target.value.replace(/[^a-z]/gi, "").toUpperCase(),
                  )
                }
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={
                  !!result.board[selected] &&
                  result.board[selected] ===
                    result.board[selected].toLowerCase()
                }
                disabled={!result.board[selected]}
                onChange={(e) =>
                  changeTile(
                    e.target.checked
                      ? result.board[selected].toLowerCase()
                      : result.board[selected].toUpperCase(),
                  )
                }
              />
              Assigned blank (0 points)
            </label>
            <button className="button secondary" onClick={() => changeTile("")}>
              Clear square
            </button>
          </div>
          <p className="import-note">
            Replace the current board with this reviewed layout. Your rack stays
            as it is. You can undo the import.
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
                  onApply(result.board);
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
