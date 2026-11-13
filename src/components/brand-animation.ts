import { tileScore } from "../../shared/model";

export const BRAND_WORD = "tilemaxx";
export const BRAND_RETURN_PAUSE = 500;

const effects = [
  "wipe",
  "pixels",
  "flip-horizontal",
  "flip-vertical",
  "reel",
  "bloom",
  "scan",
  "shuffle",
  "snap",
] as const;
type Effect = (typeof effects)[number];
type SequenceEffect = Extract<
  Effect,
  "shuffle" | "reel" | "flip-horizontal" | "flip-vertical"
>;

const ink = "var(--text)";
const highlight = "var(--brand-highlight)";

function face(index: number) {
  const tile = document.createElement("span");
  tile.className = "brand-face";
  const letter = BRAND_WORD[index].toUpperCase();
  const score = document.createElement("small");
  score.textContent = String(tileScore(letter, "scrabble"));
  tile.append(letter, score);
  return tile;
}

function layer(className: string) {
  const element = document.createElement("span");
  element.className = className;
  return element;
}

function slotFrames(
  property: "color" | "visibility",
  on: string,
  off: string,
  position: number,
  steps: number,
  lead: number,
): Keyframe[] {
  // For continuous motion the next letter takes over at the midpoint.
  const frames: Keyframe[] = [
    { [property]: position === 0 ? on : off, offset: 0, easing: "step-end" },
  ];
  if (position > 0) {
    frames.push({
      [property]: on,
      offset: (position - lead) / steps,
      easing: "step-end",
    });
  }
  if (position < steps) {
    frames.push({ [property]: off, offset: (position + 1 - lead) / steps });
  }
  if (frames.at(-1)?.offset !== 1) {
    frames.push({ [property]: position === steps ? on : off, offset: 1 });
  }
  return frames;
}

