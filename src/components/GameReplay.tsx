import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ChevronDown, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { ReplayFrame } from "../../shared/game-replay";
import { isBingo, tileScore } from "../../shared/model";
import { recordedMoveDetails } from "../../shared/notation";
import { ScorePlayerMarker } from "./GameScores";
import MoveWord from "./MoveWord";
import ScoreChart from "./ScoreChart";

function replayBingo({ move, position, template }: ReplayFrame) {
  return (
    move?.bingo ?? (!!position && isBingo(template, position.tiles.length))
  );
}

function ReplayMoveStrip({
  frame, historical, showRecorded, onToggleRecorded,
}: {
  frame: ReplayFrame;
  historical: boolean;
  showRecorded: boolean;
  onToggleRecorded: () => void;
}) {
  const { board, position, template } = frame;
  const move = historical ? frame.move : undefined;
  const details = move && recordedMoveDetails(move, position, template.size);
  return (
    <div
      className="replay-move-strip"
      data-player={move?.player}
      role="status"
      aria-atomic="true"
    >
      <span className="replay-strip-label">Replay</span>
      {move ? (
        <>
          <div className="replay-move-word">
            <span className="replay-move-player">
              {move.player === "you" ? "You" : "Opp"}
            </span>
            <button
              className="text-button replay-recorded-word last-play-word"
              type="button"
              disabled={!position}
              aria-label={`Preview recorded move ${move.word}`}
              aria-pressed={showRecorded}
              title={details?.notation ?? move.word}
              onClick={onToggleRecorded}
            >
              <MoveWord
                word={move.word}
                notation={details?.notation}
                bingo={replayBingo(frame)}
              />
            </button>
          </div>
          <div className="replay-move-result">
            <strong>{move.score} pts</strong>
            {details?.location && <span>{details.location}</span>}
          </div>
        </>
      ) : historical && (
        <span>
          {board?.every((tile) => !tile)
            ? "Start of game"
            : "Before first recorded move"}
        </span>
      )}
    </div>
  );
}

export function ReplayControls({
  frame,
  frames,
  index,
  last,
  recordedCount,
  archived,
  historical,
  showRecorded,
  onToggleRecorded,
  playing,
  seek,
  togglePlay,
  close,
}: {
  frame: ReplayFrame;
  frames: readonly ReplayFrame[];
  index: number;
  last: number;
  recordedCount: number;
  archived: boolean;
  historical: boolean;
  showRecorded: boolean;
  onToggleRecorded: () => void;
  playing: boolean;
  seek: (index: number) => void;
  togglePlay: () => void;
  close: () => void;
}) {
  const controls = useRef<HTMLDivElement>(null);
  const pointDigits = useMemo(
    () => frames.reduce((width, { move }) => Math.max(width, String(move?.score ?? 0).length), 2),
    [frames],
  );
  useEffect(() => {
    if (archived) return;
    controls.current?.focus({ preventScroll: true });
    controls.current?.scrollIntoView?.({ block: "nearest" });
  }, [archived]);
  const playLabel = playing
    ? "Pause replay"
    : index === last
      ? "Play from start"
      : "Play replay";
  const value =
    !historical ? "Final board" : index === 0
      ? "Before the first recorded move"
      : `Move ${index} of ${recordedCount}, ${frame.move?.player === "you" ? "you" : "opponent"}, ${frame.move?.word}, ${frame.move?.score} points`;
  return (
    <div
      ref={controls}
      className="board-replay-controls"
      style={{ "--replay-point-digits": pointDigits } as CSSProperties}
      role="group"
      aria-label="Game replay"
      aria-keyshortcuts="ArrowLeft ArrowRight Space"
      tabIndex={-1}
    >
      <ReplayMoveStrip {...{ frame, historical, showRecorded, onToggleRecorded }} />
      <div className="board-replay-actions">
        <div className="board-replay-transport">
          <button
            className="icon-button"
            type="button"
            aria-label="Previous move"
            title="Previous move"
            disabled={index === 0}
            onClick={() => seek(index - 1)}
          >
            <SkipBack size={16} aria-hidden="true" />
          </button>
          <button
            className="icon-button board-replay-play"
            type="button"
            aria-label={playLabel}
            title={playLabel}
            onClick={togglePlay}
          >
            {playing ? (
              <Pause size={16} aria-hidden="true" />
            ) : (
              <Play size={16} aria-hidden="true" />
            )}
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Next move"
            title="Next move"
            disabled={index === last}
            onClick={() => seek(index + 1)}
          >
            <SkipForward size={16} aria-hidden="true" />
          </button>
        </div>
        {historical && !archived && <button
          className="text-button board-replay-done"
          type="button"
          onClick={close}
        >
          Back to live
        </button>}
      </div>
      <div className="board-replay-track">
        <input
          type="range"
          className="board-replay-slider"
          aria-label="Replay moves"
          aria-valuetext={value}
          min={0}
          max={last}
          step={1}
          value={index}
          style={
            { "--replay-progress": `${(100 * index) / last}%` } as CSSProperties
          }
          onChange={(event) => seek(event.currentTarget.valueAsNumber)}
        />
        <span
          className="board-replay-count"
          data-count-width={`${recordedCount} / ${recordedCount}`}
          aria-hidden="true"
        >
          <span>{Math.min(index, recordedCount)} / {recordedCount}</span>
        </span>
      </div>
    </div>
  );
}

