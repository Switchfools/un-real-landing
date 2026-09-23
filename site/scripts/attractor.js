import { advanceParticles, createClock, createParticles, project } from './lorenz.js';

function mountAttractor(figure) {
  const canvas = figure.querySelector('canvas');
  const button = figure.querySelector('button');
  const label = button.querySelector('span');
  const viewport = figure.querySelector('.attractor-viewport');
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const particles = createParticles(window.innerWidth < 700 ? 1400 : 2600);
  const clock = createClock(() => advanceParticles(particles));
  let width = 0, height = 0, frame = null;
  let inView = false, paused = false, failed = false;
  const cleanups = [];

  function draw() {
    context.clearRect(0, 0, width, height);
    const dot = Math.max(0.7, Math.min(width / 620, 1.1));
    // Batch particles by depth; no per-particle textures or blur filters.
    for (let layer = 0; layer < 5; layer++) {
      context.fillStyle = ['#95603b', '#b87542', '#d89350', '#edb875', '#ffe0ad'][layer];
      context.globalAlpha = 0.45 + layer * 0.12;
      context.beginPath();
      for (let i = 0; i < particles.length; i += 3) {
        if (Math.min(4, Math.max(0, Math.floor((particles[i + 2] - 5) / 9))) !== layer) continue;
        const [x, y] = project(particles[i], particles[i + 1], width, height);
        const radius = dot * (0.75 + layer * 0.13);
        context.moveTo(x + radius, y);
        context.arc(x, y, radius, 0, Math.PI * 2);
      }
      context.fill();
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
  }

  function animate(now) {
    try {
      clock.tick(now);
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
    figure.querySelector('button').hidden = true;
  }
}
