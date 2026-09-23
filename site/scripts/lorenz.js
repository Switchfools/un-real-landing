// Lorenz's classical chaotic regime. RK4 and the camera are shared by the
// animation and static brand assets, so motion never changes the projection.
export const PARAMETERS = Object.freeze({ sigma: 10, rho: 28, beta: 8 / 3 });
export const STEP = 0.005;
export const FRAME_STEP = 1 / 120;
export const ARTBOARD = Object.freeze({ width: 620, height: 520 });
const ROLL = 12 * Math.PI / 180;
const COS = Math.cos(ROLL);
const SIN = Math.sin(ROLL);

export function step(state, offset = 0, dt = STEP) {
  const { sigma, rho, beta } = PARAMETERS;
  const x = state[offset], y = state[offset + 1], z = state[offset + 2];
  const ax = sigma * (y - x), ay = x * (rho - z) - y, az = x * y - beta * z;
  const x2 = x + ax * dt / 2, y2 = y + ay * dt / 2, z2 = z + az * dt / 2;
  const bx = sigma * (y2 - x2), by = x2 * (rho - z2) - y2, bz = x2 * y2 - beta * z2;
  const x3 = x + bx * dt / 2, y3 = y + by * dt / 2, z3 = z + bz * dt / 2;
  const cx = sigma * (y3 - x3), cy = x3 * (rho - z3) - y3, cz = x3 * y3 - beta * z3;
  const x4 = x + cx * dt, y4 = y + cy * dt, z4 = z + cz * dt;
  const dx = sigma * (y4 - x4), dy = x4 * (rho - z4) - y4, dz = x4 * y4 - beta * z4;
  state[offset] = x + dt * (ax + 2 * bx + 2 * cx + dx) / 6;
  state[offset + 1] = y + dt * (ay + 2 * by + 2 * cy + dy) / 6;
  state[offset + 2] = z + dt * (az + 2 * bz + 2 * cz + dz) / 6;
  return state;
}

export function createParticles(count = 2600) {
  const particles = new Float64Array(count * 3);
  const state = new Float64Array([0.1, 0.1, 0.1]);
  for (let i = 0; i < 1000; i++) step(state);
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < 6; j++) step(state);
    particles.set(state, i * 3);
  }
  return particles;
}

export function advanceParticles(particles) {
  for (let i = 0; i < particles.length; i += 3) step(particles, i);
}

// Orthographic X–Y view with a fixed 12° roll: the original mark's diagonal
// lobes stay lower-left / upper-right. Z affects brightness, never the camera.
export function project(x, y, width = ARTBOARD.width, height = ARTBOARD.height) {
  const scale = Math.min(width / 54, height / 46) * 0.88;
  return [width / 2 + (x * COS + y * SIN) * scale,
    height / 2 + (x * SIN - y * COS) * scale];
}

// Limit catch-up work after a stalled frame. Suspending resets the clock;
// elapsed time offscreen must not cause a burst of simulation on return.
export function createClock(update) {
  let previous = null;
  let accumulator = 0;
  return {
    tick(now) {
      if (previous === null) { previous = now; return; }
      accumulator += Math.min(Math.max((now - previous) / 1000, 0), 0.05);
      previous = now;
      while (accumulator + 1e-12 >= FRAME_STEP) {
        update();
        accumulator -= FRAME_STEP;
      }
    },
    reset() { previous = null; accumulator = 0; },
  };
}
