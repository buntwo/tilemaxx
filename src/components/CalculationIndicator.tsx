import { useEffect, useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";

type Phase = "idle" | "active" | "settling";

export default function CalculationIndicator({ active }: { active: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  useEffect(() => {
    if (active) {
      setPhase("active");
      return;
    }
    // Hold through worker handoffs, then keep spinning during the exit.
    if (phase !== "idle") {
      const timer = setTimeout(
        () => setPhase(phase === "active" ? "settling" : "idle"),
        phase === "active" ? 140 : 230,
      );
      return () => clearTimeout(timer);
    }
  }, [active, phase]);

  return (
    <span
      className="calculation-indicator"
      data-phase={active ? "active" : phase}
    >
      <span className="calculation-star" aria-hidden="true">
        <Sparkles />
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
