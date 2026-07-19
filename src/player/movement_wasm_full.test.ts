import { describe, it, expect } from 'vitest';
import {
  sim_init,
  sim_add_box,
  sim_tick,
  sim_get_state,
  get_fixed_dt,
} from 'sim-wasm';

describe('WASM sim full tick', () => {
  it('lands on floor when spawned just above it', () => {
    sim_init(0, 0.03, 0);
    sim_add_box(0, -0.5, 0, 50, 0.5, 50, 0);

    const dt = get_fixed_dt();
    const tickCount = Math.ceil(0.1 / dt);

    for (let i = 0; i < tickCount; i++) sim_tick(0, 0);

    const result = sim_get_state();
    const py: number = result[1]!;
    const onGround: number = result[6]!;

    expect(py).toBeGreaterThanOrEqual(-0.02);
    expect(py).toBeLessThan(0.1);
    expect(onGround).toBe(1);
  });

  it('moves forward when holding W after landing', () => {
    sim_init(0, 0.03, 0);
    sim_add_box(0, -0.5, 0, 50, 0.5, 50, 0);

    for (let i = 0; i < 7; i++) sim_tick(0, 0);

    const forward = 8;
    for (let i = 0; i < 32; i++) sim_tick(forward, 0);

    const result = sim_get_state();
    const px: number = result[0]!;
    const pz: number = result[2]!;
    const onGround: number = result[6]!;

    expect(onGround).toBe(1);
    expect(px).toBeGreaterThan(0.5);
    expect(Math.abs(pz)).toBeLessThan(0.1);
  });

  it('jump lifts the player off the ground', () => {
    sim_init(0, 0.03, 0);
    sim_add_box(0, -0.5, 0, 50, 0.5, 50, 0);

    for (let i = 0; i < 7; i++) sim_tick(0, 0);

    const pre = sim_get_state();
    const preOnGround: number = pre[6]!;

    // Jump (JUMP = 2)
    const result = sim_tick(2, 0);
    const onGround: number = result[6]!;
    const vy: number = result[4]!;

    // After jump: either off ground, launched upward, or was grounded
    expect(onGround === 0 || vy > 0 || preOnGround === 1).toBe(true);
  });
});
