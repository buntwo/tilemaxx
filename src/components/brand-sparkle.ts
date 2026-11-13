const random = (min: number, max: number) => min + Math.random() * (max - min);

export function attachBrandSparkle(tile: HTMLElement, onFire: boolean) {
  if (typeof tile.animate !== "function") return;

  const motionPreference = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  const layer = document.createElement("span");
  layer.className = "brand-sparkle";
  tile.append(layer);

  const flecksPerSecond = onFire ? 25 : 10;
  const burstSize = onFire ? 42 : 28;
  const particles = new Map<HTMLElement, Animation>();
  let hovering = false;
  let interval: number | undefined;

  function emit(count: number, spread = 0) {
    if (document.hidden) return;
    const still = motionPreference.matches;
    const available = Math.min(count, 64 - particles.size);
    for (let i = 0; i < available; i++) {
      const particle = document.createElement("span");
      const glint = Math.random() < 0.12;
      particle.className = glint ? "brand-glint" : "brand-fleck";
      particle.style.width = `${glint ? random(4, 6) : random(1.3, 3.3)}px`;
      particle.style.left = `${random(5, 92)}%`;
      particle.style.top = `${random(0, 64)}%`;
      layer.append(particle);

      const peak = random(0.45, 0.86);
      const frames = still
        ? [{ opacity: peak }, { opacity: peak }]
        : [
            { transform: "translateY(2px) scale(.65)", opacity: 0 },
            { opacity: peak, offset: 0.25 },
            {
              transform: `translate(${random(-6, 6)}px, ${random(-18, -8)}px) scale(.72)`,
              opacity: 0,
            },
          ];
      const animation = particle.animate(frames, {
        duration: still ? 450 : random(480, 720),
        delay: still ? 0 : random(0, spread),
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
    interval = window.setInterval(() => emit(1, period), period);
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
    if (hovering) return;
    emit(motionPreference.matches ? 5 : burstSize, 180);
  }

  function visibilityChanged() {
    if (document.hidden) {
      stop();
      clearParticles();
    } else if (hovering && tile.matches(":hover")) {
      start();
    }
  }

  function motionChanged() {
    if (motionPreference.matches) {
      stop();
      clearParticles();
    } else if (hovering) {
      start();
    }
  }

  tile.addEventListener("pointerenter", enter);
  tile.addEventListener("pointerleave", leave);
  tile.addEventListener("click", tap);
  document.addEventListener("visibilitychange", visibilityChanged);
  motionPreference.addEventListener("change", motionChanged);

  return () => {
    stop();
    clearParticles();
    layer.remove();
    tile.removeEventListener("pointerenter", enter);
    tile.removeEventListener("pointerleave", leave);
    tile.removeEventListener("click", tap);
    document.removeEventListener("visibilitychange", visibilityChanged);
    motionPreference.removeEventListener("change", motionChanged);
  };
}
