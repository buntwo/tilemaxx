import { useEffect, useRef, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import {
  BOARD_ODDS_LIMIT,
  type BoardOddsResult,
  type RackOdds,
} from "../../shared/bingo-odds";
import { type Game, type Move } from "../../shared/model";
import type { BoardOddsProgress } from "../useSolver";

export function MoveListOptions({ children }: { children: ReactNode }) {
  return (
    <details
      className="bingo-odds-settings"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !event.currentTarget.open) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }}
    >
      <summary aria-label="Options" title="Options">
        <SlidersHorizontal
          className="bingo-odds-settings-icon"
          size={16}
          aria-hidden="true"
        />
        Options
      </summary>
      <div className="bingo-odds-options">{children}</div>
    </details>
  );
}

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
  toolbarOptions,
  inlineSearch,
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
  toolbarOptions?: ReactNode;
  inlineSearch?: boolean;
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
        {inlineSearch && searchField}
        <div className="bingo-odds-utilities">
          <MoveListOptions>
            {toolbarOptions}
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
                        onCheck(manualMoves.slice(0, BOARD_ODDS_LIMIT), bagSize)
                      }
                    >
                      Check bingo after your play
                    </button>
                  )
                )}
                <p>
                  <strong>Bingo draw %</strong> is the chance your refilled rack
                  spells a {game.template.rackSize}-letter dictionary word.{" "}
                  {game.solo ? (
                    `The bag contains all ${bagSize} unseen tiles.`
                  ) : (
                    <>
                      The bag estimate updates with the board and rack. It sets
                      aside up to {game.template.rackSize} unseen tiles for one
                      opponent and leaves the rest in the bag (estimated{" "}
                      {minimumBag} right now).
                    </>
                  )}
                </p>
                <p>
                  <strong>Bingo after your play</strong> automatically checks up
                  to {BOARD_ODDS_LIMIT} of the highest-scoring moves
                  {game.solo ? ". " : " after reply analysis finishes. "}
                  {manualMoves && "A manual check uses the current list. "}
                  It counts refills that allow a bingo on the board immediately
                  after your move. An ≈ marks an estimate based on up to 200
                  sampled refills.
                </p>
                {!game.solo && (
                  <p>
                    <strong>Bingo after opponent reply</strong> in Analyze
                    checks again after simulating the opponent’s move.
                  </p>
                )}
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
          </MoveListOptions>
          {toolbarEnd}
        </div>
      </div>
      {!inlineSearch && searchField}
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
