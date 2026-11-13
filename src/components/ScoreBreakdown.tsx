import { scorePlacement } from "../../shared/game-scoring";

type Breakdown = NonNullable<ReturnType<typeof scorePlacement>>;

export default function ScoreBreakdown({
  breakdown,
}: {
  breakdown: Breakdown;
}) {
  return (
    <details className="score-breakdown">
      <summary>Score breakdown</summary>
      <ScoreBreakdownContent breakdown={breakdown} />
    </details>
  );
}

export function ScoreBreakdownContent({ breakdown }: { breakdown: Breakdown }) {
  return (
    <div className="score-breakdown-content">
      <ul>
        {breakdown.words.map((word, index) => (
          <li key={index}>
            <div className="score-breakdown-line">
              <strong>{word.word}</strong>
              <span>
                {word.multiplier > 1
                  ? `${word.sum} × ${word.multiplier} = `
                  : ""}
                {word.score}
              </span>
            </div>
            <small>
              {word.tiles
                .filter((tile) => tile.blank || tile.premium)
                .map(
                  (tile) =>
                    `${tile.square} ${tile.letter}: ${[
                      tile.blank && "blank (0 pts)",
                      tile.premium &&
                        (tile.letterMultiplier > 1
                          ? `${tile.premium} (${tile.points} × ${tile.letterMultiplier})`
                          : tile.premium),
                    ]
                      .filter(Boolean)
                      .join(", ")}`,
                )
                .join(" · ")}
            </small>
          </li>
        ))}
        {breakdown.bingo && (
          <li className="score-breakdown-line">
            <span>Bingo bonus</span>
            <span>+{breakdown.bonus}</span>
          </li>
        )}
      </ul>
      <div className="score-breakdown-line score-breakdown-total">
        <strong>Total</strong>
        <strong>{breakdown.score} pts</strong>
      </div>
    </div>
  );
}
