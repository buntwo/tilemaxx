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

function tileVisible(rect: DOMRect | undefined): rect is DOMRect {
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
  const compact =
    window.matchMedia("(max-width: 650px)").matches ||
    !rack ||
    !sources.every(tileVisible) ||
    !move.tiles.every(({ index }) =>
      tileVisible(
        board?.querySelector(`[data-cell="${index}"]`)?.getBoundingClientRect(),
      ),
    );
  return { compact, slots, sources: compact ? undefined : sources };
}

export function flyTiles(
  board: HTMLElement,
  tiles: Move["tiles"],
  sources: ReturnType<typeof rackTileRects>,
  rules: Rules,
  compact: boolean,
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
    return target && tileVisible(end) && tileVisible(source)
      ? [{ source, target, end, letter }]
      : [];
  });
  if (!flights.length) return;

  const layer = document.createElement("div");
  layer.className = "tile-flight-layer";
  layer.setAttribute("aria-hidden", "true");
  document.body.append(layer);
  let cancelled = false;
  const animations = flights.map(({ source, target, end, letter }, i) => {
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
    target.dataset.tileLanding = "";
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
    const finished = animation.finished.then(
      () => {
        delete target.dataset.tileLanding;
        tile.remove();
      },
      () => {},
    );
    return { target, animation, finished };
  });

  function stop() {
    if (cancelled) return;
    cancelled = true;
    for (const { target, animation } of animations) {
      delete target.dataset.tileLanding;
      animation.cancel();
    }
    layer.remove();
    window.removeEventListener("resize", finish);
    if (!compact) window.removeEventListener("scroll", finish, true);
    viewport?.removeEventListener("resize", finish);
  }
  function finish() {
    if (cancelled) return;
    stop();
    onFinish();
  }
  window.addEventListener("resize", finish);
  if (!compact) window.addEventListener("scroll", finish, true);
  viewport?.addEventListener("resize", finish);
  void Promise.all(animations.map(({ finished }) => finished)).then(finish);
  return stop;
}
