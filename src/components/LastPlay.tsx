import { ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { lastRecordedBoardPlay } from "../../shared/game-scoring";
import { moveLocation, trackedTurnLabel } from "../../shared/notation";
import { wordBonuses, type Game } from "../../shared/model";
import type { unseenTiles } from "../../shared/tile-pool";
import MoveWord from "./MoveWord";
import { DefinitionWord } from "./MoveDefinitions";

type RecordedPlay = NonNullable<ReturnType<typeof lastRecordedBoardPlay>>;
type ScoredWord = NonNullable<RecordedPlay["main"]>;

export type LastPlayBag = {
  bagSize: number;
  bagConfirmed: boolean;
  unseenPool: ReturnType<typeof unseenTiles> | undefined;
};

function BagStatus({ bagSize, bagConfirmed, unseenPool }: LastPlayBag) {
  if (!unseenPool || unseenPool.excess.length) return null;
  const estimatedCount = !bagConfirmed && unseenPool.total > 0;
  const includesOpponentRack = bagSize < unseenPool.total;
  const title = [
    estimatedCount &&
      "Bag count assumes one opponent with a full rack where possible.",
    bagSize > 0 &&
      includesOpponentRack &&
      "The vowel percentage and blank count use all unseen tiles, including the opponent’s rack. Blanks count toward the total.",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className="last-play-bag" title={title || undefined}>
      {bagSize === 0 ? (
        "Bag empty"
      ) : (
        <>
          Bag: {bagSize} ·{" "}
          {Math.round((100 * unseenPool.totals.vowel) / unseenPool.total)}% V ·{" "}
          {unseenPool.totals.blank} B
        </>
      )}
    </span>
  );
}

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

export default function LastPlay({
  game,
  bag,
  reserveSpace = false,
}: {
  game: Game;
  bag?: LastPlayBag;
  reserveSpace?: boolean;
}) {
  const play = useMemo(() => lastRecordedBoardPlay(game), [game]);
  if (!play) return reserveSpace
    ? <div className="last-play-row" aria-hidden="true" />
    : null;
  const { move } = play;
  return (
    <LastPlayLane
      key={`${game.id}:${move.at}:${move.player}:${move.word}:${move.score}`}
      play={play}
      size={game.template.size}
      bag={bag}
    />
  );
}

function LastPlayLane({
  play,
  size,
  bag,
}: {
  play: RecordedPlay;
  size: number;
  bag?: LastPlayBag;
}) {
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
      const target = event.target;
      if (target instanceof Element && target.closest(".definition-sheet, .definition-tooltip")) return;
      if (!lane.current?.contains(target as Node)) close();
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
      <span className="visually-hidden">{move.player === "you" ? "You" : "Opponent"}</span>
      <strong className="last-play-word" data-player={move.player}>
        {move.action ? trackedTurnLabel(move, "compact") : <MoveWord word={move.word} bingo={bingo} />}
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
      data-boardless-turn={move.action?.kind}
      onPointerLeave={() => setHover(false)}
    >
      <div className="last-play-row">
        {breakdown ? (
          <button
            type="button"
            className="last-play-summary"
            aria-expanded={open}
            aria-controls={id}
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") setHover(true);
            }}
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
        {bag && <BagStatus {...bag} />}
      </div>
      {breakdown && main && (
        <div className="last-play-breakdown" id={id} hidden={!open}>
          <table aria-label="Last play point breakdown">
            <tbody>
              {[main, ...breakdown.words.filter((word) => word !== main)].map(
                (word) => (
                  <tr key={`${word.cells[0]}:${word.direction}`}>
                    <th scope="row"><DefinitionWord word={word.word} /></th>
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
