import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { ReplayFrame } from "../../shared/game-replay";
import { emptyBoard, isBingo, tileScore } from "../../shared/model";
import { recordedMoveDetails } from "../../shared/notation";
import { sortedRackSlots } from "../../shared/rack-entry";
import Board from "./Board";
import { ScorePlayerMarker } from "./GameScores";
import MoveWord from "./MoveWord";
import RackBag from "./RackBag";
import TilePool from "./TilePool";
import ScoreChart from "./ScoreChart";

function replayBingo({ move, position, template }: ReplayFrame) {
  return (
    move?.bingo ?? (!!position && isBingo(template, position.tiles.length))
  );
}

export function ReplayBoard({ frame }: { frame: ReplayFrame }) {
  const { board, template, position, move } = frame;
  return (
    <>
      <div className="last-play-lane">
        <div className="last-play-row"><span>Replay</span></div>
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

function ReplayMoveStrip({ frame }: { frame: ReplayFrame }) {
  const { board, move, position, template } = frame;
  const details = move && recordedMoveDetails(move, position, template.size);
  return (
    <div
      className="replay-move-strip"
      data-player={move?.player}
      role="status"
      aria-atomic="true"
    >
      {move ? (
        <>
          <div className="replay-move-word">
            <span className="replay-move-player">
              {move.player === "you" ? "You" : "Opp"}
            </span>
            <strong className="last-play-word">
              <MoveWord
                word={move.word}
                notation={details?.notation}
                bingo={replayBingo(frame)}
              />
            </strong>
          </div>
          <div className="replay-move-result">
            <strong>{move.score} pts</strong>
            {details?.location && <span>{details.location}</span>}
          </div>
        </>
      ) : (
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
  playing,
  seek,
  togglePlay,
  close,
}: {
  frame: ReplayFrame;
  frames: readonly ReplayFrame[];
  index: number;
  last: number;
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
      style={{ "--replay-point-digits": pointDigits } as CSSProperties}
      role="group"
      aria-label="Game replay"
      aria-keyshortcuts="ArrowLeft ArrowRight Space"
      tabIndex={-1}
    >
      <ReplayMoveStrip frame={frame} />
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
        <span className="board-replay-count" aria-hidden="true">
          {index} / {last}
        </span>
      </div>
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

export function ReplayRack({
  frame,
  showOpponentTiles,
  solo,
  phone,
  detailsTarget,
}: {
  frame: ReplayFrame;
  showOpponentTiles: boolean;
  solo?: boolean;
  phone: boolean;
  detailsTarget: HTMLDivElement | null;
}) {
  const { bag, move, playedSlots, template, unseen } = frame;
  const tilePoolId = useId();
  const [poolOpen, setPoolOpen] = useState(false);
  const opponent = move?.player === "opponent";
  const partial = opponent && frame.rack === undefined && showOpponentTiles
    ? frame.opponentPlayedTiles
    : undefined;
  const rack = frame.rack ?? partial;
  const slots = sortedRackSlots((rack ?? "").slice(0, template.rackSize));
  const used = slots.filter((slot) => playedSlots?.includes(slot));
  const leave = slots.filter((slot) => !used.includes(slot));
  const empty = Array<undefined>(template.rackSize - slots.length).fill(undefined);
  const order = [...leave, ...used, ...empty];
  const usedEnd = leave.length + used.length;
  const label = opponent ? "Opponent rack" : "Your rack";
  const bagLabel = bag
    ? `${bag.count}${bag.estimated ? " estimated" : ""} ${bag.count === 1 ? "tile" : "tiles"} in the bag before the play${bag.invalid ? ", check tile counts" : ""}`
    : "Bag count unavailable";
  const details = unseen && (
    <TilePool
      pool={unseen}
      solo={solo}
      id={tilePoolId}
      open={poolOpen}
      hideWhenClosed={phone}
      onOpenChange={setPoolOpen}
    />
  );
  return (
    <div
      className="rack-entry replay-rack"
      data-player={move?.player}
      style={{ "--rack-size": template.rackSize } as CSSProperties}
    >
      <div className="replay-rack-label" aria-hidden="true">
        {opponent ? "Opponent" : "You"}
      </div>
      <div className="replay-rack-row">
        <div
          className="rack-tiles"
          role="group"
          aria-label={
            partial ? "Opponent tiles played" :
            rack === undefined ? `${label} unavailable` : label
          }
        >
          {order.map((slot, i) => {
            const tile = slot === undefined ? undefined : rack?.[slot];
            const played = i >= leave.length && i < usedEnd;
            const tileLabel = tile === "?" ? "Blank" : tile;
            return (
              <span
                key={i}
                className={`rack-tile${tile ? "" : " empty"}${played ? " move-preview" : ""}`}
                data-used-group-start={played && i === leave.length && i > 0 || undefined}
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
        <RackBag
          count={bag?.count ?? "?"}
          label={bagLabel}
          invalid={bag?.invalid}
          controls={unseen ? tilePoolId : undefined}
          expanded={unseen ? poolOpen : undefined}
          onClick={unseen ? () => setPoolOpen((open) => !open) : undefined}
        />
      </div>
      {phone ? detailsTarget && createPortal(details, detailsTarget) : details}
    </div>
  );
}
