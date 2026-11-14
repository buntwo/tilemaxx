import {
  tileScore,
  type Move,
  type Position,
  type Rules,
} from "../../shared/model";
import { rackSlotsForMove } from "../../shared/rack-entry";

export function canAnimateTiles() {
  return (
    typeof Element.prototype.animate === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function rackTileRects(rack: HTMLElement, slots: number[]) {
  return slots.map((slot) =>
    rack.querySelector(`[data-rack-slot="${slot}"]`)?.getBoundingClientRect(),
  );
}

function tileVisible(rect: DOMRect | undefined): boolean {
  const viewport = window.visualViewport;
  const width = viewport?.width ?? window.innerWidth;
  const height = viewport?.height ?? window.innerHeight;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  return (
    !!rect &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.right > left &&
    rect.bottom > top &&
    rect.left < left + width &&
    rect.top < top + height
  );
}

export function prepareTileFlight(
  game: Position,
  move: Move,
  rack: HTMLElement | null,
  board: HTMLElement | null,
) {
  if (!canAnimateTiles()) return;
  const slots = rackSlotsForMove(game, move.tiles);
  if (!slots) return;
  const sources = rack ? rackTileRects(rack, slots) : [];
  const reveal =
    window.matchMedia("(max-width: 650px)").matches ||
    !sources.every(tileVisible) ||
    !move.tiles.every(({ index }) =>
      tileVisible(
        board?.querySelector(`[data-cell="${index}"]`)?.getBoundingClientRect(),
      ),
    );
  return { reveal, slots };
}

export async function revealTileTargets(
  board: HTMLElement,
  move: Move,
  signal: AbortSignal,
) {
  const grid = board.querySelector(".board-grid");
  if (!grid) return;
  const rect = grid.getBoundingClientRect();
  const height = window.visualViewport?.height ?? window.innerHeight;
  const top = 12;
  const bottom = height - 12;
  if (rect.top >= top && rect.bottom <= bottom) return;
  const targets = move.tiles.flatMap(({ index }) => {
    const tile = board.querySelector(`[data-cell="${index}"]`);
    return tile ? [tile.getBoundingClientRect()] : [];
  });
  const targetTop = targets.length
    ? Math.min(...targets.map((tile) => tile.top))
    : rect.top;
  const targetBottom = targets.length
    ? Math.max(...targets.map((tile) => tile.bottom))
    : rect.bottom;
  const offset =
    rect.height <= bottom - top
      ? rect.top < top
        ? rect.top - top
        : rect.bottom - bottom
      : targetTop < top || targetBottom > bottom
        ? (targetTop + targetBottom - height) / 2
        : 0;
  if (Math.abs(offset) < 1) return;
  window.scrollBy({ top: offset, behavior: "instant" });
  await new Promise<void>((resolve) => {
    const frame = requestAnimationFrame(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    });
    function abort() {
      cancelAnimationFrame(frame);
      resolve();
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function flyTiles(
  board: HTMLElement,
  tiles: Move["tiles"],
  sources: ReturnType<typeof rackTileRects>,
  rules: Rules,
  onFinish: () => void,
) {
  const viewport = window.visualViewport;
  const paths = tiles.map(({ index, letter }, i) => ({
    source: sources[i],
    target: board.querySelector<HTMLElement>(`[data-cell="${index}"]`),
    letter,
  }));
  const flights = paths.flatMap(({ source, target, letter }) => {
    const end = target?.getBoundingClientRect();
    if (
      !target ||
      !end ||
      !tileVisible(end) ||
      !source?.width ||
      !source.height
    )
      return [];
    // On short screens the rack can sit just beyond the revealed board.
    // Start at the nearest viewport edge while keeping the rack column.
    const top = viewport?.offsetTop ?? 0;
    const bottom = top + (viewport?.height ?? window.innerHeight);
    const start = tileVisible(source)
      ? source
      : {
          left: source.left,
          top: source.top < top ? top - source.height : bottom,
          width: source.width,
          height: source.height,
        };
    return [{ source: start, end, letter }];
  });
  if (!flights.length) return;

  const layer = document.createElement("div");
  layer.className = "tile-flight-layer";
  layer.setAttribute("aria-hidden", "true");
  document.body.append(layer);
  let cancelled = false;
  const animations = flights.map(({ source, end, letter }, i) => {
    const blank = letter !== letter.toUpperCase();
    const tile = document.createElement("span");
    tile.className = `flying-tile${blank ? " blank" : ""}`;
    tile.textContent = letter.toUpperCase();
    const points = document.createElement("small");
    points.textContent = String(tileScore(letter, rules));
    tile.append(points);
    Object.assign(tile.style, {
      left: `${source.left}px`,
      top: `${source.top}px`,
      width: `${source.width}px`,
      height: `${source.height}px`,
      fontSize: `${Math.min(23, source.width * 0.56)}px`,
    });
    layer.append(tile);
    const dx = end.left - source.left;
    const dy = end.top - source.top;
    const animation = tile.animate(
      [
        { transform: "translate(0,0) scale(1)" },
        {
          transform: `translate(${dx * 0.46}px,${dy * 0.55 - 13}px) rotate(-4deg) scale(.88)`,
          offset: 0.52,
        },
        {
          transform: `translate(${dx}px,${dy}px) scale(${end.width / source.width},${end.height / source.height})`,
        },
      ],
      {
        duration: 460,
        delay: i * 62,
        easing: "cubic-bezier(.25,.05,.26,1)",
        fill: "both",
      },
    );
    return animation;
  });

  function stop() {
    if (cancelled) return;
    cancelled = true;
    for (const animation of animations) animation.cancel();
    layer.remove();
    window.removeEventListener("resize", finish);
    window.removeEventListener("scroll", finish, true);
    viewport?.removeEventListener("resize", finish);
  }
  function finish() {
    if (cancelled) return;
    stop();
    onFinish();
  }
  window.addEventListener("resize", finish);
  window.addEventListener("scroll", finish, true);
  viewport?.addEventListener("resize", finish);
  void Promise.all(animations.map((animation) => animation.finished)).then(
    finish,
    finish,
  );
  return stop;
}
