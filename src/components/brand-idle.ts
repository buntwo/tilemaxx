const effects = [
  "hop",
  "wink",
  "shimmy",
  "sweep",
  "bow",
  "score",
  "orbit",
  "glow",
  "curl",
  "echo",
] as const;

export function attachBrandIdle(
  button: HTMLButtonElement,
  tile: HTMLElement,
  onFire: boolean,
  isPreviewing: () => boolean,
) {
  if (typeof tile.animate !== "function") return;
  const brand = button.parentElement!;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let stopEffect: (() => void) | undefined;

  function stop() {
    stopEffect?.();
    stopEffect = undefined;
  }

  function tick() {
    if (
      document.hidden ||
      motion.matches ||
      !button.getClientRects().length ||
      brand.matches(":hover, :focus-within") ||
      isPreviewing() ||
      button.getAnimations?.({ subtree: true }).length
    )
      return;
    stopEffect = playIdleEffect(tile, onFire);
  }

  const timer = window.setInterval(tick, 60_000);
  brand.addEventListener("pointerenter", stop);
  brand.addEventListener("pointerdown", stop);
  brand.addEventListener("focusin", stop);
  document.addEventListener("visibilitychange", stop);
  motion.addEventListener("change", stop);
  return () => {
    window.clearInterval(timer);
    stop();
    brand.removeEventListener("pointerenter", stop);
    brand.removeEventListener("pointerdown", stop);
    brand.removeEventListener("focusin", stop);
    document.removeEventListener("visibilitychange", stop);
    motion.removeEventListener("change", stop);
  };
}

