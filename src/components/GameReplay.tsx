import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { gameScoreTotals, scoreHistoryMoves, type GameScoreSummary } from "../../shared/game-scoring";
import type { ReplayFrame } from "../../shared/game-replay";
import type { Game, GameScoring } from "../../shared/model";
import { moveLocation, moveNotation, recordedMoveDetails, trackedTurnLabel } from "../../shared/notation";
import type { StylePlacement } from "../../shared/style-explanation";
import ReplayMoveExplanation from "./ReplayMoveExplanation";
import { ScorePlayers } from "./GameScores";
import MoveWord from "./MoveWord";
import ScoreChart from "./ScoreChart";
import { RackTileFace } from "./TileFace";
import TrackedMoveHistory from "./TrackedMoveHistory";

function ReplayMoveStrip({
  frame, historical, showRecorded, onToggleRecorded, why,
}: {
  frame: ReplayFrame;
  historical: boolean;
  showRecorded: boolean;
  onToggleRecorded: () => void;
  why?: ReactNode;
}) {
  const { board, position, template } = frame;
  const move = historical ? frame.move : undefined;
  const details = move && !move.action ? recordedMoveDetails(move, position, template.size) : undefined;
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
          <span className="replay-move-player">
            {move.player === "you" ? "You" : "Opp"}
          </span>
          {move.action ? <strong className="last-play-word">{trackedTurnLabel(move, "compact")}</strong> : <button
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
              bingo={move.bingo}
            />
          </button>}
          <div className="replay-move-result">
            <strong>{move.score} pts</strong>
            {details?.location && <span>{details.location}</span>}
          </div>
          {why}
        </>
      ) : (
        <span className="replay-strip-status">
          {!historical ? "Final board" : board?.every((tile) => !tile)
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
  alternativePreview,
  canPreviewAlternative,
  onToggleAlternative,
  detailsTarget,
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
  alternativePreview?: StylePlacement;
  canPreviewAlternative: boolean;
  onToggleAlternative: () => void;
  detailsTarget?: HTMLElement | null;
  playing: boolean;
  seek: (index: number, replace?: boolean) => void;
  togglePlay: () => void;
  close: () => void;
}) {
  const controls = useRef<HTMLDivElement>(null);
  const explanationId = useId();
  const [whyOpen, setWhyOpen] = useState(false);
  const explanation = historical ? frame.move?.styleExplanation : undefined;
  const details = (
    <>
      {alternativePreview && (
        <div className="replay-alternative-status" role="status">
          Alternative · {moveNotation(alternativePreview, frame.template.size, frame.board)}
          {" · "}{moveLocation(alternativePreview)} {alternativePreview.direction}
          {" · "}{alternativePreview.score} pts
        </div>
      )}
      {explanation && whyOpen && (
        <ReplayMoveExplanation key={index} id={explanationId} explanation={explanation}
          position={frame.position} template={frame.template} canPreview={canPreviewAlternative}
          previewing={!!alternativePreview} onPreview={onToggleAlternative} />
      )}
    </>
  );
  const scrub = useRef<{ changed: boolean } | null>(null);
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
      : `Move ${index} of ${recordedCount}, ${frame.move?.player === "you" ? "you" : "opponent"}, ${frame.move ? trackedTurnLabel(frame.move) : ""}, ${frame.move?.score} points`;
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
      <ReplayMoveStrip {...{ frame, historical, showRecorded, onToggleRecorded }} why={explanation && (
        <button type="button" className="button secondary replay-why" data-move-preview-action
          aria-controls={whyOpen ? explanationId : undefined} aria-expanded={whyOpen}
          onClick={() => {
            if (whyOpen && alternativePreview) onToggleAlternative();
            setWhyOpen(!whyOpen);
          }}>Why?</button>
      )} />
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
          onPointerDown={() => { scrub.current = { changed: false }; }}
          onPointerUp={() => { scrub.current = null; }}
          onPointerCancel={() => { scrub.current = null; }}
          onBlur={() => { scrub.current = null; }}
          onChange={(event) => {
            seek(event.currentTarget.valueAsNumber, scrub.current?.changed);
            if (scrub.current) scrub.current.changed = true;
          }}
        />
        <span
          className="board-replay-count"
          data-count-width={`${recordedCount} / ${recordedCount}`}
          aria-hidden="true"
        >
          <span>{Math.min(index, recordedCount)} / {recordedCount}</span>
        </span>
      </div>
      {detailsTarget ? createPortal(details, detailsTarget) : details}
    </div>
  );
}

export function ReplayScores({
  frames,
  scoreStart,
  index,
  sourceGame,
  solo,
  finalScoring,
  finalOutcome,
  seek,
}: {
  frames: readonly ReplayFrame[];
  scoreStart: number;
  index: number;
  sourceGame: Game;
  solo?: true;
  finalScoring?: GameScoring;
  finalOutcome?: GameScoreSummary["outcome"];
  seek: (index: number) => void;
}) {
  const moves = useMemo(
    () => scoreHistoryMoves(
      frames.flatMap(({ move, position, rack, template }, number) =>
        move ? [{
          move,
          position: position && {
            ...position,
            premiums: template.premiums,
            rack: move.player === "opponent" ? rack ?? position.rack : position.rack,
          },
          index: number - 1,
        }] : [],
      ),
      sourceGame,
    ),
    [frames, sourceGame],
  );
  const newestMoves = useMemo(() => [...moves].reverse(), [moves]);
  const frameIndex = Math.min(index, frames.length - 1);
  // A score reset starts a new chart. Keep the earlier record accessible when
  // replaying it and use the same pairing boundary as the live score chart.
  const earlier = scoreStart > 0 && frameIndex <= scoreStart;
  const chartMoves = useMemo(
    () => (earlier ? moves.slice(0, scoreStart) : moves.slice(scoreStart)),
    [earlier, moves, scoreStart],
  );
  const { scores, move, stats } = frames[frameIndex];
  const turn = index === frameIndex && !solo ? move?.player : undefined;
  const winner = finalOutcome === "win" ? "you" :
    finalOutcome === "loss" ? "opponent" : undefined;
  return (
    <section
      className="panel score-panel replay-score-panel"
      aria-label="Game scores"
    >
      <div className="score-header">
        <h2>Game scores</h2>
      </div>
      <ScorePlayers
        stats={finalScoring ?? stats}
        totals={finalScoring ? gameScoreTotals(finalScoring) : scores}
        solo={solo}
        turn={turn}
        winner={winner}
      />
      <ScoreChart
        moves={chartMoves}
        solo={solo}
        replay={{ index: frameIndex, scores, seek, finalBoard: index > frameIndex }}
      />
      <TrackedMoveHistory
        moves={newestMoves}
        template={frames[0].template}
        dictionaryId={sourceGame.dictionaryId}
        solo={solo}
        replayIndex={index}
        onSelect={seek}
      />
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
        <RackTileFace tile={tile} rules={rules} unknown={unknown} />
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
