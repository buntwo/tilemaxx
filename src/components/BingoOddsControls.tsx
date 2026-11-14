import { useState, type ReactNode } from "react";
import {
  BOARD_ODDS_LIMIT,
  type BoardOddsResult,
  type RackOdds,
} from "../../shared/bingo-odds";
import { type Game, type Move } from "../../shared/model";
import { unseenTiles } from "../../shared/tile-pool";

export default function BingoOddsControls({
  game,
  moves,
  shortlist,
  settings,
  sortControl,
  rackOdds,
  rackOddsPending,
  boardOdds,
  progress,
  error,
  onCheck,
  onCancel,
}: {
  game: Game;
  moves: Move[];
  shortlist?: boolean;
  settings?: ReactNode;
  sortControl?: ReactNode;
  rackOdds?: RackOdds;
  rackOddsPending?: boolean;
  boardOdds?: BoardOddsResult;
  progress?: { checked: number; total: number };
  error?: string;
  onCheck: (moves: Move[], bagSize: number) => void;
  onCancel: () => void;
}) {
  const { total, excess } = unseenTiles(game, game.template);
  const assumedBag = Math.max(0, total - game.template.rackSize);
  const [override, setOverride] = useState("");
  const bag = override === "" ? assumedBag : Number(override);
  const valid = Number.isInteger(bag) && bag >= assumedBag && bag <= total;

  return (
    <div className="bingo-odds-controls">
      <div className="bingo-odds-actions">
        {progress ? (
          <>
            <button
              type="button"
              className="button secondary"
              onClick={onCancel}
            >
              Cancel bingo check
            </button>
            <span className="analysis-counter" role="status">
              {progress.checked} / {progress.total} checked
            </span>
          </>
        ) : (
          <button
            type="button"
            className="button secondary"
            disabled={
              !moves.length || rackOddsPending || !valid || !!excess.length
            }
            onClick={() =>
              onCheck(shortlist ? moves : moves.slice(0, BOARD_ODDS_LIMIT), bag)
            }
          >
            Check bingo after your play
          </button>
        )}
        {sortControl}
        <details className="bingo-odds-settings">
          <summary>Options</summary>
          <div className="bingo-odds-options">
            <p>
              <strong>Bingo draw %</strong> is the chance your refilled rack
              spells a {game.template.rackSize}-letter dictionary word. The bag
              estimate updates with the board and rack. It sets aside up to{" "}
              {game.template.rackSize} unseen tiles for one opponent and leaves
              the rest in the bag ({assumedBag} right now).
            </p>
            <p>
              <strong>Bingo after your play</strong> checks the full shortlist
              in shortlist view, or up to {BOARD_ODDS_LIMIT} moves from the
              current sort and filter. It counts refills that allow a bingo on
              the board before the opponent replies. An ≈ marks an estimate
              based on 200 refills.
            </p>
            <p>
              <strong>Bingo after opponent reply</strong> in Analyze checks
              again after simulating the opponent’s move.
            </p>
            <label>
              Tiles in bag for this check
              <input
                type="number"
                min={assumedBag}
                max={total}
                inputMode="numeric"
                placeholder={String(assumedBag)}
                value={override}
                disabled={!!progress}
                onChange={(event) => setOverride(event.target.value)}
              />
            </label>
            {!valid && (
              <p className="error">
                Enter a count from {assumedBag} to {total}.
              </p>
            )}
            {boardOdds && (
              <p>This check used {boardOdds.bagSize} tiles in the bag.</p>
            )}
            {settings}
          </div>
        </details>
      </div>
      {boardOdds && !progress && (
        <span className="bingo-odds-status" role="status">
          Bingo after your play · {boardOdds.checked} / {boardOdds.total} moves
          {boardOdds.checked < boardOdds.total && " · search limit reached"}
        </span>
      )}
      {rackOddsPending && (
        <span className="bingo-odds-status" role="status">
          Calculating bingo draws…
        </span>
      )}
      {rackOdds?.error && (
        <p className="bingo-odds-status" role="status">
          {rackOdds.error}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
