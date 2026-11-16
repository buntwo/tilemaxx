import { useState, type CSSProperties } from "react";
import { coordinate } from "../../shared/model";
import type { MoveTiming } from "../move-timing";
import Modal from "./Modal";

function duration(ms: number) {
  if (ms > 0 && ms < 1) return "<1 ms";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function TimingValue({ elapsed, total }: { elapsed: number; total: number }) {
  const share = total > 0 ? Math.min(1, elapsed / total) : 0;
  return (
    <dd style={{ "--timing-bar-width": `${share * 100}%` } as CSSProperties}>
      {duration(elapsed)}
    </dd>
  );
}

export default function MoveTimingButton({
  timing,
  size,
}: {
  timing: MoveTiming;
  size: number;
}) {
  const [open, setOpen] = useState(false);
  const { total, solver, replies, estimates, exactLines } = timing;
  const formatted = duration(total);
  const stages: [string, number | undefined][] = [
    ["Dictionary loading and indexing", solver.dictionary],
    ["Board check and legal moves", solver.moves],
    ["Move list preparation", solver.indexing],
    ["Premium reply risk", solver.premiumReplies],
    ["Bingo draw odds", solver.bingoDraws],
    ["Bingo after your play", solver.boardBingo],
    ["Exchange advice", solver.exchangeAdvice],
    [replies?.endgame ? "Opponent replies" : "Reply histograms", replies?.elapsed],
    ["Endgame estimates", estimates],
    ["Exact endgame lines", exactLines?.elapsed],
  ];
  return (
    <>
      <button
        type="button"
        className="move-timing-button"
        aria-label={`Calculation timing, ${formatted}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {formatted}
      </button>
      {open && (
        <Modal
          title="Calculation timing"
          className="move-timing-dialog"
          onClose={() => setOpen(false)}
        >
          <dl className="move-timing-stages">
            <div className="move-timing-total">
              <dt>Total elapsed time</dt>
              <TimingValue elapsed={total} total={total} />
            </div>
            {stages.map(([label, elapsed]) =>
              elapsed === undefined ? null : (
                <div key={label}>
                  <dt>{label}</dt>
                  <TimingValue elapsed={elapsed} total={total} />
                </div>
              ),
            )}
          </dl>
          {!!exactLines?.attempts.length && (
            <section aria-label="Individual endgame solves">
              <h3>Individual endgame solves</h3>
              <dl className="move-timing-stages move-timing-attempts">
                {exactLines.attempts.map(({ move, elapsed, limit }) => (
                  <div key={move.id}>
                    <dt>
                      <strong>{move.word}</strong>{" "}
                      {coordinate(move.row * size + move.col, size)}
                      <span role="img" aria-label={move.direction}>
                        {move.direction === "across" ? "→" : "↓"}
                      </span>
                      {limit && <small title={limit}> · Limit reached</small>}
                    </dt>
                    <TimingValue elapsed={elapsed} total={total} />
                  </div>
                ))}
              </dl>
            </section>
          )}
          <p className="small muted">
            Total includes setup and worker handoffs. Some stages run in parallel.
          </p>
        </Modal>
      )}
    </>
  );
}
