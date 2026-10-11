import { parseVisualization, validateFrame } from './visualization-schema.js';

const sessions = new Set(), initialized = new WeakSet();
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const workerUrl = new URL('./visualization-worker.js', import.meta.url);

function draw(canvas, frame, width, height) {
  validateFrame(frame);
  const density = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * density); canvas.height = Math.round(height * density);
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas is unavailable.');
  ctx.scale(density, density); ctx.clearRect(0, 0, width, height);
  // Only this trusted renderer touches canvas; no guest objects reach browser APIs.
  for (const c of frame.commands) {
    ctx.save(); ctx.globalAlpha = c.opacity ?? 1; ctx.lineWidth = c.lineWidth ?? 1;
    ctx.fillStyle = c.fill || '#f0eee5'; ctx.strokeStyle = c.stroke || '#e5ad72';
    if (c.type === 'text') {
      ctx.font = `${c.size ?? 16}px sans-serif`; ctx.textAlign = c.align || 'left'; ctx.fillText(c.text, c.x, c.y);
    } else {
      const path = c.type === 'path' ? new Path2D(c.d) : new Path2D();
      if (c.type === 'line') { path.moveTo(c.x1, c.y1); path.lineTo(c.x2, c.y2); }
      if (c.type === 'rect') path.rect(c.x, c.y, c.width, c.height);
      if (c.type === 'circle') path.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      if (c.type === 'polyline') c.points.forEach(([x, y], index) => index ? path.lineTo(x, y) : path.moveTo(x, y));
      if (c.fill && c.fill !== 'transparent') ctx.fill(path);
      if (c.stroke && c.stroke !== 'transparent') ctx.stroke(path);
    }
    ctx.restore();
  }
}

