import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";

type Phase = "idle" | "active" | "settling";

export default function CalculationIndicator({
  active,
  idleIcon = <Sparkles />,
  onFindMoves,
  onQuiet,
}: {
  active: boolean;
  idleIcon?: ReactNode;
  onFindMoves?: () => void;
  onQuiet?: (stoppedAt: number) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const recording = !!onQuiet;
  const finish = useEffectEvent((stoppedAt: number) => onQuiet?.(stoppedAt));
  useEffect(() => {
    if (active) {
      setPhase("active");
      return;
    }
    // Hold through worker handoffs, then keep spinning during the exit.
    if (phase === "active") {
      const stoppedAt = performance.now();
      const timer = setTimeout(() => {
        finish(stoppedAt);
        setPhase("settling");
      }, 140);
      return () => clearTimeout(timer);
    }
    if (phase === "settling") {
      const timer = setTimeout(() => setPhase("idle"), 230);
      return () => clearTimeout(timer);
    }
    if (recording) finish(performance.now());
  }, [active, phase, recording]);

  const find = !active && phase === "idle" ? onFindMoves : undefined;

  return (
    <span
      className="calculation-indicator"
      data-phase={active ? "active" : phase}
    >
      <span className="calculation-idle-icon" aria-hidden={find ? undefined : true}>
        {find ? (
          <button
            type="button"
            className="calculation-find-moves"
            aria-label="Find moves shortcut"
            title="Find moves"
            onClick={find}
          >
            {idleIcon}
          </button>
        ) : idleIcon}
      </span>
      <span className="calculation-spinner" aria-hidden="true">
        <LoaderCircle />
      </span>
      <span className="calculation-announcement" aria-live="polite">
        {active ? "Calculating…" : ""}
      </span>
    </span>
  );
}
