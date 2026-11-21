import type { BingoCeilingResult } from "../../shared/bingo-ceilings";
import type { Move } from "../../shared/model";
import { moveLocation } from "../../shared/notation";
import { formatUtility } from "./MoveScoreTooltip";
import { BingoBadge } from "./MoveWord";
import { DefinitionWord } from "./MoveDefinitions";

function percent(chance: number) {
  return chance > 0 && chance < 0.0001
    ? "<0.01%"
    : `${formatUtility(chance * 100)}%`;
}

export default function HighCeilingSetups({
  setups, selected, onPreview, onPlay,
}: {
  setups: readonly BingoCeilingResult[];
  selected: string | null;
  onPreview: (move: Move) => void;
  onPlay: (move: Move) => void;
}) {
  return (
    <details className="high-ceiling-setups">
      <summary>High-ceiling setups ({setups.length})</summary>
      <ul>
        {setups.map(({ move, bingo, draw, drawChance, chance, laneBingoChance, blockChance, needsReply, exact, cases }) => (
          <li key={move.id}>
            <div className="high-ceiling-line">
              <button type="button" className="button secondary" data-move-preview-action
                aria-label={`Preview ${move.word} at ${moveLocation(move)}`}
                aria-pressed={selected === move.id} onClick={() => onPreview(move)}>
                <DefinitionWord word={move.word} /> {move.score}
              </button>
              <span>
                <span aria-hidden="true">→ </span>
                <BingoBadge /> <strong className="bingo-move-word"><DefinitionWord word={bingo.word} /> {bingo.score}</strong>
                {" · "}{!exact && !chance
                  ? "No hits in reply sample"
                  : `${exact ? "" : "≈"}${percent(chance)} after reply`}
              </span>
              {selected === move.id && (
                <button type="button" className="button secondary" data-move-preview-action onClick={() => onPlay(move)}>
                  Play <DefinitionWord word={move.word} />
                </button>
              )}
            </div>
            <small>
              Draw {draw || "no tiles"} ({percent(drawChance)}) · {needsReply
                ? "Needs an opening from the reply"
                : `Given that draw, opponent can bingo in this lane ${percent(laneBingoChance)} or block the placement ${percent(blockChance)}`}
              {" · "}{exact ? `${cases} possible deals` : `${cases} sampled reply racks`}
            </small>
          </li>
        ))}
      </ul>
    </details>
  );
}
