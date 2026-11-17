import { Component, createRef, useState, type ReactNode } from "react";
import { canAnimateTiles } from "./tile-motion";

export function useMoveReview(
  narrow: boolean,
  searchId: number | undefined,
  playingReview: boolean | undefined,
) {
  const [dismissed, setDismissed] = useState<number>();
  return {
    showing:
      narrow &&
      (playingReview ?? (searchId !== undefined && dismissed !== searchId)),
    open: () => setDismissed(undefined),
    dismiss: () => setDismissed(searchId),
  };
}

type Props = { narrow: boolean; reviewing: boolean; children: ReactNode };
type Snapshot = Map<HTMLElement, DOMRect> | null;

function bounds(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return new DOMRect(
    rect.left + window.scrollX,
    rect.top + window.scrollY,
    rect.width,
    rect.height,
  );
}

export default class GameWorkspace extends Component<Props, object, Snapshot> {
  private root = createRef<HTMLDivElement>();
  private animations = new Set<Animation>();

  getSnapshotBeforeUpdate(previous: Props): Snapshot {
    if (
      !this.root.current ||
      !this.props.narrow ||
      !previous.narrow ||
      this.props.reviewing === previous.reviewing
    )
      return null;
    const snapshot = new Map<HTMLElement, DOMRect>();
    if (canAnimateTiles()) {
      for (const element of this.root.current.querySelectorAll<HTMLElement>(
        ".board-panel, [data-rack-slot], .opponent-rack-tiles span, .results-column",
      ))
        snapshot.set(element, bounds(element));
    }
    return snapshot;
  }

  componentDidUpdate(previous: Props, _state: object, snapshot: Snapshot) {
    if (!this.props.narrow || !snapshot) {
      if (previous.narrow && !this.props.narrow) this.stopMotion();
      return;
    }
    // Measure the old layout before React moves it, including any in-flight
    // transforms so a quick reversal can start from the current positions.
    this.stopMotion();
    const root = this.root.current;
    if (root && this.props.reviewing) {
      const boardTop =
        root.querySelector(".board-panel")?.getBoundingClientRect().top ?? 0;
      const firstMove = root
        .querySelector(".result-row")
        ?.getBoundingClientRect();
      if (
        boardTop < 0 ||
        (boardTop > 8 && firstMove && firstMove.bottom > window.innerHeight)
      )
        root.scrollIntoView?.({
          block: "start",
          behavior: snapshot.size ? "smooth" : "instant",
        });
    }
    for (const [element, before] of snapshot) {
      if (!element.isConnected) continue;
      const after = bounds(element);
      if (!after.width || !after.height || !before.width || !before.height)
        continue;
      const shift = `translate(${before.x - after.x}px, ${before.y - after.y}px)`;
      const scale = element.classList.contains("results-column")
        ? ""
        : ` scale(${before.width / after.width}, ${before.height / after.height})`;
      const animation = element.animate(
        [{ transform: shift + scale }, { transform: "none" }],
        { duration: 320, easing: "cubic-bezier(.22,.8,.25,1)" },
      );
      this.animations.add(animation);
      const release = () => this.animations.delete(animation);
      animation.finished.then(release, release);
    }
  }

  private stopMotion() {
    for (const animation of this.animations) animation.cancel();
    this.animations.clear();
  }

  componentWillUnmount() {
    this.stopMotion();
  }

  render() {
    return (
      <div
        ref={this.root}
        className={`workspace-grid${this.props.reviewing ? " move-review" : ""}`}
      >
        {this.props.children}
      </div>
    );
  }
}
