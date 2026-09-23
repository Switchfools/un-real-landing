import { advanceParticles, createClock, createParticles, project, viewAt } from './lorenz.js';

function mountAttractor(figure) {
  const canvas = figure.querySelector('canvas');
  const button = figure.querySelector('.motion-toggle');
  const resetButton = figure.querySelector('.view-reset');
  const label = button.querySelector('span');
  const viewport = figure.querySelector('.attractor-viewport');
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const particles = createParticles(window.innerWidth < 700 ? 1400 : 2600);
  const previous = particles.slice();
  const projected = new Float32Array(particles.length / 3 * 4);
  const order = Array.from({ length: particles.length / 3 }, (_, i) => i);
  let phase = 0, alpha = 0;
  let yaw = 0, pitch = 0, targetYaw = 0, targetPitch = 0, drag = null;
  const clock = createClock(elapsed => {
    previous.set(particles);
    advanceParticles(particles, elapsed);
    phase += elapsed;
    const easing = 1 - Math.exp(-elapsed * 8);
    yaw += (targetYaw - yaw) * easing;
    pitch += (targetPitch - pitch) * easing;
  });
  let width = 0, height = 0, frame = null;
  let inView = false, paused = false, failed = false;
  const cleanups = [];
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 32;
  const spriteContext = sprite.getContext('2d');
  if (!spriteContext) return;
  const glow = spriteContext.createRadialGradient(16, 16, 0, 16, 16, 16);
  glow.addColorStop(0, 'rgba(255,239,204,1)');
  glow.addColorStop(0.22, 'rgba(247,199,137,0.95)');
  glow.addColorStop(0.45, 'rgba(228,157,80,0.55)');
  glow.addColorStop(1, 'rgba(224,120,33,0)');
  spriteContext.fillStyle = glow;
  spriteContext.fillRect(0, 0, 32, 32);

  function draw() {
    context.clearRect(0, 0, width, height);
    const dot = Math.max(0.7, Math.min(width / 620, 1.1));
    const view = viewAt(phase, yaw, pitch);
    for (let i = 0; i < order.length; i++) {
      const offset = i * 3;
      const x = previous[offset] + (particles[offset] - previous[offset]) * alpha;
      const y = previous[offset + 1] + (particles[offset + 1] - previous[offset + 1]) * alpha;
      const z = previous[offset + 2] + (particles[offset + 2] - previous[offset + 2]) * alpha;
      projected.set(project(x, y, z, width, height, view), i * 4);
    }
    // Far particles first. Continuous depth, size and opacity avoid the old
    // five-layer brightness jumps as a particle moves through the volume.
    order.sort((a, b) => projected[a * 4 + 2] - projected[b * 4 + 2]);
    for (const index of order) {
      const i = index * 4;
      const radius = dot * 2.4 * projected[i + 3];
      context.globalAlpha = Math.max(0.2, Math.min(0.95, 0.55 + projected[i + 2] / 60));
      context.drawImage(sprite, projected[i] - radius, projected[i + 1] - radius, radius * 2, radius * 2);
    }
    context.globalAlpha = 1;
  }

  function stop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    clock.reset();
  }

  function fail() {
    failed = true;
    stop();
    figure.dataset.animation = 'unavailable';
    button.hidden = true;
    resetButton.hidden = true;
    figure.querySelector('.plot-label').textContent = 'Possibility, unfolding.';
    viewport.classList.remove('is-interactive', 'is-dragging');
  }

  function animate(now) {
    try {
      clock.tick(now);
      alpha = clock.alpha;
      draw();
      frame = requestAnimationFrame(animate);
    } catch {
      fail();
    }
  }

  function sync() {
    stop();
    if (failed) return;
    button.hidden = reducedMotion.matches;
    resetButton.hidden = reducedMotion.matches;
    figure.querySelector('.plot-label').textContent = reducedMotion.matches ? 'Possibility, unfolding.' : 'Drag to explore in 3D';
    viewport.classList.toggle('is-interactive', !reducedMotion.matches);
    button.setAttribute('aria-pressed', String(paused));
    label.textContent = paused ? 'Resume motion' : 'Pause motion';
    if (reducedMotion.matches) {
      figure.dataset.animation = 'static';
    } else if (paused || !inView || document.hidden) {
      figure.dataset.animation = 'paused';
    } else {
      figure.dataset.animation = 'running';
      frame = requestAnimationFrame(animate);
    }
  }

  function resize() {
    if (failed) return;
    const bounds = viewport.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    width = bounds.width;
    height = bounds.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    try { draw(); } catch { fail(); return; }
    sync();
  }

  function listen(target, event, listener) {
    target.addEventListener(event, listener);
    cleanups.push(() => target.removeEventListener(event, listener));
  }

  function redrawView() {
    if (frame !== null) return;
    yaw = targetYaw;
    pitch = targetPitch;
    try { draw(); } catch { fail(); }
  }

  function finishDrag() {
    if (drag && viewport.hasPointerCapture(drag.id)) viewport.releasePointerCapture(drag.id);
    drag = null;
    viewport.classList.remove('is-dragging');
  }

  listen(viewport, 'pointerdown', event => {
    if (failed || reducedMotion.matches || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY,
      yaw: targetYaw, pitch: targetPitch, active: event.pointerType !== 'touch' };
    if (drag.active) {
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add('is-dragging');
    }
  });
  listen(viewport, 'pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.active) {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { finishDrag(); return; }
      if (Math.abs(dx) < 8) return;
      drag.active = true;
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add('is-dragging');
    }
    targetYaw = Math.max(-0.65, Math.min(0.65, drag.yaw + dx / width * 1.4));
    targetPitch = Math.max(-0.3, Math.min(0.3, drag.pitch + dy / height * 0.7));
    redrawView();
  });
  listen(viewport, 'pointerup', finishDrag);
  listen(viewport, 'pointercancel', finishDrag);
  listen(viewport, 'lostpointercapture', () => { drag = null; viewport.classList.remove('is-dragging'); });
  listen(resetButton, 'click', () => {
    targetYaw = targetPitch = 0;
    redrawView();
  });
  listen(button, 'click', () => { paused = !paused; sync(); });
  listen(document, 'visibilitychange', sync);
  listen(reducedMotion, 'change', sync);
  listen(canvas, 'contextlost', fail);
  listen(window, 'resize', resize);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(viewport);
  const visibilityObserver = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    sync();
  });
  visibilityObserver.observe(viewport);
  listen(window, 'pagehide', (event) => {
    stop();
    if (event.persisted) return;
    resizeObserver.disconnect();
    visibilityObserver.disconnect();
    cleanups.forEach(cleanup => cleanup());
  });
  listen(window, 'pageshow', sync);
  resize();
}

const figure = document.querySelector('[data-attractor]');
if (figure) {
  try { mountAttractor(figure); } catch {
    // The default HTML/SVG remains the complete, readable experience.
    figure.dataset.animation = 'unavailable';
    figure.querySelectorAll('button').forEach(button => { button.hidden = true; });
    figure.querySelector('.attractor-viewport').classList.remove('is-interactive', 'is-dragging');
  }
}
