const random = (min: number, max: number) => min + Math.random() * (max - min);

export function attachBrandSparkle(
  button: HTMLButtonElement,
  tile: HTMLElement,
  onFire: boolean,
) {
  if (typeof tile.animate !== "function") return;

  const motionPreference = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  const layer = document.createElement("span");
  layer.className = "brand-sparkle";
  layer.setAttribute("aria-hidden", "true");
  button.append(layer);

  const flecksPerSecond = onFire ? 25 : 10;
  const burstSize = onFire ? 84 : 56;
  const particleLimit = 180;
  const particles = new Map<HTMLElement, Animation>();
  let hovering = false;
  let interval: number | undefined;
  let press: Animation | undefined;

  function emit(count: number, burst = false) {
    if (document.hidden) return;
    const still = motionPreference.matches;
    if (burst && particles.size + count > particleLimit) {
      for (const [particle, animation] of particles) {
        animation.cancel();
        particle.remove();
        particles.delete(particle);
        if (particles.size + count <= particleLimit) break;
      }
    }
    const available = Math.min(count, particleLimit - particles.size);
    for (let i = 0; i < available; i++) {
      const particle = document.createElement("span");
      const glint = Math.random() < 0.12;
      particle.className = glint ? "brand-glint" : "brand-fleck";
      particle.style.width = `${glint ? random(4, 6) : random(1.3, 3.3)}px`;
      const x = random(5, 92);
      particle.style.left = `${x}%`;
      particle.style.top = `${random(0, burst ? 77 : 64)}%`;
      layer.append(particle);

      const peak = burst ? random(0.62, 1) : random(0.45, 0.86);
      const drift = burst ? (x - 50) / 3 + random(-9, 9) : random(-6, 6);
      const rise = burst ? random(-38, -15) : random(-18, -8);
      const frames = still
        ? [{ opacity: peak }, { opacity: peak }]
        : [
            { transform: "translateY(2px) scale(.65)", opacity: 0 },
            { opacity: peak, offset: burst ? 0.16 : 0.25 },
            {
              transform: `translate(${drift}px, ${rise}px) scale(.72)`,
              opacity: 0,
            },
          ];
      const animation = particle.animate(frames, {
        duration: still ? 450 : burst ? random(490, 810) : random(480, 720),
        delay: still || !burst || i < 8 ? 0 : random(0, 125),
        easing: "ease-out",
        fill: "backwards",
      });
      particles.set(particle, animation);
      function remove() {
        particles.delete(particle);
        particle.remove();
      }
      animation.finished.then(remove, remove);
    }
  }

  function start() {
    if (interval !== undefined || document.hidden || motionPreference.matches)
      return;
    const period = 1000 / flecksPerSecond;
    emit(1);
    interval = window.setInterval(() => emit(1), period);
  }

  function stop() {
    window.clearInterval(interval);
    interval = undefined;
  }

  function clearParticles() {
    for (const animation of particles.values()) animation.cancel();
    particles.clear();
    layer.replaceChildren();
  }

  function enter(event: PointerEvent) {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    hovering = true;
    if (motionPreference.matches) emit(5);
    else start();
  }

  function leave() {
    hovering = false;
    stop();
  }

  function tap() {
    if (!motionPreference.matches) {
      const scale = Number.parseFloat(getComputedStyle(tile).scale) || 1;
      press?.cancel();
      press = tile.animate(
        [
          { scale },
          { scale: Math.min(scale, 0.87), offset: 0.32 },
          { scale: 1 },
        ],
        { duration: 175, easing: "cubic-bezier(.22,.65,.34,1)" },
      );
    }
    emit(motionPreference.matches ? 8 : burstSize, true);
  }

  function visibilityChanged() {
    if (document.hidden) {
      stop();
      clearParticles();
    } else if (hovering && button.matches(":hover")) {
      start();
    }
  }

  function motionChanged() {
    if (motionPreference.matches) {
      stop();
      press?.cancel();
      clearParticles();
    } else if (hovering) {
      start();
    }
  }

  button.addEventListener("pointerenter", enter);
  button.addEventListener("pointerleave", leave);
  button.addEventListener("click", tap);
  document.addEventListener("visibilitychange", visibilityChanged);
  motionPreference.addEventListener("change", motionChanged);

  return () => {
    stop();
    press?.cancel();
    clearParticles();
    layer.remove();
    button.removeEventListener("pointerenter", enter);
    button.removeEventListener("pointerleave", leave);
    button.removeEventListener("click", tap);
    document.removeEventListener("visibilitychange", visibilityChanged);
    motionPreference.removeEventListener("change", motionChanged);
  };
}
