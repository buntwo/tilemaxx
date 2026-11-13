import { scorePlacement } from "../../shared/game-scoring";

export default function ScoreBreakdown({
  breakdown,
}: {
  breakdown: NonNullable<ReturnType<typeof scorePlacement>>;
}) {
  return (
    <details className="score-breakdown">
      <summary>Score breakdown</summary>
      <ul>
        {breakdown.words.map((word, index) => (
          <li key={index}>
            <strong>{word.word}</strong> · {word.sum}
            {word.multiplier > 1 ? ` × ${word.multiplier}` : ""} = {word.score}
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
        {breakdown.bingo && <li>Bingo bonus · +{breakdown.bonus}</li>}
      </ul>
      <strong>Total · {breakdown.score} pts</strong>
    </details>
  );
}