export function animateBrandReturn(
  tile: HTMLElement,
  word: HTMLElement,
  from: number,
  to: number,
  onFinish: () => void,
) {
  if (
    !tile.animate ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    onFinish();
    return;
  }

  const effect = effects[Math.floor(Math.random() * effects.length)];
  const letters = word.children;
  const scene = layer("brand-motion");
  scene.dataset.effect = effect;
  tile.append(scene);
  tile.dataset.returning = "";
  const animations: Animation[] = [];

  function play(
    element: Element,
    frames: Keyframe[],
    duration: number,
    easing = "linear",
  ) {
    const animation = element.animate(frames, {
      duration,
      easing,
      fill: "both",
    });
    animations.push(animation);
    return animation;
  }

  function sequence(effect: SequenceEffect) {
    const steps = Math.abs(to - from);
    const direction = Math.sign(to - from);
    const reel = effect === "reel";
    const shuffle = effect === "shuffle";
    const axis = effect === "flip-horizontal" ? "Y" : "X";
    const longReturn = steps >= 4;
    const lead = shuffle ? 0 : 0.5;
    const easing = shuffle
      ? "linear"
      : longReturn
        ? "cubic-bezier(.21,0,.60,1)"
        : "cubic-bezier(.13,0,.72,1)";
    // Flat endpoints start and stop at rest. The extra time preserves peak speed.
    const timePerLetter = shuffle
      ? 95
      : (reel ? 125 : 145) * (longReturn ? 1.11146 : 1.09159);
    const duration = steps * timePerLetter;
    const strip = reel ? layer("brand-reel-strip") : scene;
    if (reel) scene.append(strip);

    for (let position = 0; position <= steps; position++) {
      const index = from + position * direction;
      const tileFace = face(index);
      strip.append(tileFace);
      if (reel) {
        tileFace.style.transform = `translateY(${-direction * position * 100}%)`;
      } else {
        if (!shuffle)
          tileFace.style.transform = `rotate${axis}(${(position % 2) * 180}deg)`;
        play(
          tileFace,
          slotFrames("visibility", "visible", "hidden", position, steps, lead),
          duration,
          easing,
        );
      }
      play(
        letters[index],
        slotFrames("color", highlight, ink, position, steps, lead),
        duration,
        easing,
      );
    }

    if (shuffle) return animations[0];
    const start = reel ? "translateY(0%)" : `rotate${axis}(0deg)`;
    const end = reel
      ? `translateY(${direction * steps * 100}%)`
      : `rotate${axis}(${direction * steps * 180}deg)`;
    return play(
      strip,
      [{ transform: start }, { transform: end }],
      duration,
      easing,
    );
  }

  function transition() {
    const duration = effect === "bloom" ? 680 : effect === "pixels" ? 480 : 420;
    const incoming = face(to);
    scene.append(face(from), incoming);

    function swapFace(offset: number) {
      play(
        incoming,
        [
          { opacity: 0, offset: 0, easing: "step-end" },
          { opacity: 1, offset },
          { opacity: 1, offset: 1 },
        ],
        duration,
      );
    }

    switch (effect) {
      case "wipe":
      case "scan": {
        const horizontal = effect === "wipe";
        const axis = horizontal ? "X" : "Y";
        const length = horizontal ? tile.clientWidth : tile.clientHeight;
        const overlay = layer("brand-effect-overlay");
        const line = layer("brand-scanline");
        scene.append(overlay);
        overlay.append(line);
        play(
          incoming,
          [
            {
              clipPath: horizontal ? "inset(0 100% 0 0)" : "inset(0 0 100% 0)",
            },
            { clipPath: "inset(0 0 0 0)" },
          ],
          duration,
        );
        play(
          line,
          [
            { transform: `translate${axis}(0px)`, opacity: 0 },
            {
              transform: `translate${axis}(${length * 0.1}px)`,
              opacity: 1,
              offset: 0.1,
            },
            {
              transform: `translate${axis}(${length * 0.9}px)`,
              opacity: 1,
              offset: 0.9,
            },
            { transform: `translate${axis}(${length}px)`, opacity: 0 },
          ],
          duration,
        );
        break;
      }
      case "pixels": {
        const overlay = layer("brand-effect-overlay brand-pixel-grid");
        scene.append(overlay);
        swapFace(0.48);
        for (let i = 0; i < 25; i++) {
          const pixel = layer("brand-pixel");
          pixel.style.setProperty("--pixel-tint", `${12 + ((i * 13) % 51)}%`);
          overlay.append(pixel);
          const delay = ((i * 17) % 25) / 140;
          play(
            pixel,
            [
              { opacity: 0, offset: 0 },
              { opacity: 0, offset: delay, easing: "step-end" },
              { opacity: 1, offset: delay + 0.12 },
              { opacity: 1, offset: 0.54 + delay, easing: "step-end" },
              { opacity: 0, offset: 0.74 + delay },
              { opacity: 0, offset: 1 },
            ],
            duration,
          );
        }
        break;
      }
      case "bloom": {
        const easing = "cubic-bezier(.4,0,.55,1)";
        const overlay = layer("brand-effect-overlay");
        const edge = layer("brand-bloom-edge");
        scene.append(overlay);
        overlay.append(edge);
        play(
          incoming,
          [
            { clipPath: "circle(0% at 50% 50%)" },
            { clipPath: "circle(73% at 50% 50%)" },
          ],
          duration,
          easing,
        );
        play(
          edge,
          [
            { transform: "translate(-50%, -50%) scale(0)", opacity: 0 },
            {
              transform: "translate(-50%, -50%) scale(.52)",
              opacity: 0.8,
              offset: 0.52,
            },
            { transform: "translate(-50%, -50%) scale(1)", opacity: 0 },
          ],
          duration,
          easing,
        );
        break;
      }
      case "snap":
        play(
          scene,
          [
            { transform: "scale(1) rotate(0)" },
            { transform: "scale(.72) rotate(-10deg)", offset: 0.43 },
            { transform: "scale(1.11) rotate(7deg)", offset: 0.7 },
            { transform: "scale(1) rotate(0)" },
          ],
          duration,
          "ease-in-out",
        );
        swapFace(0.43);
        break;
    }

    const frames = (start: string, end: string) => [
      { color: start },
      { color: start, offset: 0.24 },
      { color: end, offset: 0.76 },
      { color: end },
    ];
    const easing = "cubic-bezier(.52,0,.41,1)";
    play(letters[from], frames(highlight, ink), duration, easing);
    return play(letters[to], frames(ink, highlight), duration, easing);
  }

  const motion =
    effect === "shuffle" ||
    effect === "reel" ||
    effect === "flip-horizontal" ||
    effect === "flip-vertical"
      ? sequence(effect)
      : transition();
  let cancelled = false;
  motion.finished.then(
    () => {
      if (!cancelled) onFinish();
    },
    () => {},
  );

  return () => {
    cancelled = true;
    for (const animation of animations) animation.cancel();
    scene.remove();
    delete tile.dataset.returning;
  };
}
