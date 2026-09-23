// Lorenz's classical chaotic regime. The renderer and static assets share
// the same 3D camera, starting from the original logo's diagonal view.
export const PARAMETERS = Object.freeze({ sigma: 10, rho: 28, beta: 8 / 3 });
export const STEP = 0.005;
export const FRAME_STEP = 1 / 120;
// Simulation seconds per real second. Previously this was 0.6; slow the
// flow itself, rather than dropping frames or degrading numerical accuracy.
export const FLOW_SPEED = 0.085;
export const ARTBOARD = Object.freeze({ width: 620, height: 520 });
export const DEFAULT_VIEW = Object.freeze({ yaw: -0.12, pitch: 0.1 });
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

export function advanceParticles(particles, elapsed = FRAME_STEP) {
  for (let i = 0; i < particles.length; i += 3) step(particles, i, elapsed * FLOW_SPEED);
}

export function viewAt(time, yaw = 0, pitch = 0) {
  return {
    yaw: DEFAULT_VIEW.yaw + yaw + Math.sin(time / 12) * 0.055,
    pitch: DEFAULT_VIEW.pitch + pitch + Math.sin(time / 15) * 0.035,
  };
}

// A true perspective projection of all three coordinates. Center the camera
// on the attractor, tilt slightly into its depth, then keep the logo's roll.
export function project(x, y, z, width = ARTBOARD.width, height = ARTBOARD.height, view = DEFAULT_VIEW) {
  const centeredZ = z - 25;
  const rotatedX = x * Math.cos(view.yaw) + centeredZ * Math.sin(view.yaw);
  const rotatedZ = -x * Math.sin(view.yaw) + centeredZ * Math.cos(view.yaw);
  const rotatedY = y * Math.cos(view.pitch) - rotatedZ * Math.sin(view.pitch);
  const depth = y * Math.sin(view.pitch) + rotatedZ * Math.cos(view.pitch);
  const perspective = 120 / (120 - depth);
  const scale = Math.min(width / 58, height / 52) * 0.88 * perspective;
  return [width / 2 + (rotatedX * COS + rotatedY * SIN) * scale,
    height / 2 + (rotatedX * SIN - rotatedY * COS) * scale, depth, perspective];
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
        update(FRAME_STEP);
        accumulator -= FRAME_STEP;
      }
    },
    get alpha() { return Math.max(0, accumulator / FRAME_STEP); },
    reset() { previous = null; accumulator = 0; },
  };
}