function install(figure) {
  const status = figure.querySelector('[data-viz-status]'); let spec;
  try { spec = parseVisualization(figure.querySelector('[data-viz-spec]').content.textContent); }
  catch { status.textContent = 'This visualization has an invalid definition. Its explanation remains available.'; return; }
  const canvas = figure.querySelector('[data-viz-canvas]'), fallback = figure.querySelector('[data-viz-fallback]');
  const caption = figure.querySelector('[data-viz-caption]'), controls = figure.querySelector('[data-viz-controls]');
  const actions = figure.querySelector('[data-viz-actions]'), run = figure.querySelector('[data-viz-run]'), stopButton = figure.querySelector('[data-viz-stop]'), reset = figure.querySelector('[data-viz-reset]');
  const drawingWidth = () => Math.max(180, Math.min(900, Math.round(controls.clientWidth)));
  if (!globalThis.Worker || !globalThis.WebAssembly || !canvas.getContext('2d')) { status.textContent = 'Interactive mode is unavailable in this browser. The explanation and static view remain available.'; return; }
  let worker, watchdog, nextFrame, pending = false, dirty = false, ready = false, playing = false, sequence = 0, elapsed = 0, lastTime = 0;
  let values = Object.fromEntries(spec.controls.map(c => [c.id, c.value]));
  let pointer = { x: 0, y: 0, down: false };
  const inputs = [];
  for (const control of spec.controls) {
    const label = document.createElement('label'), name = document.createElement('span'); name.textContent = control.label; label.append(name);
    const input = document.createElement(control.type === 'select' ? 'select' : 'input');
    if (control.type === 'select') control.options.forEach(option => { const item = document.createElement('option'); item.value = option; item.textContent = option; input.append(item); });
    else if (control.type === 'range') { input.type = 'range'; input.min = control.min; input.max = control.max; input.step = control.step; }
    else input.type = 'checkbox';
    const output = document.createElement('output');
    const sync = () => { input.value = String(values[control.id]); input.checked = Boolean(values[control.id]); output.textContent = String(values[control.id]); };
    sync(); input.disabled = true;
    input.addEventListener('input', () => { values[control.id] = control.type === 'range' ? Number(input.value) : control.type === 'toggle' ? input.checked : input.value; output.textContent = String(values[control.id]); requestFrame(); });
    label.append(input, output); controls.append(label); inputs.push({ input, sync });
  }
  const play = document.createElement('button'); play.type = 'button'; play.textContent = 'Play animation'; play.hidden = !spec.animated; play.disabled = true; actions.append(play);
  actions.hidden = false; canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', `${spec.title}. Use arrow keys to move the diagram pointer; Space toggles its pressed state.`);
  status.textContent = 'Run to explore this visualization.';

  function stop(message = 'Stopped. Run to start again.') {
    worker?.terminate(); worker = undefined; ready = false; pending = false; playing = false;
    clearTimeout(watchdog); clearTimeout(nextFrame); run.disabled = false; stopButton.disabled = true; play.disabled = true;
    play.textContent = 'Play animation'; inputs.forEach(({ input }) => { input.disabled = true; }); status.textContent = message;
  }
  const session = { figure, stop }; sessions.add(session);
  function requestFrame() {
    if (!worker || !ready) return;
    if (pending) { dirty = true; return; }
    dirty = false;
    clearTimeout(nextFrame);
    const width = drawingWidth();
    const time = performance.now(); if (playing) elapsed += Math.min((time - lastTime) / 1000, 0.1); lastTime = time;
    pending = true; const id = ++sequence;
    watchdog = setTimeout(() => stop('This visualization took too long and was stopped. The page is still available.'), 500);
    worker.postMessage({ id, code: spec.code, input: { width, height: spec.height, values, pointer, time: elapsed, reducedMotion: motion.matches } });
  }
  function start() {
    for (const other of sessions) if (other !== session) other.stop('Stopped while another visualization is running.');
    stop('Loading interactive mode…'); run.disabled = true; stopButton.disabled = false; reset.disabled = false;
    try { worker = new Worker(workerUrl, { type: 'module', name: 'essay-visualization' }); }
    catch { stop('Interactive mode could not start. The explanation remains available.'); return; }
    watchdog = setTimeout(() => stop('Interactive mode could not load. Try Run again.'), 10000);
    worker.onerror = event => { event.preventDefault(); stop('Interactive mode could not start. The explanation remains available.'); };
    worker.onmessage = event => {
      if (!ready && event.data?.error) { stop('Interactive mode could not load. The explanation remains available.'); return; }
      if (event.data?.ready) {
        clearTimeout(watchdog); ready = true; lastTime = performance.now();
        inputs.forEach(({ input }) => { input.disabled = false; }); play.disabled = false; requestFrame(); return;
      }
      if (!pending || event.data?.id !== sequence) return;
      clearTimeout(watchdog); pending = false;
      if (event.data.error) { stop(event.data.error); return; }
      try {
        const width = drawingWidth();
        draw(canvas, event.data.frame, width, spec.height);
        caption.textContent = event.data.frame.caption || ''; canvas.hidden = false; fallback.hidden = true;
        status.textContent = playing ? 'Animation playing.' : 'Interactive mode ready. Change a control to explore.';
      } catch { stop('This visualization returned an unsupported drawing and was stopped.'); return; }
      // Always coalesce updates; at most one call and one active worker per page.
      if (playing || dirty) nextFrame = setTimeout(requestFrame, playing ? 67 : 0);
    };
  }
  run.addEventListener('click', start);
  stopButton.addEventListener('click', () => stop());
  reset.addEventListener('click', () => {
    stop('Reset. Run to explore again.'); elapsed = 0; pointer = { x: 0, y: 0, down: false };
    values = Object.fromEntries(spec.controls.map(c => [c.id, c.value])); inputs.forEach(item => item.sync());
    canvas.hidden = true; fallback.hidden = false; caption.textContent = ''; reset.disabled = true;
  });
  play.addEventListener('click', () => { playing = !playing; lastTime = performance.now(); play.textContent = playing ? 'Pause animation' : 'Play animation'; requestFrame(); });
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave']) canvas.addEventListener(type, event => {
    const rect = canvas.getBoundingClientRect();
    pointer = { x: Math.max(0, Math.min(drawingWidth(), (event.clientX - rect.left) * drawingWidth() / rect.width)), y: Math.max(0, Math.min(spec.height, (event.clientY - rect.top) * spec.height / rect.height)), down: type === 'pointerdown' || (type === 'pointermove' && event.buttons > 0) };
    requestFrame();
  });
  canvas.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(event.key)) return;
    event.preventDefault();
    pointer.x = Math.max(0, Math.min(drawingWidth(), pointer.x + (event.key === 'ArrowRight' ? 10 : event.key === 'ArrowLeft' ? -10 : 0)));
    pointer.y = Math.max(0, Math.min(spec.height, pointer.y + (event.key === 'ArrowDown' ? 10 : event.key === 'ArrowUp' ? -10 : 0)));
    if (event.key === ' ') pointer.down = !pointer.down; requestFrame();
  });
  const observer = globalThis.IntersectionObserver ? new IntersectionObserver(entries => { if (!entries[0].isIntersecting && worker) stop('Stopped while out of view. Run to continue.'); }) : null;
  observer?.observe(figure);
  const resize = globalThis.ResizeObserver ? new ResizeObserver(requestFrame) : null; resize?.observe(figure);
  session.dispose = () => { stop(); observer?.disconnect(); resize?.disconnect(); sessions.delete(session); };
}

export function setupVisualizations(root = document) {
  root.querySelectorAll('[data-visualization]').forEach(figure => { if (!initialized.has(figure)) { initialized.add(figure); install(figure); } });
}
new MutationObserver(() => {
  for (const session of sessions) if (!session.figure.isConnected) session.dispose();
  setupVisualizations();
}).observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) for (const session of sessions) session.stop('Stopped while the tab was hidden. Run to continue.'); });
motion.addEventListener('change', () => { for (const session of sessions) session.stop('Motion preference changed. Run to continue.'); });
setupVisualizations();
