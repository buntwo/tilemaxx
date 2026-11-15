import { useEffect, useRef, type ReactNode } from "react";
import {
  BOARD_ODDS_LIMIT,
  type BoardOddsResult,
  type RackOdds,
} from "../../shared/bingo-odds";
import { type Game, type Move } from "../../shared/model";
import type { BoardOddsProgress } from "../useSolver";

export default function BingoOddsControls({
  game,
  searchId,
  bagSize,
  minimumBag,
  repliesPending,
  invalid,
  moves,
  manualMoves,
  settings,
  toolbarStart,
  toolbarEnd,
  searchField,
  rackOdds,
  rackOddsPending,
  boardOdds,
  progress,
  error,
  onCheck,
  onCancel,
}: {
  game: Game;
  searchId: number;
  bagSize: number;
  minimumBag: number;
  repliesPending: boolean;
  invalid: boolean;
  moves: Move[];
  manualMoves?: Move[];
  settings?: ReactNode;
  toolbarStart?: ReactNode;
  toolbarEnd?: ReactNode;
  searchField?: ReactNode;
  rackOdds?: RackOdds;
  rackOddsPending?: boolean;
  boardOdds?: BoardOddsResult;
  progress?: BoardOddsProgress;
  error?: string;
  onCheck: (moves: Move[], bagSize: number) => void;
  onCancel: () => void;
}) {
  const lastCheck = useRef<string>(undefined);
  const canCheck = !rackOddsPending && !invalid;
  useEffect(() => {
    if (progress) {
      if (progress.bagSize !== bagSize) onCancel();
      return;
    }
    const key = `${searchId}:${bagSize}`;
    if (
      bagSize === 0 ||
      repliesPending ||
      !canCheck ||
      !moves.length ||
      lastCheck.current === key ||
      boardOdds?.bagSize === bagSize
    )
      return;
    lastCheck.current = key;
    onCheck(moves.slice(0, BOARD_ODDS_LIMIT), bagSize);
  }, [
    bagSize,
    boardOdds,
    canCheck,
    moves,
    onCancel,
    onCheck,
    progress,
    repliesPending,
    searchId,
  ]);

  return (
    <div className="bingo-odds-controls">
      <div className="bingo-odds-actions">
        {toolbarStart}
        <div className="bingo-odds-utilities">
          <details className="bingo-odds-settings">
            <summary>Options</summary>
            <div className="bingo-odds-options">
              {bagSize > 0 && (
                <>
                  {progress ? (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={onCancel}
                    >
                      Cancel bingo check
                    </button>
                  ) : (
                    manualMoves && (
                      <button
                        type="button"
                        className="button secondary"
                        disabled={!canCheck || !manualMoves.length}
                        onClick={() =>
                          onCheck(
                            manualMoves.slice(0, BOARD_ODDS_LIMIT),
                            bagSize,
                          )
                        }
                      >
                        Check bingo after your play
                      </button>
                    )
                  )}
                  <p>
                    <strong>Bingo draw %</strong> is the chance your refilled
                    rack spells a {game.template.rackSize}-letter dictionary
                    word. The bag estimate updates with the board and rack. It
                    sets aside up to {game.template.rackSize} unseen tiles for
                    one opponent and leaves the rest in the bag (estimated{" "}
                    {minimumBag} right now).
                  </p>
                  <p>
                    <strong>Bingo after your play</strong> automatically checks
                    up to {BOARD_ODDS_LIMIT} of the highest-scoring moves after
                    reply analysis finishes.{" "}
                    {manualMoves && "A manual check uses the current list. "}
                    It counts refills that allow a bingo on the board before the
                    opponent replies. An ≈ marks an estimate based on up to 200
                    sampled refills.
                  </p>
                  <p>
                    <strong>Bingo after opponent reply</strong> in Analyze
                    checks again after simulating the opponent’s move.
                  </p>
                  {boardOdds && !progress && (
                    <p>
                      Checked {boardOdds.checked} / {boardOdds.total} moves with{" "}
                      {boardOdds.bagSize} tiles in the bag.
                      {boardOdds.checked < boardOdds.total &&
                        " Search limit reached."}
                    </p>
                  )}
                </>
              )}
              {settings}
            </div>
          </details>
          {toolbarEnd}
        </div>
      </div>
      {searchField}
      {bagSize > 0 && rackOdds?.error && (
        <p className="bingo-odds-status" role="status">
          {rackOdds.error}
        </p>
      )}
      {bagSize > 0 && error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
