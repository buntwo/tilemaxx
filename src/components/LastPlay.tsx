import { ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { lastRecordedBoardPlay } from "../../shared/game-scoring";
import { moveLocation } from "../../shared/notation";
import { wordBonuses, type Game } from "../../shared/model";
import MoveWord from "./MoveWord";

type RecordedPlay = NonNullable<ReturnType<typeof lastRecordedBoardPlay>>;
type ScoredWord = NonNullable<RecordedPlay["main"]>;

function location({ cells, direction }: ScoredWord, size: number) {
  return moveLocation({
    row: Math.floor(cells[0] / size),
    col: cells[0] % size,
    direction,
  });
}

function multiplierText(word: ScoredWord) {
  if (word.multiplier === 1) return "";
  const premiums = word.tiles.flatMap(({ premium }) =>
    wordBonuses[premium] ? [premium] : [],
  );
  return `${word.sum} × ${word.multiplier} ${premiums.join("·")}`;
}

export default function LastPlay({ game }: { game: Game }) {
  const play = useMemo(() => lastRecordedBoardPlay(game), [game]);
  if (!play) return null;
  const { move } = play;
  return (
    <LastPlayLane
      key={`${game.id}:${move.at}:${move.player}:${move.word}:${move.score}`}
      play={play}
      size={game.template.size}
    />
  );
}

function LastPlayLane({ play, size }: { play: RecordedPlay; size: number }) {
  const { move, main, bingo, breakdown } = play;
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const lane = useRef<HTMLDivElement>(null);
  const id = useId();
  const open = Boolean(breakdown && (hover || pinned));
  useEffect(() => {
    if (!open) return;
    function close() {
      setHover(false);
      setPinned(false);
    }
    function outside(event: PointerEvent) {
      if (!lane.current?.contains(event.target as Node)) close();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const summary = (
    <>
      <span>Last play: {move.player === "you" ? "You" : "Opp"}</span>
      <span aria-hidden="true">·</span>
      <strong className="last-play-word">
        <MoveWord word={move.word} bingo={bingo} />
      </strong>
      <span aria-hidden="true">·</span>
      <span className="last-play-points">{move.score} pts</span>
      {main && (
        <>
          <span aria-hidden="true">·</span>
          <span>{location(main, size)}</span>
        </>
      )}
    </>
  );

  return (
    <div
      ref={lane}
      className="last-play-lane"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHover(true);
      }}
      onPointerLeave={() => setHover(false)}
    >
      {breakdown ? (
        <button
          type="button"
          className="last-play-summary"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => {
            if (pinned) setHover(false);
            setPinned(!pinned);
          }}
        >
          {summary}
          <ChevronDown size={12} aria-hidden="true" />
        </button>
      ) : (
        <div className="last-play-summary">{summary}</div>
      )}
      {breakdown && main && (
        <div className="last-play-breakdown" id={id} hidden={!open}>
          <table aria-label="Last play point breakdown">
            <tbody>
              {[main, ...breakdown.words.filter((word) => word !== main)].map(
                (word) => (
                  <tr key={`${word.cells[0]}:${word.direction}`}>
                    <th scope="row">{word.word}</th>
                    <td className="last-play-notation">
                      {location(word, size)}
                    </td>
                    <td className="last-play-multiplier">
                      {multiplierText(word)}
                    </td>
                    <td className="last-play-points">{word.score}</td>
                  </tr>
                ),
              )}
              {breakdown.bonus > 0 && (
                <tr>
                  <th scope="row" colSpan={3}>
                    Bingo bonus
                  </th>
                  <td className="last-play-points">{breakdown.bonus}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  Total
                </th>
                <td className="last-play-points">{move.score} pts</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
