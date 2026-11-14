import { useEffect, useMemo, useRef, useState } from "react";
import {
  openingSequences,
  type PremiumInference,
} from "../../shared/infer-premiums";
import {
  coordinate,
  type Board as BoardState,
  type BoardTemplate,
  type Premium,
} from "../../shared/model";
import type { InferenceRequest } from "../screenshot-inference.worker";
import Board from "./Board";

export default function ScreenshotPremiumReview({
  board,
  template,
  squares,
  style,
  onChange,
  onSelect,
}: {
  board: BoardState;
  template: BoardTemplate;
  squares: (Premium | null)[];
  style?: "wordfeud" | "scrabble-go";
  onChange: (squares: (Premium | null)[]) => void;
  onSelect: (index: number) => void;
}) {
  const [selected, setSelected] = useState(template.start);
  const [brush, setBrush] = useState<Premium | null>("DL");
  const [sequence, setSequence] = useState("0");
  const [scores, setScores] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const worker = useRef<Worker>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => () => worker.current?.terminate(), []);
  const unknown = squares.filter((square) => square === null).length;
  const histories = useMemo(
    () =>
      style === "wordfeud" && template.rules === "wordfeud"
        ? openingSequences(board, template)
        : [],
    [board, template, style],
  );
  const turns = histories[Number(sequence)];
  const points = scores.map((score) => (score === "" ? null : Number(score)));
  const validScores =
    points.some((score) => score !== null) &&
    points.every(
      (score) => score === null || (Number.isSafeInteger(score) && score >= 0),
    );
  function resetCheck() {
    worker.current?.terminate();
    worker.current = null;
    setChecking(false);
    setStatus("");
  }
  function infer() {
    if (!turns) return;
    resetCheck();
    const task = new Worker(
      new URL("../screenshot-inference.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = task;
    setChecking(true);
    function finish() {
      task.terminate();
      worker.current = null;
      setChecking(false);
    }
    task.onmessage = ({ data }: MessageEvent<PremiumInference>) => {
      if (worker.current !== task) return;
      finish();
      if (!data.matches) {
        setStatus(
          "These scores don’t match any layout. Check the letters, blanks, and play order.",
        );
        return;
      }
      if (!data.certain.length) {
        setStatus(
          "The scores fit multiple layouts and don’t identify any covered square.",
        );
        return;
      }
      const next = [...squares];
      for (const [index, premium] of data.certain) next[index] = premium;
      onChange(next);
      setStatus(
        `Identified ${data.certain.length} square${data.certain.length === 1 ? "" : "s"} from the scores.`,
      );
    };
    task.onerror = () => {
      if (worker.current !== task) return;
      finish();
      setStatus(
        "Couldn’t check the scores. Try again or mark the squares manually.",
      );
    };
    task.postMessage([
      template,
      turns,
      squares,
      points,
    ] satisfies InferenceRequest);
  }
  return (
    <>
      <div className="import-premium-tools">
        <div className="paint-palette" aria-label="Premium square tools">
          {(["", "DL", "TL", "DW", "TW", "QL", "QW", null] as const).map(
            (premium) => (
              <button
                type="button"
                key={premium ?? "unknown"}
                className={`brush ${premium?.toLowerCase() ?? ""} ${brush === premium ? "active" : ""}`}
                aria-pressed={brush === premium}
                onClick={() => setBrush(premium)}
              >
                {premium === null ? "Unknown" : premium || "Plain"}
              </button>
            ),
          )}
        </div>
        <p className="import-note">
          Choose a premium, then select the square you want to change.
        </p>
      </div>
      <Board
        template={{
          ...template,
          premiums: squares.map((square) => square ?? ""),
        }}
        board={board.map(() => "")}
        paint
        selected={selected}
        uncertain={
          new Set(squares.flatMap((square, i) => (square === null ? [i] : [])))
        }
        cellOverlay={(i) =>
          squares[i] === null
            ? { style: {}, label: "unknown premium" }
            : undefined
        }
        onSelect={(i) => {
          resetCheck();
          setSelected(i);
          onSelect(i);
          const next = [...squares];
          next[i] = brush;
          onChange(next);
        }}
      />
      {unknown > 0 && (
        <p className="import-note">
          {unknown} unknown. Any unknown squares use plain scoring when
          imported.
        </p>
      )}
      {turns && (unknown > 0 || status) && (
        <details className="import-inference">
          <summary>Use opening play scores</summary>
          <p className="import-note">
            Choose the order played and enter the total points from either or
            both turns. Only squares determined by those scores are filled in.
          </p>
          {histories.length > 1 && (
            <label>
              Play order
              <select
                value={sequence}
                onChange={(event) => {
                  resetCheck();
                  setSequence(event.target.value);
                  setScores([]);
                }}
              >
                {histories.map((history, i) => (
                  <option key={i} value={i}>
                    {history
                      .map(
                        ({ word, direction, start }) =>
                          `${word} (${coordinate(start, template.size)} ${direction})`,
                      )
                      .join(" → ")}
                  </option>
                ))}
              </select>
            </label>
          )}
          {turns.map(({ word }, i) => (
            <label key={i}>
              {i === 0 ? "First" : "Second"} play points · {word}
              <input
                type="number"
                min={0}
                step={1}
                value={scores[i] ?? ""}
                onChange={(event) => {
                  resetCheck();
                  setScores(
                    turns.map((_, j) =>
                      j === i ? event.target.value : (scores[j] ?? ""),
                    ),
                  );
                }}
              />
            </label>
          ))}
          <button
            type="button"
            className="button secondary"
            disabled={checking || !validScores}
            onClick={infer}
          >
            {checking ? "Checking scores…" : "Infer covered squares"}
          </button>
          {status && <p role="status">{status}</p>}
        </details>
      )}
    </>
  );
}