function playIdleEffect(tile: HTMLElement, onFire: boolean) {
  const effect = effects[Math.floor(Math.random() * effects.length)];
  const animations: Animation[] = [];
  const layers: HTMLElement[] = [];
  const gain = onFire ? 2.25 : 1;
  const px = (value: number) => `${value * gain}px`;
  const deg = (value: number) => `${value * gain}deg`;
  const opacity = (value: number) => Math.min(1, value * gain);
  const rest = { transform: "rotate(-7deg)" };
  tile.dataset.idleEffect = effect;

  function layer(name: string) {
    const element = document.createElement("span");
    element.className = `brand-idle brand-idle-${name}`;
    tile.append(element);
    layers.push(element);
    return element;
  }

  function play(
    element: Element,
    frames: Keyframe[],
    duration: number,
    easing = "ease-in-out",
    delay = 0,
  ) {
    animations.push(element.animate(frames, { duration, easing, delay }));
  }

  function move(frames: Keyframe[], duration: number) {
    play(
      tile,
      [
        rest,
        ...frames.map((frame) => ({
          ...frame,
          transform: `rotate(-7deg) ${frame.transform}`,
        })),
        rest,
      ],
      duration,
    );
  }

  switch (effect) {
    case "hop":
      move(
        [
          { transform: "scale(1.035,.96)", offset: 0.16, easing: "ease-out" },
          {
            transform: `translateY(${px(-4)})`,
            offset: 0.46,
            easing: "ease-in",
          },
          { transform: "scale(1.035,.96)", offset: 0.78 },
        ],
        580,
      );
      break;
    case "wink":
      play(
        layer("glint"),
        [
          { opacity: 0, transform: "scale(.15) rotate(-15deg)" },
          {
            opacity: opacity(0.65),
            transform: `scale(${Math.min(gain, 1.75)})`,
            offset: 0.34,
          },
          { opacity: 0, transform: "scale(.55) rotate(14deg)" },
        ],
        640,
      );
      break;
    case "shimmy":
      move(
        [
          {
            transform: `translateX(${px(-1)}) rotate(${deg(-5)})`,
            offset: 0.23,
          },
          { transform: `translateX(${px(1)}) rotate(${deg(4)})`, offset: 0.49 },
          { transform: `rotate(${deg(-2)})`, offset: 0.73 },
        ],
        580,
      );
      break;
    case "sweep":
      play(
        layer("sheen"),
        [
          { backgroundPosition: "100% 0", opacity: 0 },
          { opacity: opacity(0.36), offset: 0.26 },
          { opacity: opacity(0.32), offset: 0.68 },
          { backgroundPosition: "0% 0", opacity: 0 },
        ],
        700,
        "ease-out",
      );
      break;
    case "bow":
      move(
        [
          {
            transform: `perspective(100px) translateY(${px(-2)}) rotateX(${deg(-16)})`,
            offset: 0.52,
          },
        ],
        690,
      );
      break;
    case "score": {
      const points = tile.querySelector("small")!;
      play(
        points,
        [
          { opacity: 1, transform: "none" },
          {
            opacity: 0.75,
            transform: `translateY(${px(-2)}) scale(${1 + gain * 0.16})`,
            offset: 0.42,
          },
          { opacity: 1, transform: "none" },
        ],
        520,
      );
      break;
    }
    case "orbit": {
      const radius = 21 + (gain - 1) * 11;
      const arc = (size: number, brightness: number) =>
        Array.from({ length: 25 }, (_, index) => {
          const progress = index / 24;
          const angle = Math.PI * (1 - progress);
          const x = radius * Math.cos(angle);
          const y = -radius * Math.sin(angle);
          const fade = Math.min(1, progress * 8, (1 - progress) * 8);
          return {
            transform: `translate(${x}px, ${y}px) scale(${size})`,
            opacity: brightness * fade,
          };
        });
      play(layer("mote"), arc(onFire ? 1.4 : 1, onFire ? 1 : 0.78), 790);
      if (onFire) {
        for (let index = 0; index < 4; index++) {
          play(
            layer("trail"),
            arc(1.05 - index * 0.16, 0.7 - index * 0.14),
            790,
            "ease-in-out",
            (index + 1) * 30,
          );
        }
      }
      break;
    }
    case "glow":
      play(
        layer("wash"),
        [
          { opacity: 0 },
          { opacity: opacity(0.34), offset: 0.46 },
          { opacity: 0 },
        ],
        850,
      );
      break;
    case "curl":
      play(
        layer("corner"),
        [
          { opacity: 0, transform: "scale(.15)" },
          {
            opacity: opacity(0.74),
            transform: `scale(${1 + (gain - 1) * 0.46})`,
            offset: 0.45,
          },
          { opacity: 0, transform: "scale(.15)" },
        ],
        675,
      );
      break;
    case "echo":
      play(
        layer("echo"),
        [
          { opacity: 0, transform: "scale(1)" },
          { opacity: opacity(0.46), offset: 0.24 },
          { opacity: 0, transform: `scale(${1 + gain * 0.28})` },
        ],
        680,
        "ease-out",
      );
      break;
  }

  if (onFire && (effect === "wink" || effect === "glow")) {
    play(
      tile.querySelector(".brand-flame")!,
      [
        { transform: "none" },
        {
          transform: `rotate(${deg(11)}) scale(1.03,${1 + gain * 0.31})`,
          offset: 0.27,
        },
        { transform: `rotate(${deg(-8)}) scale(1.13,1.2)`, offset: 0.56 },
        { transform: `rotate(${deg(4)}) scale(.96,1.12)`, offset: 0.77 },
        { transform: "none" },
      ],
      690,
    );
    const paths = [
      [-8, -12],
      [7, -14],
      [-3, -10],
      [12, -9],
    ];
    paths.forEach(([drift, rise], index) => {
      play(
        layer("ember"),
        [
          {
            transform: `translateX(${(index - 1) * 3}px) scale(.55)`,
            opacity: 0,
          },
          { opacity: opacity(0.53), offset: 0.19 },
          {
            transform: `translate(${px(drift)}, ${px(rise)}) scale(.6)`,
            opacity: 0,
          },
        ],
        570,
        "ease-out",
        index * 55,
      );
    });
  }

  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    for (const animation of animations) animation.cancel();
    for (const element of layers) element.remove();
    delete tile.dataset.idleEffect;
  }
  void Promise.allSettled(
    animations.map((animation) => animation.finished),
  ).then(stop);
  return stop;
}
