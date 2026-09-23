import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClock, createParticles, project, step } from '../site/scripts/lorenz.js';

test('initial particles are deterministic and populate both lobes', () => {
  const first = createParticles();
  assert.deepEqual(first, createParticles());
  const x = [...first].filter((_, i) => i % 3 === 0);
  assert.ok(x.some(value => value < -10));
  assert.ok(x.some(value => value > 10));
});

test('RK4 converges at fourth order over a short, non-chaotic horizon', () => {
  function integrate(dt) {
    const state = [1, 1, 1];
    for (let i = 0; i < Math.round(0.5 / dt); i++) step(state, 0, dt);
    return state;
  }
  const reference = integrate(0.0001);
  const error = state => Math.hypot(...state.map((v, i) => v - reference[i]));
  const coarse = error(integrate(0.01));
  const fine = error(integrate(0.005));
  assert.ok(fine < 0.0001, `error ${fine}`);
  assert.ok(coarse / fine > 12, `convergence ratio ${coarse / fine}`);
});

test('long trajectories stay finite, bounded, and inside the artboard', () => {
  const state = [0.1, 0.1, 0.1];
  for (let i = 0; i < 60000; i++) {
    step(state);
    assert.ok(state.every(value => Number.isFinite(value) && Math.abs(value) < 65));
    const [x, y] = project(state[0], state[1]);
    assert.ok(x > 0 && x < 620 && y > 0 && y < 520);
  }
});

test('fixed projection preserves the diagonal brand orientation at every size', () => {
  const lowerLeft = project(-9, -9);
  const upperRight = project(9, 9);
  assert.ok(lowerLeft[0] < 310 && lowerLeft[1] > 260);
  assert.ok(upperRight[0] > 310 && upperRight[1] < 260);
  assert.deepEqual(project(9, 9, 310, 260), upperRight.map(value => value / 2));
});

test('simulation timing is independent of display refresh rate', () => {
  function simulate(fps) {
    const state = [1, 1, 1];
    const clock = createClock(() => step(state));
    for (let i = 0; i <= fps * 3; i++) clock.tick(i * 1000 / fps);
    return state;
  }
  assert.deepEqual(simulate(30), simulate(60));
  assert.deepEqual(simulate(60), simulate(144));
});

test('pausing resets elapsed time and catch-up work is bounded', () => {
  let updates = 0;
  const clock = createClock(() => updates++);
  clock.tick(0);
  clock.tick(1000 / 60);
  assert.equal(updates, 2);
  clock.reset();
  clock.tick(100000);
  assert.equal(updates, 2);
  clock.tick(200000);
  assert.equal(updates, 8);
});