export function ReplayScores({
  frames,
  scoreStart,
  index,
  solo,
  seek,
}: {
  frames: readonly ReplayFrame[];
  scoreStart: number;
  index: number;
  solo?: boolean;
  seek: (index: number) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const moves = useMemo(
    () =>
      frames.flatMap((frame, number) =>
        frame.move
          ? [{ ...frame.move, number, bingo: replayBingo(frame) }]
          : [],
      ),
    [frames],
  );
  // A score reset starts a new chart. Keep the earlier record accessible when
  // replaying it and use the same pairing boundary as the live score chart.
  const earlier = scoreStart > 0 && index <= scoreStart;
  const chartMoves = useMemo(
    () => (earlier ? moves.slice(0, scoreStart) : moves.slice(scoreStart)),
    [earlier, moves, scoreStart],
  );
  const { scores, move } = frames[index];
  const turn = solo ? undefined : move?.player;
  const players = solo ? (["you"] as const) : (["you", "opponent"] as const);
  return (
    <section
      className="panel score-panel replay-score-panel"
      aria-label="Game scores"
    >
      <div className="score-header">
        <h2>Game scores</h2>
      </div>
      <dl className="score-players" data-solo={solo}>
        {players.map((player) => (
          <div key={player} data-player={player}>
            <dt>{player === "you" ? "You" : "Opponent"}</dt>
            <dd className="score-total">
              {scores[player]} <small>pts</small>
              <ScorePlayerMarker player={player} turn={turn} />
            </dd>
          </div>
        ))}
      </dl>
      <ScoreChart
        moves={chartMoves}
        solo={solo}
        replay={{ index, scores, seek }}
      />
      <div className="score-history-section">
        <details
          className="score-history"
          onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
        >
          <summary>
            <span>
              Tracked move history <small>({moves.length})</small>
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </summary>
          {historyOpen && (
            <ol className="replay-score-history">
              {[...moves].reverse().map((move) => (
                <li key={move.number}>
                  <button
                    type="button"
                    className="replay-score-history-move"
                    aria-current={move.number === index ? "step" : undefined}
                    onClick={() => seek(move.number)}
                  >
                    <span>{move.number}</span>
                    <span>{move.player === "you" ? "You" : "Opp"}</span>
                    <MoveWord word={move.word} bingo={move.bingo} />
                    <span>+{move.score} pts</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </details>
      </div>
    </section>
  );
}

function ReplayTile({
  tile,
  rules,
  unknown = false,
}: {
  tile?: string;
  rules: ReplayFrame["template"]["rules"];
  unknown?: boolean;
}) {
  const label = unknown ? "Drawn letter unknown" : tile === "?" ? "Blank" : tile;
  return (
    <span
      className="rack-tile"
      role="img"
      aria-label={label}
    >
      <span className="rack-slot">
        <span className={`rack-face${unknown ? " unknown" : tile === "?" ? " blank" : !tile ? " empty" : ""}`}>
          {unknown ? "?" : tile === "?" ? "" : tile || "·"}
          {tile && <small>{tileScore(tile, rules)}</small>}
        </span>
      </span>
    </span>
  );
}

export function ReplayDrawShelf({
  draw,
  rules,
  start,
}: {
  draw?: ReplayFrame["draw"];
  rules: ReplayFrame["template"]["rules"];
  start: number;
}) {
  return (
    <div className="replay-draw-space">
      <div className="replay-draw-lane">
        {draw && (
          <div
            className="replay-draw-shelf"
            role="group"
            aria-label={draw.count === undefined ? "Draw unknown" : "Tiles drawn"}
            style={{ "--draw-start": start } as CSSProperties}
          >
            <span className="replay-draw-label" aria-hidden="true">
              {draw.count === undefined ? "Draw" : "Drew"}
            </span>
            <div className="replay-draw-tiles">
              {Array.from({ length: draw.count ?? 1 }, (_, i) => (
                <ReplayTile key={i} tile={draw.tiles[i]} rules={rules} unknown={!draw.tiles[i]} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
