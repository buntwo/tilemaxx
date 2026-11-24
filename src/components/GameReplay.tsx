import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ChevronDown, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { ReplayFrame } from "../../shared/game-replay";
import { emptyBoard, isBingo, tileScore } from "../../shared/model";
import { scorePlacement } from "../../shared/game-scoring";
import { moveLocation } from "../../shared/notation";
import Board from "./Board";
import MoveWord from "./MoveWord";
import ScoreChart from "./ScoreChart";

function replayBingo({ move, position, template }: ReplayFrame) {
  return (
    move?.bingo ?? (!!position && isBingo(template, position.tiles.length))
  );
}

export function ReplayBoard({ frame }: { frame: ReplayFrame }) {
  const { board, template, position, move } = frame;
  const after = board?.slice();
  if (after && position)
    for (const { index, letter } of position.tiles) after[index] = letter;
  const main =
    board &&
    after &&
    position &&
    move &&
    scorePlacement(board, after, template, position.direction)?.words.find(
      ({ word }) => word === move.word.toUpperCase(),
    );
  const location =
    main &&
    moveLocation({
      row: Math.floor(main.cells[0] / template.size),
      col: main.cells[0] % template.size,
      direction: main.direction,
    });
  return (
    <>
      <div className="last-play-lane">
        <div className="last-play-row" role="status" aria-atomic="true">
          <span>Replay</span>
          {move ? (
            <>
              <span>{move.player === "you" ? "You" : "Opp"}</span>
              <strong className="last-play-word">
                <MoveWord word={move.word} bingo={replayBingo(frame)} />
              </strong>
              <span className="last-play-points">{move.score} pts</span>
              {location && <span>{location}</span>}
            </>
          ) : (
            <strong className="last-play-word">
              {board?.every((tile) => !tile)
                ? "Start of game"
                : "Before first recorded move"}
            </strong>
          )}
        </div>
      </div>
      <div className="board-entry">
        <Board
          template={template}
          board={board ?? emptyBoard(template.size)}
          preview={position}
          previewPlayer={move?.player}
          disabled
          overlay={
            board ? undefined : (
              <div className="replay-board-unavailable">
                <span>Board unavailable for this position</span>
              </div>
            )
          }
        />
      </div>
    </>
  );
}

export function ReplayControls({
  frame,
  index,
  last,
  playing,
  seek,
  togglePlay,
  close,
}: {
  frame: ReplayFrame;
  index: number;
  last: number;
  playing: boolean;
  seek: (index: number) => void;
  togglePlay: () => void;
  close: () => void;
}) {
  const controls = useRef<HTMLDivElement>(null);
  useEffect(() => {
    controls.current?.focus({ preventScroll: true });
    controls.current?.scrollIntoView?.({ block: "nearest" });
  }, []);
  const playLabel = playing
    ? "Pause replay"
    : index === last
      ? "Play from start"
      : "Play replay";
  const value =
    index === 0
      ? "Before the first recorded move"
      : `Move ${index} of ${last}, ${frame.move?.player === "you" ? "you" : "opponent"}, ${frame.move?.word}, ${frame.move?.score} points`;
  return (
    <div
      ref={controls}
      className="board-replay-controls"
      role="group"
      aria-label="Game replay"
      aria-keyshortcuts="ArrowLeft ArrowRight Space"
      tabIndex={-1}
    >
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
      <span className="board-replay-count" aria-hidden="true">
        {index} / {last}
      </span>
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
      <button
        className="text-button board-replay-done"
        type="button"
        onClick={close}
      >
        Done
      </button>
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
  const scores = frames[index].scores;
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

export function ReplayRack({ frame }: { frame: ReplayFrame }) {
  const { rack, move, playedSlots, template } = frame;
  const opponent = move?.player === "opponent";
  const label = opponent ? "Opponent rack" : "Your rack";
  return (
    <div
      className="rack-entry replay-rack"
      data-player={move?.player}
      style={{ "--rack-size": template.rackSize } as CSSProperties}
    >
      <div className="replay-rack-label" aria-hidden="true">
        {opponent ? "Opponent" : "You"}
      </div>
      <div
        className="rack-tiles"
        role="group"
        aria-label={rack === undefined ? `${label} unavailable` : label}
      >
        {Array.from({ length: template.rackSize }, (_, i) => {
          const tile = rack?.[i] === "." ? undefined : rack?.[i];
          const played = playedSlots?.includes(i);
          const tileLabel = tile === "?" ? "Blank" : tile;
          return (
            <span
              key={i}
              className={`rack-tile${tile ? "" : " empty"}${played ? " move-preview" : ""}`}
              role="img"
              aria-hidden={!tile || undefined}
              aria-label={played ? `${tileLabel}, played` : tileLabel}
            >
              <span className="rack-slot">
                <span
                  className={`rack-face${tile === "?" ? " blank" : !tile ? " empty" : ""}`}
                >
                  {tile === "?" ? "" : tile || "·"}
                  {tile && <small>{tileScore(tile, template.rules)}</small>}
                </span>
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
