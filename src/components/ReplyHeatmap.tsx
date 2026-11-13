import { useState, type CSSProperties } from "react";
import { coordinate, type Game, type Move } from "../../shared/model";
import { placeTiles } from "../../shared/move-analysis";
import {
  BIG_REPLY_SCORE,
  type ReplyDistribution,
} from "../../shared/reply-analysis";
import type { PremiumReply } from "../../shared/solver";
import Board from "./Board";

const percent = (count: number, total: number) =>
  count === 0
    ? "0%"
    : count / total < 0.01
      ? "<1%"
      : `${Math.round((100 * count) / total)}%`;

export default function ReplyHeatmap({
  game,
  move,
  result,
  reference,
}: {
  game: Game;
  move: Move;
  result: ReplyDistribution;
  reference: Move;
}) {
  const [difference, setDifference] = useState(false);
  const [selected, setSelected] = useState<number>();
  const [preview, setPreview] = useState<PremiumReply>();
  const { template } = game;
  const heat = result.heatmap;
  if (!heat) return null;
  const compared = move.id !== reference.id;
  const before = new Map(
    heat.reference.map(({ square, count }) => [square, count]),
  );
  const after = new Map(heat.squares.map((entry) => [entry.square, entry]));
  const board = placeTiles(game.board, move);
  const counts = board.map((_, square) => {
    const count = after.get(square)?.count ?? 0;
    return difference ? count - (before.get(square) ?? 0) : count;
  });
  const ranked = counts
    .map((count, square) => ({ count, square }))
    .filter(({ count }) => count !== 0)
    .sort(
      (a, b) => Math.abs(b.count) - Math.abs(a.count) || a.square - b.square,
    );
  const peak = ranked[0] && Math.abs(ranked[0].count);
  const hotspot =
    selected !== undefined && counts[selected] ? selected : ranked[0]?.square;
  const examples =
    hotspot === undefined ? undefined : after.get(hotspot)?.examples;
  const currentPreview = examples?.some(({ play }) => play === preview)
    ? preview
    : undefined;

  function select(square: number) {
    setSelected(square);
    setPreview(undefined);
  }

  function toggle(compare: boolean) {
    setDifference(compare);
    setSelected(undefined);
    setPreview(undefined);
  }

  return (
    <div className="reply-heatmap">
      {compared && (
        <div
          className="reply-view-switch"
          role="group"
          aria-label="Heatmap view"
        >
          <button
            type="button"
            aria-pressed={!difference}
            onClick={() => toggle(false)}
          >
            After {move.word.toUpperCase()}
          </button>
          <button
            type="button"
            aria-pressed={difference}
            onClick={() => toggle(true)}
          >
            Change vs. {reference.word.toUpperCase()}
          </button>
        </div>
      )}
      <p className="defense-help">
        Where the highest-scoring {BIG_REPLY_SCORE}+ point replies place tiles.
        {difference
          ? " Red marks more frequent squares and green marks less frequent squares."
          : " Stronger color means a square is used more often."}
      </p>
      {difference && (
        <p className="defense-help">
          Reference · After {reference.word.toUpperCase()}
        </p>
      )}
      {!ranked.length ? (
        <p role="status">
          {difference
            ? "No change in the checked replies."
            : `No ${BIG_REPLY_SCORE}+ point replies in the checked racks.`}
        </p>
      ) : (
        <>
          <div className="reply-heat-board" aria-label="Reply hotspots">
            <Board
              compact
              template={template}
              board={board}
              preview={currentPreview}
              highlight={hotspot}
              cellOverlay={(index) =>
                counts[index]
                  ? {
                      style: {
                        "--heat-opacity": (
                          0.16 +
                          (0.68 * Math.abs(counts[index])) / peak
                        ).toFixed(3),
                        "--heat-color":
                          counts[index] > 0
                            ? "var(--reply-more)"
                            : "var(--reply-less)",
                      } as CSSProperties,
                      label: difference
                        ? `${percent(before.get(index) ?? 0, result.count)} to ${percent(after.get(index)?.count ?? 0, result.count)} of checked racks`
                        : `${percent(after.get(index)?.count ?? 0, result.count)} of checked racks use this square`,
                    }
                  : undefined
              }
              onSelect={(index) => {
                if (counts[index]) select(index);
              }}
            />
          </div>
          <div
            className="reply-hotspots"
            role="group"
            aria-label="Most affected squares"
          >
            {ranked.slice(0, 5).map(({ square }) => (
              <button
                type="button"
                key={square}
                aria-pressed={hotspot === square}
                onClick={() => select(square)}
              >
                {coordinate(square, template.size)}
              </button>
            ))}
          </div>
          {hotspot !== undefined && (
            <div className="reply-hotspot-detail" aria-live="polite">
              <strong>{coordinate(hotspot, template.size)}</strong>
              <span>
                {compared
                  ? `${percent(before.get(hotspot) ?? 0, result.count)} → `
                  : ""}
                {percent(after.get(hotspot)?.count ?? 0, result.count)} of
                checked racks
              </span>
              {examples?.length ? (
                <ul>
                  {examples.map(({ play, count }, index) => (
                    <li key={index}>
                      <button
                        type="button"
                        aria-pressed={currentPreview === play}
                        onClick={() =>
                          setPreview(currentPreview === play ? undefined : play)
                        }
                      >
                        <strong>{play.word.toUpperCase()}</strong>
                        <span>
                          {play.score} pts · {percent(count, result.count)}
                        </span>
                      </button>
                      <small>
                        Needs{" "}
                        {play.tiles
                          .map(({ letter }) =>
                            letter === letter.toUpperCase()
                              ? letter
                              : `blank as ${letter.toUpperCase()}`,
                          )
                          .join(", ")}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="defense-help">
                  No checked big reply uses this square after{" "}
                  {move.word.toUpperCase()}.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
