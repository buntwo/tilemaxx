import { useEffect, useRef, type CSSProperties } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { ReplayFrame } from "../../shared/game-replay";
import { emptyBoard, isBingo, tileScore } from "../../shared/model";
import { scorePlacement } from "../../shared/game-scoring";
import { moveLocation } from "../../shared/notation";
import Board from "./Board";
import MoveWord from "./MoveWord";

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
                <MoveWord
                  word={move.word}
                  bingo={
                    move.bingo ??
                    (!!position && isBingo(template, position.tiles.length))
                  }
                />
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
  const slider = useRef<HTMLInputElement>(null);
  useEffect(() => {
    slider.current?.focus({ preventScroll: true });
    slider.current?.scrollIntoView?.({ block: "nearest" });
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
      className="board-replay-controls"
      role="group"
      aria-label="Game replay"
    >
      <input
        ref={slider}
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

export function ReplayRack({ frame }: { frame: ReplayFrame }) {
  const { rack, move, template } = frame;
  const label =
    rack === undefined
      ? "Rack unavailable"
      : move?.player === "you"
        ? "Rack leave"
        : "Your rack";
  return (
    <div
      className="rack-entry replay-rack"
      style={{ "--rack-size": template.rackSize } as CSSProperties}
    >
      <div className="replay-rack-label">{label}</div>
      {rack !== undefined && (
        <div className="rack-tiles" role="group" aria-label={label}>
          {Array.from({ length: template.rackSize }, (_, i) => {
            const tile = rack[i] === "." ? "" : rack[i];
            return (
              <span
                key={i}
                className={`rack-tile${tile ? "" : " empty"}`}
                role="img"
                aria-hidden={!tile || undefined}
                aria-label={tile === "?" ? "Blank" : tile}
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
      )}
    </div>
  );
}
