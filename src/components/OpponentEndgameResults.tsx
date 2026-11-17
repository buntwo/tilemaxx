import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronUp, LoaderCircle, Swords, X } from "lucide-react";
import type { EndgameLine } from "../../shared/endgame";
import { scoreTotalsAtPosition } from "../../shared/game-scoring";
import { coordinate, isBingo, type Game, type Move } from "../../shared/model";
import type {
  OpponentEndgameProgress,
  OpponentEndgameResult,
} from "../parallel-opponent-endgame";
import { finalMarginLabel, scoreTone, signedPoints } from "../score-tone";
import { endgameLength } from "../endgame-line-format";
import CalculationIndicator from "./CalculationIndicator";
import { BingoBadge } from "./MoveWord";
import OptimalReplyDetails from "./OptimalReplyDetails";

export default function OpponentEndgameResults({
  game,
  opponentRack,
  result,
  onClose,
  onPreview,
}: {
  game: Game;
  opponentRack: string;
  result: OpponentEndgameResult;
  onClose: () => void;
  onPreview: (move: Move | null) => void;
}) {
  const [selected, setSelected] = useState<EndgameLine>();
  const detailId = useId();
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const firstMove =
      panel.current?.querySelector<HTMLButtonElement>(".result-row");
    (
      firstMove ??
      panel.current?.querySelector<HTMLButtonElement>(".opponent-endgame-close")
    )?.focus({ preventScroll: true });
  }, []);
  const totals = scoreTotalsAtPosition(game);
  const complete = result.checked === result.total;
  return (
    <section
      className="results-panel panel with-reply-column with-endgame-estimates opponent-endgame"
      aria-label="Opponent endgame"
      ref={panel}
    >
      <header className="results-title">
        <div className="heading-with-icon">
          <CalculationIndicator active={false} idleIcon={<Swords />} />
          <h2>Opponent endgame</h2>
          {!!result.lines.length && (
            <span className="count-badge">{result.lines.length}</span>
          )}
        </div>
        <button
          className="icon-button results-close opponent-endgame-close"
          type="button"
          aria-label="Close opponent endgame"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <p className="opponent-endgame-note">Opponent plays next</p>
      {!complete && (
        <p className="opponent-endgame-note" role="status">
          Search limit reached. Checked {result.checked.toLocaleString()} of{" "}
          {result.total.toLocaleString()} options.
        </p>
      )}
      {result.lines.length > 0 ? (
        <>
          <div className="result-columns" aria-hidden="true">
            <span className="result-word-heading">WORD</span>
            <span className="result-points-heading">PTS</span>
            <span className="result-reply-heading opponent-swing-heading">
              SWING <ChevronUp size={10} />
            </span>
            <span className="result-leave-heading">LEAVE</span>
            <span className="result-position-heading">POS</span>
          </div>
          <ol
            className="opponent-endgame-moves"
            aria-label="Opponent moves sorted by swing for you, ascending"
          >
            {result.lines.map((line, index) => {
              const move = line.line[0];
              const length = endgameLength(line);
              const leave = move ? move.leave : opponentRack;
              const bingo = !!move && isBingo(game.template, move.tiles.length);
              const margin =
                totals && totals.you - totals.opponent + line.spread;
              return (
                <li key={move?.id ?? "pass"}>
                  <button
                    className={`result-row${selected === line ? " pinned" : ""}${bingo ? " bingo" : ""}`}
                    type="button"
                    aria-expanded={selected === line}
                    aria-controls={selected === line ? detailId : undefined}
                    onClick={() => {
                      const next = selected === line ? undefined : line;
                      setSelected(next);
                      onPreview(next?.line[0] ?? null);
                    }}
                  >
                    <span className="result-word result-stack">
                      <span className="result-rank">{index + 1}</span>
                      <span className="result-letters">
                        {move ? (
                          <span className="result-letter played">
                            {move.word}
                          </span>
                        ) : (
                          "Pass"
                        )}
                      </span>
                      <small className="result-word-detail">
                        {bingo && <BingoBadge full />}
                        <span className="result-word-note">
                          {move
                            ? `${move.tiles.length} ${move.tiles.length === 1 ? "tile" : "tiles"}`
                            : "No tiles played"}
                        </span>
                      </small>
                    </span>
                    <span className="result-score">
                      <strong>{move?.score ?? 0}</strong>
                    </span>
                    <span className="result-reply-metric reply-cell endgame-estimate">
                      <strong className={scoreTone(line.spread)}>
                        {signedPoints(line.spread)}
                      </strong>
                      {margin !== undefined && (
                        <small className={scoreTone(margin)}>
                          {finalMarginLabel(margin)}
                        </small>
                      )}
                      <small
                        className="reply-neutral endgame-ply-count"
                        title={length.expanded}
                      >
                        {length.compact}
                      </small>
                    </span>
                    <span className="result-leave">{leave || "—"}</span>
                    <span className="result-coordinate">
                      {move
                        ? coordinate(
                            move.row * game.template.size + move.col,
                            game.template.size,
                          ) + (move.direction === "across" ? "→" : "↓")
                        : "—"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <footer className="results-foot">
            <span>Select an opponent move to preview its line</span>
          </footer>
          {selected && (
            <section
              className="inline-reply"
              id={detailId}
              aria-label="Opponent reply details"
              data-move-preview-action
            >
              <h3 className="optimal-reply-title">
                <span>Reply details</span>
                <span className="optimal-reply-badge">
                  <Check size={13} aria-hidden="true" /> Exact line
                </span>
              </h3>
              <OptimalReplyDetails
                game={game}
                line={selected}
                opponentRack={opponentRack}
                firstPlayer="opponent"
              />
            </section>
          )}
        </>
      ) : (
        <div className="results-empty">
          <h3>No complete lines found</h3>
        </div>
      )}
    </section>
  );
}

export function OpponentEndgamePending({
  progress,
  onCancel,
}: {
  progress?: OpponentEndgameProgress;
  onCancel: () => void;
}) {
  return (
    <div className="results-empty">
      <LoaderCircle className="spin" size={30} aria-hidden="true" />
      <h3 role="status">Solving opponent endgame…</h3>
      {progress && (
        <p>
          {progress.checked.toLocaleString()} /{" "}
          {progress.total.toLocaleString()} options checked
        </p>
      )}
      <button className="button secondary" type="button" onClick={onCancel}>
        Cancel search
      </button>
    </div>
  );
}
